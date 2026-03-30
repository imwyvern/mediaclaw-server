import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import {
  ApiUsage,
  Organization,
  Subscription,
  SubscriptionStatus,
} from '@yikart/mongodb'

interface UsagePeriodInput {
  startDate?: string
  endDate?: string
}

const DEFAULT_MONTHLY_QUOTA = 10000
const DEFAULT_DAILY_API_LIMIT = 1000

@Injectable()
export class UsageService {
  constructor(
    @InjectModel(ApiUsage.name)
    private readonly apiUsageModel: Model<ApiUsage>,
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<Organization>,
    @InjectModel(Subscription.name)
    private readonly subscriptionModel: Model<Subscription>,
  ) {}

  async trackRequest(
    orgId: string,
    apiKey: string,
    endpoint: string,
    method: string,
    responseTimeMs: number,
  ) {
    if (!Types.ObjectId.isValid(orgId)) {
      return { tracked: false }
    }

    const date = this.toDateKey(new Date())
    const normalizedApiKey = this.normalizeApiKey(apiKey)
    const query = {
      orgId: new Types.ObjectId(orgId),
      apiKey: normalizedApiKey,
      endpoint,
      method,
      date,
    }
    const existing = await this.apiUsageModel.findOne(query).lean().exec()

    if (!existing) {
      const created = await this.apiUsageModel.create({
        ...query,
        requestCount: 1,
        responseTimeMs,
      })

      return {
        tracked: true,
        id: created._id.toString(),
      }
    }

    const nextRequestCount = existing.requestCount + 1
    const nextAverageResponseTime = Number((
      ((existing.responseTimeMs || 0) * existing.requestCount + responseTimeMs)
      / nextRequestCount
    ).toFixed(2))

    await this.apiUsageModel.findByIdAndUpdate(existing._id, {
      requestCount: nextRequestCount,
      responseTimeMs: nextAverageResponseTime,
    }).exec()

    return {
      tracked: true,
      id: existing._id.toString(),
    }
  }

  async getUsageSummary(orgId: string, period: UsagePeriodInput = {}) {
    const query = this.buildUsageQuery(orgId, period)
    const records = await this.apiUsageModel.find(query).sort({ date: -1, endpoint: 1 }).lean().exec()

    const totalRequests = records.reduce((sum, record) => sum + record.requestCount, 0)
    const weightedDuration = records.reduce(
      (sum, record) => sum + record.responseTimeMs * record.requestCount,
      0,
    )
    const avgResponseTimeMs = totalRequests > 0
      ? Number((weightedDuration / totalRequests).toFixed(2))
      : 0

    const endpointMap = new Map<string, { requestCount: number; weightedDuration: number }>()
    const methodMap = new Map<string, number>()
    const dailyMap = new Map<string, number>()

    for (const record of records) {
      const currentEndpoint = endpointMap.get(record.endpoint) || {
        requestCount: 0,
        weightedDuration: 0,
      }
      currentEndpoint.requestCount += record.requestCount
      currentEndpoint.weightedDuration += record.responseTimeMs * record.requestCount
      endpointMap.set(record.endpoint, currentEndpoint)

      methodMap.set(record.method, (methodMap.get(record.method) || 0) + record.requestCount)
      dailyMap.set(record.date, (dailyMap.get(record.date) || 0) + record.requestCount)
    }

    return {
      orgId,
      period: {
        startDate: period.startDate || null,
        endDate: period.endDate || null,
      },
      totalRequests,
      avgResponseTimeMs,
      uniqueEndpoints: endpointMap.size,
      byEndpoint: [...endpointMap.entries()].map(([endpoint, value]) => ({
        endpoint,
        requestCount: value.requestCount,
        avgResponseTimeMs: value.requestCount > 0
          ? Number((value.weightedDuration / value.requestCount).toFixed(2))
          : 0,
      })),
      byMethod: [...methodMap.entries()].map(([method, requestCount]) => ({
        method,
        requestCount,
      })),
      daily: [...dailyMap.entries()].map(([date, requestCount]) => ({
        date,
        requestCount,
      })),
    }
  }

  async getQuotaStatus(orgId: string) {
    if (!Types.ObjectId.isValid(orgId)) {
      throw new BadRequestException('Invalid orgId')
    }

    const monthStart = new Date()
    monthStart.setUTCDate(1)
    monthStart.setUTCHours(0, 0, 0, 0)

    const [organization, subscription, summary] = await Promise.all([
      this.organizationModel.findById(orgId).lean().exec(),
      this.subscriptionModel.findOne({
        orgId: new Types.ObjectId(orgId),
        status: SubscriptionStatus.ACTIVE,
      }).lean().exec(),
      this.getUsageSummary(orgId, {
        startDate: this.toDateKey(monthStart),
        endDate: this.toDateKey(new Date()),
      }),
    ])

    if (!organization) {
      throw new NotFoundException('Organization not found')
    }

    const monthlyQuota = subscription?.monthlyQuota
      || organization.monthlyQuota
      || DEFAULT_MONTHLY_QUOTA
    const used = summary.totalRequests
    const remaining = Math.max(monthlyQuota - used, 0)

    return {
      orgId,
      quota: monthlyQuota,
      used,
      remaining,
      usageRate: monthlyQuota > 0 ? Number(((used / monthlyQuota) * 100).toFixed(2)) : 0,
      plan: subscription?.plan || organization.type,
      billingMode: subscription?.billingMode || organization.billingMode,
      periodStart: this.toDateKey(monthStart),
      periodEnd: this.toDateKey(new Date()),
    }
  }

  async getRateLimitStatus(apiKey: string) {
    const normalizedApiKey = this.normalizeApiKey(apiKey)
    const date = this.toDateKey(new Date())
    const records = await this.apiUsageModel.find({
      apiKey: normalizedApiKey,
      date,
    }).lean().exec()

    const requestCount = records.reduce((sum, record) => sum + record.requestCount, 0)
    const weightedDuration = records.reduce(
      (sum, record) => sum + record.responseTimeMs * record.requestCount,
      0,
    )
    const avgResponseTimeMs = requestCount > 0
      ? Number((weightedDuration / requestCount).toFixed(2))
      : 0
    const remaining = Math.max(DEFAULT_DAILY_API_LIMIT - requestCount, 0)
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)
    const elapsedHours = Math.max((Date.now() - startOfDay.getTime()) / (1000 * 60 * 60), 1 / 60)

    return {
      apiKey: normalizedApiKey,
      date,
      requestCount,
      limit: DEFAULT_DAILY_API_LIMIT,
      remaining,
      avgResponseTimeMs,
      currentRatePerHour: Number((requestCount / elapsedHours).toFixed(2)),
      resetAt: new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    }
  }

  private buildUsageQuery(orgId: string, period: UsagePeriodInput) {
    if (!Types.ObjectId.isValid(orgId)) {
      throw new BadRequestException('Invalid orgId')
    }

    const query: Record<string, any> = {
      orgId: new Types.ObjectId(orgId),
    }

    if (period.startDate || period.endDate) {
      query['date'] = {}

      if (period.startDate) {
        query['date']['$gte'] = period.startDate
      }

      if (period.endDate) {
        query['date']['$lte'] = period.endDate
      }
    }

    return query
  }

  private toDateKey(date: Date) {
    return date.toISOString().slice(0, 10)
  }

  private normalizeApiKey(apiKey: string) {
    if (!apiKey?.trim()) {
      return 'session'
    }

    const normalized = apiKey.trim()
    if (normalized.startsWith('mc_live_')) {
      return normalized.slice(0, 16)
    }

    return normalized
  }
}
