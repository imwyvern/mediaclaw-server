import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Cron } from '@nestjs/schedule'
import {
  SlaBreachRecord,
  SlaReport,
  SlaScopeType,
  Subscription,
  SubscriptionPlan,
  SubscriptionStatus,
} from '@yikart/mongodb'
import { Model } from 'mongoose'
import { MonitoringMetricsService } from './monitoring-metrics.service'

interface SlaPolicy {
  tier: string
  uptimeTarget: number
  maxHttpErrorRate: number
  maxVideoFailureRate: number
  maxQueueDepth: number
  maxQueueLatencyMs: number
  responseTimeHours: number
  maxCreditPercent: number
  description: string
}

interface EvaluateSlaOptions {
  windowStart?: string
  windowEnd?: string
}

@Injectable()
export class SlaService {
  private readonly logger = new Logger(SlaService.name)

  constructor(
    @InjectModel(Subscription.name)
    private readonly subscriptionModel: Model<Subscription>,
    @InjectModel(SlaReport.name)
    private readonly slaReportModel: Model<SlaReport>,
    private readonly monitoringMetricsService: MonitoringMetricsService,
  ) {}

  async getCurrentSla(scope: { orgId?: string | null, userId: string }) {
    const resolved = await this.resolveScope(scope)
    const latestReport = await this.slaReportModel.findOne({
      scopeType: resolved.scopeType,
      scopeId: resolved.scopeId,
    })
      .sort({ createdAt: -1 })
      .lean()
      .exec()

    return {
      scopeType: resolved.scopeType,
      scopeId: resolved.scopeId,
      plan: resolved.plan,
      policy: resolved.policy,
      latestReport: latestReport
        ? this.toReportResponse(latestReport)
        : null,
      claimEligible: Boolean(latestReport?.totalCompensationAmountCents),
    }
  }

  async evaluateCurrentSla(
    scope: { orgId?: string | null, userId: string },
    options: EvaluateSlaOptions = {},
  ) {
    const resolved = await this.resolveScope(scope)
    await this.monitoringMetricsService.captureQueueMetrics()
    const snapshot = this.monitoringMetricsService.getOperationalSnapshot()
    const window = this.resolveWindow(resolved.subscription, options)
    const breaches = this.buildBreaches(snapshot, resolved.policy)
    const totalCompensationPercent = Math.min(
      resolved.policy.maxCreditPercent,
      breaches.reduce((sum, breach) => sum + breach.compensationPercent, 0),
    )
    const totalCompensationAmountCents = Math.round(
      (resolved.monthlyFeeCents * totalCompensationPercent) / 100,
    )

    const created = await this.slaReportModel.create({
      scopeType: resolved.scopeType,
      scopeId: resolved.scopeId,
      plan: resolved.plan,
      tier: resolved.policy.tier,
      windowStart: window.start,
      windowEnd: window.end,
      monthlyFeeCents: resolved.monthlyFeeCents,
      measurementMethod: 'http_availability_proxy',
      metrics: {
        uptimeRatio: Math.max(0, 1 - snapshot.http.errorRate),
        httpErrorRate: snapshot.http.errorRate,
        videoFailureRate: snapshot.video.failureRate,
        queueDepth: snapshot.queue.depth,
        queueLatency: snapshot.queue.latency,
      },
      breaches,
      totalCompensationPercent,
      totalCompensationAmountCents,
    })

    return this.toReportResponse(
      typeof created.toObject === 'function' ? created.toObject() : created,
    )
  }

  async listHistory(
    scope: { orgId?: string | null, userId: string },
    limit: number | string = 12,
  ) {
    const resolved = await this.resolveScope(scope)
    const normalizedLimit = this.normalizeLimit(limit)
    const items = await this.slaReportModel.find({
      scopeType: resolved.scopeType,
      scopeId: resolved.scopeId,
    })
      .sort({ createdAt: -1 })
      .limit(normalizedLimit)
      .lean()
      .exec()

    return {
      scopeType: resolved.scopeType,
      scopeId: resolved.scopeId,
      plan: resolved.plan,
      items: items.map(item => this.toReportResponse(item)),
    }
  }

  @Cron('15 * * * *')
  async captureActiveSubscriptionSnapshots() {
    const subscriptions = await this.subscriptionModel.find({
      status: { $in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE] },
    })
      .select({ orgId: 1, currentPeriodStart: 1, currentPeriodEnd: 1 })
      .lean()
      .exec()

    const results = await Promise.allSettled(
      subscriptions.map(subscription =>
        this.evaluateCurrentSla(
          {
            orgId: subscription.orgId?.toString?.() || '',
            userId: subscription.orgId?.toString?.() || '',
          },
          {
            windowStart: subscription.currentPeriodStart?.toISOString?.(),
            windowEnd: subscription.currentPeriodEnd?.toISOString?.(),
          },
        )),
    )

    const failed = results.filter(result => result.status === 'rejected')
    if (failed.length > 0) {
      this.logger.warn({
        message: 'Periodic SLA snapshot capture completed with failures',
        total: results.length,
        failed: failed.length,
      })
    }

    return {
      total: results.length,
      failed: failed.length,
    }
  }

  private async resolveScope(scope: { orgId?: string | null, userId: string }) {
    const orgId = scope.orgId?.trim() || ''
    const scopeType = orgId ? SlaScopeType.ORG : SlaScopeType.USER
    const scopeId = orgId || scope.userId.trim()
    const subscription = orgId
      ? await this.subscriptionModel.findOne({
          orgId,
          status: { $in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE] },
        }).sort({ currentPeriodEnd: -1 }).lean().exec()
      : null
    const plan = subscription?.plan || 'individual'
    const policy = this.resolvePolicy(plan)

    return {
      scopeType,
      scopeId,
      plan,
      policy,
      subscription,
      monthlyFeeCents: Number(subscription?.monthlyFeeCents || 0),
    }
  }

  private resolvePolicy(plan: string): SlaPolicy {
    const normalizedPlan = plan?.trim() || 'individual'
    const policyMap: Record<string, SlaPolicy> = {
      individual: {
        tier: 'best_effort',
        uptimeTarget: 0.95,
        maxHttpErrorRate: 0.05,
        maxVideoFailureRate: 0.4,
        maxQueueDepth: 120,
        maxQueueLatencyMs: 30 * 60 * 1000,
        responseTimeHours: 48,
        maxCreditPercent: 0,
        description: '个人体验版为尽力而为，不提供正式赔付。',
      },
      [SubscriptionPlan.TEAM]: {
        tier: 'standard',
        uptimeTarget: 0.99,
        maxHttpErrorRate: 0.01,
        maxVideoFailureRate: 0.15,
        maxQueueDepth: 80,
        maxQueueLatencyMs: 10 * 60 * 1000,
        responseTimeHours: 24,
        maxCreditPercent: 5,
        description: '企业团队版提供标准 SLA 与基础服务赔付。',
      },
      [SubscriptionPlan.PRO]: {
        tier: 'advanced',
        uptimeTarget: 0.995,
        maxHttpErrorRate: 0.0075,
        maxVideoFailureRate: 0.1,
        maxQueueDepth: 50,
        maxQueueLatencyMs: 5 * 60 * 1000,
        responseTimeHours: 12,
        maxCreditPercent: 10,
        description: '企业专业版提供增强 SLA、优先恢复与更高服务赔付上限。',
      },
      [SubscriptionPlan.FLAGSHIP]: {
        tier: 'premium',
        uptimeTarget: 0.999,
        maxHttpErrorRate: 0.005,
        maxVideoFailureRate: 0.05,
        maxQueueDepth: 20,
        maxQueueLatencyMs: 2 * 60 * 1000,
        responseTimeHours: 4,
        maxCreditPercent: 15,
        description: '企业旗舰版提供高保障 SLA、最快响应和最高服务赔付上限。',
      },
    }

    return policyMap[normalizedPlan] || policyMap['individual']
  }

  private resolveWindow(subscription: Partial<Subscription> | null, options: EvaluateSlaOptions) {
    const now = new Date()
    const start = options.windowStart
      ? this.parseDateOrThrow(options.windowStart, 'windowStart')
      : subscription?.currentPeriodStart
        ? new Date(subscription.currentPeriodStart)
        : new Date(now.getFullYear(), now.getMonth(), 1)
    const end = options.windowEnd
      ? this.parseDateOrThrow(options.windowEnd, 'windowEnd')
      : subscription?.currentPeriodEnd
        ? new Date(subscription.currentPeriodEnd)
        : now

    return { start, end }
  }

  private buildBreaches(
    snapshot: ReturnType<MonitoringMetricsService['getOperationalSnapshot']>,
    policy: SlaPolicy,
  ): SlaBreachRecord[] {
    if (policy.maxCreditPercent <= 0) {
      return []
    }

    const breaches: SlaBreachRecord[] = []
    const uptimeRatio = Math.max(0, 1 - snapshot.http.errorRate)

    if (uptimeRatio < policy.uptimeTarget) {
      breaches.push({
        code: 'uptime',
        description: '平台可用性低于合同承诺',
        severity: 'critical',
        targetValue: `${(policy.uptimeTarget * 100).toFixed(2)}%`,
        actualValue: `${(uptimeRatio * 100).toFixed(2)}%`,
        compensationPercent: policy.maxCreditPercent,
      })
    }

    if (snapshot.http.errorRate > policy.maxHttpErrorRate) {
      breaches.push({
        code: 'http_5xx_rate',
        description: '5xx 错误率高于 SLA 阈值',
        severity: 'critical',
        targetValue: `${(policy.maxHttpErrorRate * 100).toFixed(2)}%`,
        actualValue: `${(snapshot.http.errorRate * 100).toFixed(2)}%`,
        compensationPercent: Math.min(policy.maxCreditPercent, 3),
      })
    }

    if (snapshot.video.failureRate > policy.maxVideoFailureRate) {
      breaches.push({
        code: 'video_failure_rate',
        description: '视频生产失败率高于 SLA 阈值',
        severity: 'warning',
        targetValue: `${(policy.maxVideoFailureRate * 100).toFixed(2)}%`,
        actualValue: `${(snapshot.video.failureRate * 100).toFixed(2)}%`,
        compensationPercent: Math.min(policy.maxCreditPercent, 3),
      })
    }

    if (snapshot.queue.depth > policy.maxQueueDepth) {
      breaches.push({
        code: 'queue_depth',
        description: '生产队列积压超过 SLA 阈值',
        severity: 'warning',
        targetValue: String(policy.maxQueueDepth),
        actualValue: String(snapshot.queue.depth),
        compensationPercent: Math.min(policy.maxCreditPercent, 2),
      })
    }

    if (snapshot.queue.latency > policy.maxQueueLatencyMs) {
      breaches.push({
        code: 'queue_latency',
        description: '生产队列等待时延超过 SLA 阈值',
        severity: 'warning',
        targetValue: `${policy.maxQueueLatencyMs}ms`,
        actualValue: `${snapshot.queue.latency}ms`,
        compensationPercent: Math.min(policy.maxCreditPercent, 2),
      })
    }

    return breaches
  }

  private parseDateOrThrow(rawValue: string, fieldName: string) {
    const parsed = new Date(rawValue)
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${fieldName} must be a valid ISO date`)
    }

    return parsed
  }

  private normalizeLimit(limit: number | string) {
    const rawValue = typeof limit === 'string' ? Number(limit) : limit
    const fallback = Number.isFinite(rawValue) ? rawValue : 12
    return Math.min(Math.max(Math.floor(fallback || 12), 1), 50)
  }

  private toReportResponse(
    report: Pick<
      SlaReport,
      | 'scopeType'
      | 'scopeId'
      | 'plan'
      | 'tier'
      | 'windowStart'
      | 'windowEnd'
      | 'monthlyFeeCents'
      | 'measurementMethod'
      | 'metrics'
      | 'breaches'
      | 'totalCompensationPercent'
      | 'totalCompensationAmountCents'
      | 'createdAt'
    >,
  ) {
    return {
      scopeType: report.scopeType,
      scopeId: report.scopeId,
      plan: report.plan,
      tier: report.tier,
      windowStart: report.windowStart,
      windowEnd: report.windowEnd,
      monthlyFeeCents: report.monthlyFeeCents,
      measurementMethod: report.measurementMethod,
      metrics: report.metrics,
      breaches: report.breaches || [],
      claimRecommendation: {
        eligible: Boolean(report.totalCompensationAmountCents),
        creditPercent: report.totalCompensationPercent,
        creditAmountCents: report.totalCompensationAmountCents,
      },
      createdAt: report.createdAt,
    }
  }
}
