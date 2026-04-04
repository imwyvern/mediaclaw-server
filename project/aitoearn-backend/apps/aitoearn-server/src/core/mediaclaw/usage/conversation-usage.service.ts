import { BadRequestException, Injectable, Optional } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import {
  BillingMode,
  ConversationIntent,
  ConversationUsage,
  NotificationEvent,
  OrgType,
  Organization,
  Subscription,
  SubscriptionPlan,
  SubscriptionStatus,
} from '@yikart/mongodb'
import { Model, Types } from 'mongoose'
import { NotificationService } from '../notification/notification.service'

interface ConversationUsageScope {
  userId: string
  orgId?: string | null
}

interface TrackConversationInput {
  sessionId?: string
  model?: string
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  estimatedCost?: number
  intent?: string
  createdAt?: string | Date
}

interface ConversationDetailInput {
  page?: number
  limit?: number
}

interface ConversationSummaryTotals {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  estimatedCost: number
  records: number
}

interface ConversationSummaryRow extends ConversationSummaryTotals {
  _id: null
}

interface ConversationModelBreakdownRow extends ConversationSummaryTotals {
  _id: string
}

interface ConversationQuotaSummary {
  isUnlimited: boolean
  total: number | null
  used: number
  remaining: number | null
  usageRate: number
  warningLevel: 'normal' | 'warning' | 'exceeded'
}

interface ConversationSummaryResponse {
  orgId: string
  period: {
    startAt: string
    endAt: string
    resetDay: number
  }
  quota: ConversationQuotaSummary
  totals: ConversationSummaryTotals
  byModel: Array<{
    model: string
    inputTokens: number
    outputTokens: number
    totalTokens: number
    estimatedCost: number
    records: number
    usageRate: number
  }>
}

@Injectable()
export class ConversationUsageService {
  constructor(
    @InjectModel(ConversationUsage.name)
    private readonly conversationUsageModel: Model<ConversationUsage>,
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<Organization>,
    @InjectModel(Subscription.name)
    private readonly subscriptionModel: Model<Subscription>,
    @Optional()
    private readonly notificationService?: NotificationService,
  ) {}

  async track(scope: ConversationUsageScope, input: TrackConversationInput) {
    const orgId = this.resolveScopedOrgId(scope)
    const userObjectId = this.toObjectId(scope.userId, 'userId')
    const organization = await this.requireOrganization(orgId)
    const usageDate = this.normalizeDate(input.createdAt)
    const totalTokens = this.resolveTotalTokens(input)
    const created = await this.conversationUsageModel.create({
      orgId: this.toObjectId(orgId, 'orgId'),
      userId: userObjectId,
      sessionId: input.sessionId?.trim() || '',
      model: input.model?.trim() || 'deepseek-v3',
      inputTokens: this.normalizeCount(input.inputTokens),
      outputTokens: this.normalizeCount(input.outputTokens),
      totalTokens,
      estimatedCost: this.normalizeCurrency(
        typeof input.estimatedCost === 'number'
          ? input.estimatedCost
          : this.estimateConversationCost(input.model, totalTokens),
      ),
      intent: this.normalizeIntent(input.intent),
      createdAt: usageDate,
      updatedAt: usageDate,
    })

    const summary = await this.getConversationSummary(scope)
    await this.syncOrganizationUsageState(organization, summary)
    await this.maybeNotifyQuota(organization, summary)

    return {
      id: created._id.toString(),
      model: created.model,
      sessionId: created.sessionId,
      totalTokens: created.totalTokens,
      estimatedCost: created.estimatedCost,
      quota: summary.quota,
    }
  }

  async getConversationSummary(scope: ConversationUsageScope) {
    const orgId = this.resolveScopedOrgId(scope)
    const organization = await this.requireOrganization(orgId)
    const cycle = this.getCurrentCycle(organization.tokenQuotaResetDay)
    const orgObjectId = this.toObjectId(orgId, 'orgId')

    const [summary] = await this.conversationUsageModel.aggregate<ConversationSummaryRow>([
      {
        $match: {
          orgId: orgObjectId,
          createdAt: {
            $gte: cycle.start,
            $lt: cycle.end,
          },
        },
      },
      {
        $group: {
          _id: null,
          inputTokens: { $sum: '$inputTokens' },
          outputTokens: { $sum: '$outputTokens' },
          totalTokens: { $sum: '$totalTokens' },
          estimatedCost: { $sum: '$estimatedCost' },
          records: { $sum: 1 },
        },
      },
    ])

    const totals = this.normalizeSummaryTotals(summary)
    const quota = await this.resolveQuota(organization)

    return {
      orgId,
      period: {
        startAt: cycle.start.toISOString(),
        endAt: cycle.end.toISOString(),
        resetDay: cycle.resetDay,
      },
      quota: this.buildQuotaSummary(quota, totals.totalTokens),
      totals,
      byModel: await this.getModelBreakdown(scope, cycle.start, cycle.end),
    }
  }

  async getConversationDetail(scope: ConversationUsageScope, input: ConversationDetailInput = {}) {
    const orgId = this.resolveScopedOrgId(scope)
    const organization = await this.requireOrganization(orgId)
    const cycle = this.getCurrentCycle(organization.tokenQuotaResetDay)
    const page = this.normalizePage(input.page)
    const limit = this.normalizeLimit(input.limit)
    const skip = (page - 1) * limit
    const query = {
      orgId: this.toObjectId(orgId, 'orgId'),
      createdAt: {
        $gte: cycle.start,
        $lt: cycle.end,
      },
    }

    const [items, total] = await Promise.all([
      this.conversationUsageModel.find(query)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.conversationUsageModel.countDocuments(query),
    ])

    return {
      items: items.map(item => ({
        id: item._id.toString(),
        sessionId: item.sessionId || '',
        model: item.model,
        inputTokens: this.normalizeCount(item.inputTokens),
        outputTokens: this.normalizeCount(item.outputTokens),
        totalTokens: this.normalizeCount(item.totalTokens),
        estimatedCost: this.normalizeCurrency(item.estimatedCost),
        intent: item.intent,
        createdAt: item.createdAt,
      })),
      total,
      page,
      limit,
    }
  }

  async getModelBreakdown(
    scope: ConversationUsageScope,
    startDate?: Date,
    endDate?: Date,
  ) {
    const orgId = this.resolveScopedOrgId(scope)
    const organization = await this.requireOrganization(orgId)
    const cycle = startDate && endDate
      ? {
          start: startDate,
          end: endDate,
          resetDay: this.normalizeResetDay(organization.tokenQuotaResetDay),
        }
      : this.getCurrentCycle(organization.tokenQuotaResetDay)
    const orgObjectId = this.toObjectId(orgId, 'orgId')

    const rows = await this.conversationUsageModel.aggregate<ConversationModelBreakdownRow>([
      {
        $match: {
          orgId: orgObjectId,
          createdAt: {
            $gte: cycle.start,
            $lt: cycle.end,
          },
        },
      },
      {
        $group: {
          _id: '$model',
          inputTokens: { $sum: '$inputTokens' },
          outputTokens: { $sum: '$outputTokens' },
          totalTokens: { $sum: '$totalTokens' },
          estimatedCost: { $sum: '$estimatedCost' },
          records: { $sum: 1 },
        },
      },
      { $sort: { totalTokens: -1, _id: 1 } },
    ])

    const totalTokens = rows.reduce((sum, item) => sum + this.normalizeCount(item.totalTokens), 0)

    return rows.map(item => ({
      model: item._id || 'unknown',
      inputTokens: this.normalizeCount(item.inputTokens),
      outputTokens: this.normalizeCount(item.outputTokens),
      totalTokens: this.normalizeCount(item.totalTokens),
      estimatedCost: this.normalizeCurrency(item.estimatedCost),
      records: this.normalizeCount(item.records),
      usageRate: totalTokens > 0
        ? Number(((this.normalizeCount(item.totalTokens) / totalTokens) * 100).toFixed(2))
        : 0,
    }))
  }

  private async resolveQuota(organization: Organization) {
    if (organization.billingMode === BillingMode.BYOK) {
      return {
        isUnlimited: true,
        total: null as number | null,
      }
    }

    const storedQuota = this.normalizeCount(organization.monthlyTokenQuota)
    if (storedQuota > 0) {
      return {
        isUnlimited: false,
        total: storedQuota,
      }
    }

    const subscription = await this.subscriptionModel.findOne({
      orgId: organization._id,
      status: SubscriptionStatus.ACTIVE,
    }, {
      plan: 1,
    }).sort({ createdAt: -1 }).lean().exec()

    const fallback = this.resolvePlanQuota({
      subscriptionPlan: subscription?.plan || null,
      orgType: organization.type,
      planId: organization.planId,
    })

    return {
      isUnlimited: false,
      total: fallback,
    }
  }

  private buildQuotaSummary(
    quota: {
      isUnlimited: boolean
      total: number | null
    },
    usedTokens: number,
  ): ConversationQuotaSummary {
    if (quota.isUnlimited || quota.total === null) {
      return {
        isUnlimited: true,
        total: null,
        used: usedTokens,
        remaining: null,
        usageRate: 0,
        warningLevel: 'normal' as const,
      }
    }

    const remaining = Math.max(quota.total - usedTokens, 0)
    const usageRate = quota.total > 0
      ? Number(((usedTokens / quota.total) * 100).toFixed(2))
      : 0

    return {
      isUnlimited: false,
      total: quota.total,
      used: usedTokens,
      remaining,
      usageRate,
      warningLevel: usageRate >= 100 ? 'exceeded' : usageRate >= 80 ? 'warning' : 'normal',
    }
  }

  private async syncOrganizationUsageState(
    organization: Organization,
    summary: {
      quota: {
        total: number | null
      }
      totals: ConversationSummaryTotals
    },
  ) {
    const updates: Record<string, unknown> = {
      currentMonthTokens: summary.totals.totalTokens,
    }

    if (summary.quota.total && summary.quota.total > 0 && this.normalizeCount(organization.monthlyTokenQuota) <= 0) {
      updates['monthlyTokenQuota'] = summary.quota.total
    }

    await this.organizationModel.findByIdAndUpdate(organization._id, {
      $set: updates,
    }).exec()
  }

  private async maybeNotifyQuota(
    organization: Organization,
    summary: ConversationSummaryResponse,
  ) {
    if (!this.notificationService || summary.quota.isUnlimited || !summary.quota.total) {
      return
    }

    const settings = this.readSettings(organization.settings)
    const billingAlerts = this.readSettings(settings['billingAlerts'])
    const cycleKey = summary.period.startAt
    const currentCycle = this.readSettings(billingAlerts['conversationTokens'])
    const nextCycleState = currentCycle['cycleKey'] === cycleKey
      ? currentCycle
      : { cycleKey, warningSentAt: '', exceededSentAt: '' }

    let nextEvent: NotificationEvent | null = null
    if (summary.quota.usageRate >= 100 && !this.readString(nextCycleState['exceededSentAt'])) {
      nextCycleState['exceededSentAt'] = new Date().toISOString()
      nextEvent = NotificationEvent.TOKEN_QUOTA_EXCEEDED
    }
    else if (summary.quota.usageRate >= 80 && !this.readString(nextCycleState['warningSentAt'])) {
      nextCycleState['warningSentAt'] = new Date().toISOString()
      nextEvent = NotificationEvent.TOKEN_QUOTA_WARNING
    }

    if (!nextEvent) {
      return
    }

    settings['billingAlerts'] = {
      ...billingAlerts,
      conversationTokens: nextCycleState,
    }

    await this.organizationModel.findByIdAndUpdate(organization._id, {
      $set: {
        settings,
      },
    }).exec()

    await this.notificationService.sendNotification(
      organization._id.toString(),
      nextEvent,
      {
        relatedId: organization._id.toString(),
        totalTokens: summary.quota.total,
        usedTokens: summary.quota.used,
        usageRate: summary.quota.usageRate,
      },
    )
  }

  private resolvePlanQuota(input: {
    subscriptionPlan?: SubscriptionPlan | null
    orgType?: OrgType | null
    planId?: string | null
  }) {
    if (input.subscriptionPlan === SubscriptionPlan.FLAGSHIP) {
      return 2_000_000
    }
    if (input.subscriptionPlan === SubscriptionPlan.PRO) {
      return 500_000
    }
    if (input.subscriptionPlan === SubscriptionPlan.TEAM) {
      return 200_000
    }

    if (input.orgType === OrgType.ENTERPRISE) {
      return 2_000_000
    }
    if (input.orgType === OrgType.PROFESSIONAL) {
      return 500_000
    }
    if (input.orgType === OrgType.TEAM) {
      return 200_000
    }

    const normalizedPlanId = input.planId?.trim().toLowerCase() || ''
    if (normalizedPlanId.includes('enterprise') || normalizedPlanId.includes('flagship')) {
      return 2_000_000
    }
    if (normalizedPlanId.includes('pro') || normalizedPlanId.includes('professional')) {
      return 500_000
    }
    if (normalizedPlanId.includes('growth') || normalizedPlanId.includes('team')) {
      return 200_000
    }

    return 50_000
  }

  private normalizeSummaryTotals(
    summary?: Partial<ConversationSummaryTotals> | null,
  ): ConversationSummaryTotals {
    return {
      inputTokens: this.normalizeCount(summary?.inputTokens),
      outputTokens: this.normalizeCount(summary?.outputTokens),
      totalTokens: this.normalizeCount(summary?.totalTokens),
      estimatedCost: this.normalizeCurrency(summary?.estimatedCost),
      records: this.normalizeCount(summary?.records),
    }
  }

  private resolveTotalTokens(input: TrackConversationInput) {
    const totalTokens = this.normalizeCount(input.totalTokens)
    if (totalTokens > 0) {
      return totalTokens
    }

    return this.normalizeCount(input.inputTokens) + this.normalizeCount(input.outputTokens)
  }

  private normalizeIntent(value?: string | null) {
    const normalized = value?.trim().toLowerCase()
    if (
      normalized === ConversationIntent.CHAT
      || normalized === ConversationIntent.ORDER
      || normalized === ConversationIntent.QUERY
      || normalized === ConversationIntent.REVIEW
    ) {
      return normalized
    }

    return ConversationIntent.CHAT
  }

  private normalizeDate(value?: string | Date) {
    if (!value) {
      return new Date()
    }

    const date = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('createdAt is invalid')
    }

    return date
  }

  private getCurrentCycle(resetDayInput?: number | null) {
    const now = new Date()
    const resetDay = this.normalizeResetDay(resetDayInput)
    let start = this.buildCycleDate(now.getUTCFullYear(), now.getUTCMonth(), resetDay)

    if (now.getTime() < start.getTime()) {
      start = this.buildCycleDate(now.getUTCFullYear(), now.getUTCMonth() - 1, resetDay)
    }

    const end = this.buildCycleDate(start.getUTCFullYear(), start.getUTCMonth() + 1, resetDay)

    return {
      start,
      end,
      resetDay,
    }
  }

  private buildCycleDate(year: number, monthIndex: number, resetDay: number) {
    const base = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0))
    const lastDay = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate()
    return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), Math.min(resetDay, lastDay), 0, 0, 0, 0))
  }

  private normalizeResetDay(value?: number | null) {
    const normalized = Math.trunc(Number(value || 1))
    if (!Number.isFinite(normalized) || normalized < 1) {
      return 1
    }

    return Math.min(normalized, 28)
  }

  private estimateConversationCost(modelInput: string | undefined, totalTokens: number) {
    if (totalTokens <= 0) {
      return 0
    }

    const model = modelInput?.trim().toLowerCase() || ''
    const costPerMillion = model.includes('gpt-4o')
      ? 10
      : model.includes('gemini')
        ? 3
        : 1

    return Number(((totalTokens / 1_000_000) * costPerMillion).toFixed(6))
  }

  private readSettings(raw: unknown) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return {} as Record<string, unknown>
    }

    return { ...(raw as Record<string, unknown>) }
  }

  private readString(value: unknown) {
    return typeof value === 'string' ? value.trim() : ''
  }

  private async requireOrganization(orgId: string) {
    const organization = await this.organizationModel.findById(this.toObjectId(orgId, 'orgId')).exec()
    if (!organization) {
      throw new BadRequestException('Organization not found')
    }

    return organization
  }

  private resolveScopedOrgId(scope: ConversationUsageScope) {
    return scope.orgId || scope.userId
  }

  private normalizePage(value?: number) {
    const normalized = Math.trunc(Number(value || 1))
    if (!Number.isFinite(normalized) || normalized <= 0) {
      return 1
    }
    return normalized
  }

  private normalizeLimit(value?: number) {
    const normalized = Math.trunc(Number(value || 20))
    if (!Number.isFinite(normalized) || normalized <= 0) {
      return 20
    }
    return Math.min(normalized, 100)
  }

  private normalizeCount(value: unknown) {
    const normalized = Math.trunc(Number(value || 0))
    if (!Number.isFinite(normalized) || normalized <= 0) {
      return 0
    }

    return normalized
  }

  private normalizeCurrency(value: unknown) {
    const normalized = Number(value || 0)
    if (!Number.isFinite(normalized) || normalized <= 0) {
      return 0
    }

    return Number(normalized.toFixed(6))
  }

  private toObjectId(value: string, field: string) {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`${field} is invalid`)
    }

    return new Types.ObjectId(value)
  }
}
