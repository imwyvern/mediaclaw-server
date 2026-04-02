import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import {
  ApiUsage,
  Brand,
  Organization,
  PackStatus,
  Subscription,
  SubscriptionStatus,
  UsageHistory,
  UsageHistoryType,
  VideoPack,
  VideoTask,
} from '@yikart/mongodb'
import { Model, Types } from 'mongoose'

interface UsagePeriodInput {
  startDate?: string | Date
  endDate?: string | Date
}

interface UsageScopeInput {
  userId: string
  orgId?: string | null
}

interface UsageDetailInput {
  page?: number
  limit?: number
  type?: UsageHistoryType
}

interface ChargeVideoOptions {
  videoTaskId?: string
  metadata?: Record<string, any>
}

interface TokenUsageInput {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  model?: string
  provider?: string
  cost?: number
  estimated?: boolean
  videoTaskId?: string | null
  packId?: string | null
}

interface ChargeAllocation {
  packId: string
  usageHistoryId: string
  units: number
}

interface UsageMetricBucket {
  creditsConsumed: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  tokenCost: number
  recordCount: number
}

const DEFAULT_MONTHLY_QUOTA = 10000
const DEFAULT_DAILY_API_LIMIT = 1000

export class InsufficientCreditsError extends BadRequestException {
  constructor(units: number) {
    super(`Insufficient credits. ${units} credit(s) required.`)
  }
}

@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name)

  constructor(
    @InjectModel(ApiUsage.name)
    private readonly apiUsageModel: Model<ApiUsage>,
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<Organization>,
    @InjectModel(Subscription.name)
    private readonly subscriptionModel: Model<Subscription>,
    @InjectModel(UsageHistory.name)
    private readonly usageHistoryModel: Model<UsageHistory>,
    @InjectModel(VideoPack.name)
    private readonly videoPackModel: Model<VideoPack>,
    @InjectModel(VideoTask.name)
    private readonly videoTaskModel: Model<VideoTask>,
    @InjectModel(Brand.name)
    private readonly brandModel: Model<Brand>,
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

  async getApiUsageSummary(orgId: string, period: UsagePeriodInput = {}) {
    const query = this.buildApiUsageQuery(orgId, period)
    const records = await this.apiUsageModel.find(query).sort({ date: -1, endpoint: 1 }).lean().exec()

    const totalRequests = records.reduce((sum, record) => sum + record.requestCount, 0)
    const weightedDuration = records.reduce(
      (sum, record) => sum + record.responseTimeMs * record.requestCount,
      0,
    )
    const avgResponseTimeMs = totalRequests > 0
      ? Number((weightedDuration / totalRequests).toFixed(2))
      : 0

    const endpointMap = new Map<string, { requestCount: number, weightedDuration: number }>()
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
        startDate: period.startDate ? this.normalizeApiDateKey(period.startDate) : null,
        endDate: period.endDate ? this.normalizeApiDateKey(period.endDate) : null,
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
      this.getApiUsageSummary(orgId, {
        startDate: monthStart,
        endDate: new Date(),
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

  async recordVideoUsage(
    userId: string,
    orgId: string | null | undefined,
    videoTaskId: string,
    units: number,
    packId: string,
    metadata: Record<string, any> = {},
  ) {
    const normalizedUnits = Math.trunc(this.normalizePositiveNumber(units, 'units'))
    return this.usageHistoryModel.create({
      userId: this.toObjectId(userId, 'userId'),
      orgId: this.toOptionalObjectId(orgId),
      videoTaskId: this.toObjectId(videoTaskId, 'videoTaskId'),
      type: UsageHistoryType.VIDEO_CHARGE,
      creditsConsumed: normalizedUnits,
      tokenUsage: this.emptyTokenUsage(),
      packId: this.toObjectId(packId, 'packId'),
      metadata,
    })
  }

  async recordTokenUsage(
    userId: string,
    orgId: string | null | undefined,
    type: UsageHistoryType,
    tokenUsage: TokenUsageInput,
    metadata: Record<string, any> = {},
  ) {
    const normalizedType = this.normalizeUsageType(type)
    if ([UsageHistoryType.VIDEO_CHARGE, UsageHistoryType.VIDEO_REFUND].includes(normalizedType)) {
      throw new BadRequestException('video charge/refund must use chargeVideo or refundVideo')
    }

    return this.usageHistoryModel.create({
      userId: this.toObjectId(userId, 'userId'),
      orgId: this.toOptionalObjectId(orgId),
      videoTaskId: this.resolveObjectIdCandidate([
        tokenUsage.videoTaskId,
        metadata['videoTaskId'],
        metadata['taskId'],
      ]),
      type: normalizedType,
      creditsConsumed: 0,
      tokenUsage: this.normalizeTokenUsage(tokenUsage),
      packId: this.resolveObjectIdCandidate([
        tokenUsage.packId,
        metadata['packId'],
      ]),
      metadata,
    })
  }

  async getUsageSummary(
    scope: UsageScopeInput,
    startDate?: string | Date,
    endDate?: string | Date,
  ) {
    const histories = await this.usageHistoryModel.find(
      this.buildHistoryQuery(scope, { startDate, endDate }),
    )
      .sort({ createdAt: -1 })
      .lean()
      .exec()

    const { taskBrandMap, brandNameMap } = await this.loadBrandContext(histories)
    const total = this.createMetricBucket()
    const byType = new Map<UsageHistoryType, UsageMetricBucket>()
    const byBrand = new Map<string, UsageMetricBucket & { brandId: string | null }>()

    for (const history of histories) {
      const metrics = this.extractUsageMetrics(history)
      this.accumulateMetric(total, metrics)

      const typeKey = this.normalizeUsageType(history.type)
      const typeBucket = byType.get(typeKey) || this.createMetricBucket()
      this.accumulateMetric(typeBucket, metrics)
      byType.set(typeKey, typeBucket)

      const brandId = this.resolveHistoryBrandId(history, taskBrandMap)
      const brandKey = brandId || 'unassigned'
      const brandBucket = byBrand.get(brandKey) || {
        brandId,
        ...this.createMetricBucket(),
      }
      this.accumulateMetric(brandBucket, metrics)
      byBrand.set(brandKey, brandBucket)
    }

    return {
      scope: this.serializeScope(scope),
      period: this.serializePeriod(startDate, endDate),
      totals: this.serializeMetricBucket(total),
      byType: [...byType.entries()]
        .map(([type, metrics]) => ({
          type,
          ...this.serializeMetricBucket(metrics),
        }))
        .sort((left, right) => Math.abs(right.creditsConsumed) - Math.abs(left.creditsConsumed) || right.totalTokens - left.totalTokens),
      byBrand: [...byBrand.values()]
        .map(bucket => ({
          brandId: bucket.brandId,
          brandName: bucket.brandId ? brandNameMap.get(bucket.brandId) || null : null,
          ...this.serializeMetricBucket(bucket),
        }))
        .sort((left, right) => Math.abs(right.creditsConsumed) - Math.abs(left.creditsConsumed) || right.totalTokens - left.totalTokens),
    }
  }

  async getUsageTimeline(
    scope: UsageScopeInput,
    startDate?: string | Date,
    endDate?: string | Date,
    granularity: 'day' | 'week' | 'month' = 'day',
  ) {
    const normalizedGranularity = this.normalizeGranularity(granularity)
    const histories = await this.usageHistoryModel.find(
      this.buildHistoryQuery(scope, { startDate, endDate }),
    )
      .sort({ createdAt: 1 })
      .lean()
      .exec()

    const buckets = new Map<string, UsageMetricBucket>()
    for (const history of histories) {
      const periodStart = this.toPeriodStart(history.createdAt, normalizedGranularity).toISOString()
      const bucket = buckets.get(periodStart) || this.createMetricBucket()
      this.accumulateMetric(bucket, this.extractUsageMetrics(history))
      buckets.set(periodStart, bucket)
    }

    return {
      scope: this.serializeScope(scope),
      period: this.serializePeriod(startDate, endDate),
      granularity: normalizedGranularity,
      points: [...buckets.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([periodStart, metrics]) => ({
          periodStart,
          ...this.serializeMetricBucket(metrics),
        })),
    }
  }

  async getUsageDetail(scope: UsageScopeInput, input: UsageDetailInput = {}) {
    const page = this.normalizePage(input.page)
    const limit = this.normalizeLimit(input.limit)
    const query = this.buildHistoryQuery(scope, {}, input.type)
    const skip = (page - 1) * limit

    const [items, total] = await Promise.all([
      this.usageHistoryModel.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.usageHistoryModel.countDocuments(query),
    ])

    const chargeIds = items
      .filter(item => item.type === UsageHistoryType.VIDEO_CHARGE)
      .map(item => item._id.toString())
    const refundedChargeIds = chargeIds.length > 0
      ? await this.findRefundedChargeIds(chargeIds)
      : new Set<string>()

    const { taskBrandMap, brandNameMap } = await this.loadBrandContext(items)

    return {
      scope: this.serializeScope(scope),
      page,
      limit,
      total,
      items: items.map(item => {
        const metrics = this.extractUsageMetrics(item)
        const brandId = this.resolveHistoryBrandId(item, taskBrandMap)
        const tokenUsage = this.normalizeTokenUsage(item['tokenUsage'] || {})
        const refundRef = typeof item['metadata']?.['chargeUsageHistoryId'] === 'string'
          ? item['metadata']['chargeUsageHistoryId']
          : null

        return {
          id: item._id.toString(),
          userId: item.userId?.toString?.() || null,
          orgId: item.orgId?.toString?.() || null,
          videoTaskId: item['videoTaskId']?.toString?.() || null,
          type: item['type'],
          creditsConsumed: metrics.creditsConsumed,
          rawCreditsConsumed: this.normalizeNumber(item['creditsConsumed']),
          tokenUsage,
          packId: item['packId']?.toString?.() || null,
          brandId,
          brandName: brandId ? brandNameMap.get(brandId) || null : null,
          refunded: item.type === UsageHistoryType.VIDEO_REFUND
            ? true
            : refundedChargeIds.has(item._id.toString()),
          refundedAt: item.type === UsageHistoryType.VIDEO_REFUND
            ? item.createdAt
            : item['metadata']?.['refundedAt'] || null,
          refundOfUsageHistoryId: refundRef,
          metadata: item['metadata'] || {},
          createdAt: item.createdAt,
        }
      }),
    }
  }

  async getAccountOverview(scope: UsageScopeInput) {
    const packs = await this.videoPackModel.find(this.buildPackScopeQuery(scope))
      .sort({ purchasedAt: 1 })
      .lean()
      .exec()

    const visiblePacks = packs.filter(pack => pack.status !== PackStatus.REFUNDED)
    const balancePacks = visiblePacks.filter(pack => !this.isPackExpired(pack))
    const totals = balancePacks.reduce((acc, pack) => {
      acc.total += this.normalizeNumber(pack.totalCredits)
      acc.remaining += this.normalizeNumber(pack.remainingCredits)
      return acc
    }, { total: 0, remaining: 0 })

    const monthRange = this.getCurrentMonthRange()
    const currentPeriod = await this.getUsageSummary(scope, monthRange.start, monthRange.end)

    return {
      scope: this.serializeScope(scope),
      credits: {
        remaining: totals.remaining,
        used: Math.max(totals.total - totals.remaining, 0),
        total: totals.total,
      },
      packs: visiblePacks.map(pack => ({
        id: pack._id.toString(),
        packType: pack.packType,
        status: pack.status,
        totalCredits: pack.totalCredits,
        remainingCredits: pack.remainingCredits,
        usedCredits: Math.max(pack.totalCredits - pack.remainingCredits, 0),
        purchasedAt: pack.purchasedAt,
        expiresAt: pack.expiresAt,
        expired: this.isPackExpired(pack),
        paymentOrderId: pack.paymentOrderId,
      })),
      currentPeriod,
    }
  }

  async chargeVideo(
    userId: string,
    orgId: string | null | undefined,
    videoDurationSec: number,
    options: ChargeVideoOptions = {},
  ) {
    const units = this.resolveVideoCredits(videoDurationSec)
    const videoTaskObjectId = options.videoTaskId
      ? this.toObjectId(options.videoTaskId, 'videoTaskId')
      : null

    if (videoTaskObjectId) {
      const existingCharge = await this.findExistingVideoCharge(videoTaskObjectId.toString())
      if (existingCharge) {
        return existingCharge
      }
    }

    const packs = await this.videoPackModel.find({
      ...this.buildPackScopeQuery({ userId, orgId }),
      status: { $in: [PackStatus.ACTIVE, PackStatus.DEPLETED] },
      remainingCredits: { $gt: 0 },
      $or: [
        { expiresAt: null },
        { expiresAt: { $gt: new Date() } },
      ],
    })
      .sort({ purchasedAt: 1, _id: 1 })
      .lean()
      .exec()

    let remainingUnits = units
    const packAllocations: Array<{ packId: string, units: number }> = []
    const touchedPackIds = new Set<string>()

    try {
      for (const pack of packs) {
        if (remainingUnits <= 0) {
          break
        }

        const availableUnits = this.normalizeNumber(pack.remainingCredits)
        if (availableUnits <= 0) {
          continue
        }

        const allocationUnits = Math.min(availableUnits, remainingUnits)
        const updatedPack = await this.videoPackModel.findOneAndUpdate(
          {
            _id: pack._id,
            remainingCredits: { $gte: allocationUnits },
            $or: [
              { expiresAt: null },
              { expiresAt: { $gt: new Date() } },
            ],
          },
          {
            $inc: { remainingCredits: -allocationUnits },
          },
          { new: true },
        ).exec()

        if (!updatedPack) {
          continue
        }

        remainingUnits -= allocationUnits
        packAllocations.push({
          packId: updatedPack._id.toString(),
          units: allocationUnits,
        })
        touchedPackIds.add(updatedPack._id.toString())
      }

      if (remainingUnits > 0) {
        for (const allocation of packAllocations) {
          await this.restorePackCredits(allocation.packId, allocation.units)
        }
        throw new InsufficientCreditsError(units)
      }

      const usageHistories: UsageHistory[] = []
      try {
        for (const [index, allocation] of packAllocations.entries()) {
          const history = await this.usageHistoryModel.create({
            userId: this.toObjectId(userId, 'userId'),
            orgId: this.toOptionalObjectId(orgId),
            videoTaskId: videoTaskObjectId,
            type: UsageHistoryType.VIDEO_CHARGE,
            creditsConsumed: allocation.units,
            tokenUsage: this.emptyTokenUsage(),
            packId: this.toObjectId(allocation.packId, 'packId'),
            metadata: {
              ...(options.metadata || {}),
              videoDurationSec,
              allocationIndex: index,
              chargedAt: new Date().toISOString(),
            },
          })
          usageHistories.push(history)
        }
      }
      catch (error) {
        for (const allocation of packAllocations) {
          await this.restorePackCredits(allocation.packId, allocation.units)
        }
        for (const history of usageHistories) {
          await this.usageHistoryModel.findByIdAndDelete(history._id).exec().catch(() => undefined)
        }
        throw error
      }

      await Promise.all([...touchedPackIds].map(packId => this.syncPackStatus(packId)))

      return {
        usageHistoryId: usageHistories[0]?._id?.toString() || null,
        usageHistoryIds: usageHistories.map(item => item._id.toString()),
        packId: packAllocations[0]?.packId || null,
        packIds: [...new Set(packAllocations.map(item => item.packId))],
        units,
        allocations: usageHistories.map((history, index) => ({
          packId: packAllocations[index]?.packId || '',
          usageHistoryId: history._id.toString(),
          units: packAllocations[index]?.units || 0,
        })),
      }
    }
    catch (error) {
      for (const packId of touchedPackIds) {
        await this.syncPackStatus(packId).catch(() => undefined)
      }
      throw error
    }
  }

  async refundVideo(usageHistoryId: string, metadata: Record<string, any> = {}) {
    const history = await this.usageHistoryModel.findById(
      this.toObjectId(usageHistoryId, 'usageHistoryId'),
    ).exec()

    if (!history) {
      return {
        refunded: false,
        usageHistoryId: null,
        refundUsageHistoryId: null,
        packId: null,
        units: 0,
      }
    }

    if (history.type !== UsageHistoryType.VIDEO_CHARGE) {
      throw new BadRequestException('Only video charge records can be refunded')
    }

    const existingRefund = await this.usageHistoryModel.findOne({
      type: UsageHistoryType.VIDEO_REFUND,
      'metadata.chargeUsageHistoryId': history._id.toString(),
    }).lean().exec()

    if (existingRefund) {
      return {
        refunded: false,
        usageHistoryId: history._id.toString(),
        refundUsageHistoryId: existingRefund._id.toString(),
        packId: history.packId?.toString?.() || null,
        units: this.normalizeNumber(history['creditsConsumed']),
      }
    }

    if (!history.packId) {
      this.logger.warn(`Usage history ${history._id.toString()} has no packId for refund`)
      return {
        refunded: false,
        usageHistoryId: history._id.toString(),
        refundUsageHistoryId: null,
        packId: null,
        units: this.normalizeNumber(history['creditsConsumed']),
      }
    }

    await this.restorePackCredits(history.packId.toString(), this.normalizeNumber(history['creditsConsumed']))

    const refundedAt = new Date()
    const refundHistory = await this.usageHistoryModel.create({
      userId: history.userId,
      orgId: history.orgId || null,
      videoTaskId: history.videoTaskId || null,
      type: UsageHistoryType.VIDEO_REFUND,
      creditsConsumed: this.normalizeNumber(history['creditsConsumed']),
      tokenUsage: this.emptyTokenUsage(),
      packId: history.packId,
      metadata: {
        ...(history.metadata || {}),
        ...metadata,
        chargeUsageHistoryId: history._id.toString(),
        refundedAt: refundedAt.toISOString(),
      },
    })

    await this.syncPackStatus(history.packId.toString())

    return {
      refunded: true,
      usageHistoryId: history._id.toString(),
      refundUsageHistoryId: refundHistory._id.toString(),
      packId: history.packId.toString(),
      units: this.normalizeNumber(history['creditsConsumed']),
    }
  }

  async refundVideoCharge(
    userId: string,
    orgId: string | null | undefined,
    videoTaskId: string,
    metadata: Record<string, any> = {},
  ) {
    const charges = await this.usageHistoryModel.find({
      videoTaskId: this.toObjectId(videoTaskId, 'videoTaskId'),
      type: UsageHistoryType.VIDEO_CHARGE,
    }).sort({ createdAt: 1 }).exec()

    if (charges.length === 0) {
      return {
        refunded: false,
        usageHistoryIds: [],
        refundUsageHistoryIds: [],
        packIds: [],
        units: 0,
      }
    }

    const results = [] as Array<{
      refunded: boolean
      usageHistoryId: string | null
      refundUsageHistoryId: string | null
      packId: string | null
      units: number
    }>

    for (const charge of charges) {
      results.push(await this.refundVideo(charge._id.toString(), {
        ...metadata,
        refundedByUserId: userId,
        refundedOrgId: orgId || null,
        videoTaskId,
      }))
    }

    return {
      refunded: results.some(item => item.refunded),
      usageHistoryIds: results.map(item => item.usageHistoryId).filter((item): item is string => Boolean(item)),
      refundUsageHistoryIds: results.map(item => item.refundUsageHistoryId).filter((item): item is string => Boolean(item)),
      packIds: [...new Set(results.map(item => item.packId).filter((item): item is string => Boolean(item)))],
      units: results.reduce((sum, item) => sum + item.units, 0),
    }
  }

  private buildApiUsageQuery(orgId: string, period: UsagePeriodInput) {
    if (!Types.ObjectId.isValid(orgId)) {
      throw new BadRequestException('Invalid orgId')
    }

    const query: Record<string, any> = {
      orgId: new Types.ObjectId(orgId),
    }

    if (period.startDate || period.endDate) {
      query['date'] = {}

      if (period.startDate) {
        query['date']['$gte'] = this.normalizeApiDateKey(period.startDate)
      }

      if (period.endDate) {
        query['date']['$lte'] = this.normalizeApiDateKey(period.endDate)
      }
    }

    return query
  }

  private buildHistoryQuery(
    scope: UsageScopeInput,
    period: UsagePeriodInput,
    type?: UsageHistoryType,
  ) {
    const query: Record<string, any> = this.buildHistoryScopeQuery(scope)
    const normalizedPeriod = this.normalizeHistoryPeriod(period)

    if (normalizedPeriod.start || normalizedPeriod.end) {
      query['createdAt'] = {}
      if (normalizedPeriod.start) {
        query['createdAt']['$gte'] = normalizedPeriod.start
      }
      if (normalizedPeriod.end) {
        query['createdAt']['$lte'] = normalizedPeriod.end
      }
    }

    if (type) {
      query['type'] = this.normalizeUsageType(type)
    }

    return query
  }

  private buildHistoryScopeQuery(scope: UsageScopeInput) {
    const normalizedOrgId = this.toOptionalObjectId(scope.orgId)
    if (normalizedOrgId) {
      return { orgId: normalizedOrgId }
    }

    return { userId: this.toObjectId(scope.userId, 'userId') }
  }

  private buildPackScopeQuery(scope: UsageScopeInput) {
    const normalizedOrgId = this.toOptionalObjectId(scope.orgId)
    if (normalizedOrgId) {
      return { orgId: normalizedOrgId }
    }

    if (!scope.userId?.trim()) {
      throw new BadRequestException('userId is required')
    }

    return { userId: scope.userId }
  }

  private async loadBrandContext(histories: Array<Record<string, any>>) {
    const taskIds = [...new Set(
      histories
        .map(history => history['videoTaskId']?.toString?.() || null)
        .filter((value): value is string => Boolean(value && Types.ObjectId.isValid(value))),
    )]

    const taskBrandMap = new Map<string, string | null>()
    if (taskIds.length > 0) {
      const tasks = await this.videoTaskModel.find({
        _id: { $in: taskIds.map(id => new Types.ObjectId(id)) },
      })
        .select({ _id: 1, brandId: 1 })
        .lean()
        .exec()

      for (const task of tasks) {
        taskBrandMap.set(
          task._id.toString(),
          task.brandId?.toString?.() || null,
        )
      }
    }

    const metadataBrandIds = histories
      .map(history => this.readMetadataBrandId(history['metadata']))
      .filter((value): value is string => Boolean(value))
    const taskBrandIds = [...taskBrandMap.values()].filter((value): value is string => Boolean(value))
    const brandIds = [...new Set([...metadataBrandIds, ...taskBrandIds])]

    const brandNameMap = new Map<string, string>()
    if (brandIds.length > 0) {
      const brands = await this.brandModel.find({
        _id: { $in: brandIds.map(id => new Types.ObjectId(id)) },
      })
        .select({ _id: 1, name: 1 })
        .lean()
        .exec()

      for (const brand of brands) {
        brandNameMap.set(brand._id.toString(), brand.name)
      }
    }

    return { taskBrandMap, brandNameMap }
  }

  private resolveHistoryBrandId(history: Record<string, any>, taskBrandMap: Map<string, string | null>) {
    const metadataBrandId = this.readMetadataBrandId(history['metadata'])
    if (metadataBrandId) {
      return metadataBrandId
    }

    const taskId = history['videoTaskId']?.toString?.()
    if (!taskId) {
      return null
    }

    return taskBrandMap.get(taskId) || null
  }

  private extractUsageMetrics(history: Record<string, any>): UsageMetricBucket {
    const tokenUsage = this.normalizeTokenUsage(history['tokenUsage'] || {})

    return {
      creditsConsumed: this.resolveSignedCredits(history),
      inputTokens: tokenUsage.inputTokens,
      outputTokens: tokenUsage.outputTokens,
      totalTokens: tokenUsage.totalTokens,
      tokenCost: tokenUsage.cost,
      recordCount: 1,
    }
  }

  private createMetricBucket(): UsageMetricBucket {
    return {
      creditsConsumed: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      tokenCost: 0,
      recordCount: 0,
    }
  }

  private accumulateMetric(target: UsageMetricBucket, value: UsageMetricBucket) {
    target.creditsConsumed += value.creditsConsumed
    target.inputTokens += value.inputTokens
    target.outputTokens += value.outputTokens
    target.totalTokens += value.totalTokens
    target.tokenCost = Number((target.tokenCost + value.tokenCost).toFixed(6))
    target.recordCount += value.recordCount
  }

  private serializeMetricBucket(bucket: UsageMetricBucket) {
    return {
      creditsConsumed: bucket.creditsConsumed,
      inputTokens: bucket.inputTokens,
      outputTokens: bucket.outputTokens,
      totalTokens: bucket.totalTokens,
      tokenCost: Number(bucket.tokenCost.toFixed(6)),
      recordCount: bucket.recordCount,
    }
  }

  private normalizeHistoryPeriod(period: UsagePeriodInput) {
    return {
      start: period.startDate ? this.toDate(period.startDate, 'startDate') : null,
      end: period.endDate ? this.toDate(period.endDate, 'endDate') : null,
    }
  }

  private serializePeriod(startDate?: string | Date, endDate?: string | Date) {
    return {
      startDate: startDate ? this.toDate(startDate, 'startDate').toISOString() : null,
      endDate: endDate ? this.toDate(endDate, 'endDate').toISOString() : null,
    }
  }

  private toPeriodStart(dateInput: Date | string, granularity: 'day' | 'week' | 'month') {
    const date = new Date(dateInput)
    const utc = new Date(Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      0,
      0,
      0,
      0,
    ))

    if (granularity === 'month') {
      utc.setUTCDate(1)
      return utc
    }

    if (granularity === 'week') {
      const day = utc.getUTCDay()
      const offset = day === 0 ? -6 : 1 - day
      utc.setUTCDate(utc.getUTCDate() + offset)
      return utc
    }

    return utc
  }

  private normalizeGranularity(granularity: 'day' | 'week' | 'month') {
    if (!['day', 'week', 'month'].includes(granularity)) {
      throw new BadRequestException('granularity must be day, week, or month')
    }

    return granularity
  }

  private resolveVideoCredits(videoDurationSec: number) {
    const duration = this.normalizePositiveNumber(videoDurationSec, 'videoDurationSec')
    if (duration > 60) {
      throw new BadRequestException('videoDurationSec cannot exceed 60 seconds')
    }
    if (duration <= 15) {
      return 1
    }
    if (duration <= 30) {
      return 2
    }

    return 4
  }

  private emptyTokenUsage() {
    return {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      model: '',
      provider: '',
      cost: 0,
      estimated: false,
    }
  }

  private normalizeTokenUsage(tokenUsage: TokenUsageInput | Record<string, any>) {
    const inputTokens = this.normalizeNumber(tokenUsage['inputTokens'])
    const outputTokens = this.normalizeNumber(tokenUsage['outputTokens'])
    const totalTokens = Math.max(
      this.normalizeNumber(tokenUsage['totalTokens']),
      inputTokens + outputTokens,
    )

    return {
      inputTokens,
      outputTokens,
      totalTokens,
      model: typeof tokenUsage['model'] === 'string' ? tokenUsage['model'].trim() : '',
      provider: typeof tokenUsage['provider'] === 'string' ? tokenUsage['provider'].trim() : '',
      cost: Number(this.normalizeNumber(tokenUsage['cost']).toFixed(6)),
      estimated: Boolean(tokenUsage['estimated']),
    }
  }

  private resolveSignedCredits(history: Record<string, any>) {
    const credits = this.normalizeNumber(history['creditsConsumed'])
    return history['type'] === UsageHistoryType.VIDEO_REFUND ? -credits : credits
  }

  private normalizeUsageType(type: UsageHistoryType) {
    if (!Object.values(UsageHistoryType).includes(type)) {
      throw new BadRequestException('Invalid usage type')
    }

    return type
  }

  private normalizePage(page?: number) {
    return Math.max(1, Math.trunc(Number(page) || 1))
  }

  private normalizeLimit(limit?: number) {
    return Math.max(1, Math.min(Math.trunc(Number(limit) || 20), 100))
  }

  private getCurrentMonthRange() {
    const start = new Date()
    start.setUTCDate(1)
    start.setUTCHours(0, 0, 0, 0)

    return {
      start,
      end: new Date(),
    }
  }

  private async restorePackCredits(packId: string, credits: number) {
    const pack = await this.videoPackModel.findByIdAndUpdate(
      this.toObjectId(packId, 'packId'),
      {
        $inc: { remainingCredits: credits },
      },
      { new: true },
    ).exec()

    if (!pack) {
      this.logger.warn(`Unable to restore credits for missing pack ${packId}`)
      return null
    }

    await this.syncPackStatus(pack._id.toString())
    return pack
  }

  private async syncPackStatus(packId: string) {
    const pack = await this.videoPackModel.findById(this.toObjectId(packId, 'packId')).exec()
    if (!pack) {
      return null
    }

    const nextStatus = this.resolvePackStatus(pack)
    if (nextStatus !== pack.status) {
      await this.videoPackModel.findByIdAndUpdate(pack._id, {
        $set: { status: nextStatus },
      }).exec()
      pack.status = nextStatus
    }

    return pack
  }

  private resolvePackStatus(pack: VideoPack | Record<string, any>) {
    if (pack.expiresAt && new Date(pack.expiresAt).getTime() <= Date.now()) {
      return PackStatus.EXPIRED
    }

    return this.normalizeNumber(pack.remainingCredits) > 0
      ? PackStatus.ACTIVE
      : PackStatus.DEPLETED
  }

  private isPackExpired(pack: Pick<VideoPack, 'expiresAt'> | Record<string, any>) {
    if (!pack.expiresAt) {
      return false
    }

    return new Date(pack.expiresAt).getTime() <= Date.now()
  }

  private async findExistingVideoCharge(videoTaskId: string) {
    const charges = await this.usageHistoryModel.find({
      videoTaskId: this.toObjectId(videoTaskId, 'videoTaskId'),
      type: UsageHistoryType.VIDEO_CHARGE,
    })
      .sort({ createdAt: 1 })
      .lean()
      .exec()

    if (charges.length === 0) {
      return null
    }

    const chargeIds = charges.map(item => item._id.toString())
    const refundedChargeIds = await this.findRefundedChargeIds(chargeIds)
    const activeCharges = charges.filter(item => !refundedChargeIds.has(item._id.toString()))
    if (activeCharges.length === 0) {
      return null
    }

    return {
      usageHistoryId: activeCharges[0]?._id?.toString() || null,
      usageHistoryIds: activeCharges.map(item => item._id.toString()),
      packId: activeCharges[0]?.packId?.toString?.() || null,
      packIds: [...new Set(activeCharges.map(item => item.packId?.toString?.()).filter((item): item is string => Boolean(item)))],
      units: activeCharges.reduce((sum, item) => sum + this.normalizeNumber(item.creditsConsumed), 0),
      allocations: activeCharges.map(item => ({
        packId: item.packId?.toString?.() || '',
        usageHistoryId: item._id.toString(),
        units: this.normalizeNumber(item.creditsConsumed),
      })),
    }
  }

  private async findRefundedChargeIds(chargeIds: string[]) {
    const refunds = await this.usageHistoryModel.find({
      type: UsageHistoryType.VIDEO_REFUND,
      'metadata.chargeUsageHistoryId': { $in: chargeIds },
    })
      .select({ metadata: 1 })
      .lean()
      .exec()

    return new Set(
      refunds
        .map(item => item['metadata']?.['chargeUsageHistoryId'])
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0),
    )
  }

  private normalizeNumber(value: unknown) {
    const normalized = Number(value || 0)
    return Number.isFinite(normalized) ? normalized : 0
  }

  private normalizePositiveNumber(value: unknown, field: string) {
    const normalized = this.normalizeNumber(value)
    if (normalized <= 0) {
      throw new BadRequestException(`${field} must be greater than 0`)
    }

    return normalized
  }

  private readMetadataBrandId(metadata: Record<string, any> | undefined) {
    const brandId = typeof metadata?.['brandId'] === 'string'
      ? metadata['brandId'].trim()
      : ''

    return Types.ObjectId.isValid(brandId) ? brandId : null
  }

  private toObjectId(value: string, field: string) {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`${field} is invalid`)
    }

    return new Types.ObjectId(value)
  }

  private toOptionalObjectId(value: string | null | undefined) {
    return value && Types.ObjectId.isValid(value)
      ? new Types.ObjectId(value)
      : null
  }

  private resolveObjectIdCandidate(values: unknown[]) {
    for (const value of values) {
      if (typeof value === 'string' && Types.ObjectId.isValid(value)) {
        return new Types.ObjectId(value)
      }
      if (value instanceof Types.ObjectId) {
        return value
      }
    }

    return null
  }

  private toDate(value: string | Date, field: string) {
    const date = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${field} is invalid`)
    }

    return date
  }

  private toDateKey(value: string | Date) {
    const date = this.toDate(value, 'date')
    const year = date.getUTCFullYear()
    const month = `${date.getUTCMonth() + 1}`.padStart(2, '0')
    const day = `${date.getUTCDate()}`.padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  private normalizeApiDateKey(value: string | Date) {
    return this.toDateKey(value)
  }

  private normalizeApiKey(apiKey: string) {
    return apiKey.trim().slice(0, 128)
  }

  private serializeScope(scope: UsageScopeInput) {
    return {
      userId: scope.userId,
      orgId: scope.orgId || null,
    }
  }
}
