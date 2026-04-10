import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SlaService } from './sla.service'

vi.mock('@yikart/mongodb', () => {
  class Subscription {}
  class SlaReport {}

  return {
    SlaReport,
    SlaScopeType: {
      ORG: 'org',
      USER: 'user',
    },
    Subscription,
    SubscriptionPlan: {
      TEAM: 'team',
      PRO: 'pro',
      FLAGSHIP: 'flagship',
    },
    SubscriptionStatus: {
      ACTIVE: 'active',
      PAST_DUE: 'past_due',
      CANCELLED: 'cancelled',
      EXPIRED: 'expired',
    },
  }
})

function createQuery<T>(value: T) {
  const query = {
    sort: vi.fn(),
    limit: vi.fn(),
    lean: vi.fn(),
    select: vi.fn(),
    exec: vi.fn().mockResolvedValue(value),
  }

  query.sort.mockReturnValue(query)
  query.limit.mockReturnValue(query)
  query.lean.mockReturnValue(query)
  query.select.mockReturnValue(query)

  return query
}

describe('slaService behavior', () => {
  let service: SlaService
  let subscriptionModel: Record<string, any>
  let slaReportModel: Record<string, any>
  let monitoringMetricsService: Record<string, any>

  beforeEach(() => {
    subscriptionModel = {
      find: vi.fn(),
      findOne: vi.fn(),
    }
    slaReportModel = {
      create: vi.fn(),
      find: vi.fn(),
      findOne: vi.fn(),
    }
    monitoringMetricsService = {
      captureQueueMetrics: vi.fn().mockResolvedValue({
        depth: 60,
        latency: 400000,
        capturedAt: '2026-04-10T13:15:00.000Z',
      }),
      getOperationalSnapshot: vi.fn().mockReturnValue({
        http: {
          totalRequests: 1000,
          serverErrors: 20,
          errorRate: 0.02,
        },
        video: {
          total: 100,
          failed: 20,
          failureRate: 0.2,
        },
        queue: {
          depth: 60,
          latency: 400000,
          capturedAt: '2026-04-10T13:15:00.000Z',
        },
        database: {
          slowQueries: 2,
          lastSlowQueryAt: '2026-04-10T13:15:00.000Z',
        },
      }),
    }

    service = new SlaService(
      subscriptionModel as any,
      slaReportModel as any,
      monitoringMetricsService as any,
    )
  })

  it('应按企业订阅档位评估 SLA 赔付并持久化报告', async () => {
    subscriptionModel.findOne.mockReturnValue(createQuery({
      orgId: 'org-1',
      plan: 'pro',
      status: 'active',
      monthlyFeeCents: 98000,
      currentPeriodStart: new Date('2026-04-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-04-30T23:59:59.000Z'),
    }))
    slaReportModel.create.mockImplementation(async (payload: Record<string, unknown>) => ({
      ...payload,
      createdAt: new Date('2026-04-10T13:20:00.000Z'),
      toObject() {
        return {
          ...payload,
          createdAt: new Date('2026-04-10T13:20:00.000Z'),
        }
      },
    }))

    const result = await service.evaluateCurrentSla({
      orgId: 'org-1',
      userId: 'user-1',
    })

    expect(monitoringMetricsService.captureQueueMetrics).toHaveBeenCalledTimes(1)
    expect(slaReportModel.create).toHaveBeenCalledWith(expect.objectContaining({
      scopeType: 'org',
      scopeId: 'org-1',
      plan: 'pro',
      tier: 'advanced',
      totalCompensationPercent: 10,
      totalCompensationAmountCents: 9800,
    }))
    expect(result.claimRecommendation).toEqual({
      eligible: true,
      creditPercent: 10,
      creditAmountCents: 9800,
    })
    expect(result.breaches.map(item => item.code)).toEqual([
      'uptime',
      'http_5xx_rate',
      'video_failure_rate',
      'queue_depth',
      'queue_latency',
    ])
  })

  it('应为个人体验版返回 best effort SLA 且不触发赔付', async () => {
    slaReportModel.create.mockImplementation(async (payload: Record<string, unknown>) => ({
      ...payload,
      createdAt: new Date('2026-04-10T13:25:00.000Z'),
      toObject() {
        return {
          ...payload,
          createdAt: new Date('2026-04-10T13:25:00.000Z'),
        }
      },
    }))

    const result = await service.evaluateCurrentSla({
      userId: 'user-9',
    })

    expect(subscriptionModel.findOne).not.toHaveBeenCalled()
    expect(result.scopeType).toBe('user')
    expect(result.plan).toBe('individual')
    expect(result.tier).toBe('best_effort')
    expect(result.breaches).toEqual([])
    expect(result.claimRecommendation).toEqual({
      eligible: false,
      creditPercent: 0,
      creditAmountCents: 0,
    })
  })

  it('应返回当前 SLA 策略和最近一次评估结果', async () => {
    subscriptionModel.findOne.mockReturnValue(createQuery({
      orgId: 'org-2',
      plan: 'team',
      status: 'active',
      monthlyFeeCents: 29800,
      currentPeriodStart: new Date('2026-04-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-04-30T23:59:59.000Z'),
    }))
    slaReportModel.findOne.mockReturnValue(createQuery({
      scopeType: 'org',
      scopeId: 'org-2',
      plan: 'team',
      tier: 'standard',
      windowStart: new Date('2026-04-01T00:00:00.000Z'),
      windowEnd: new Date('2026-04-10T13:00:00.000Z'),
      monthlyFeeCents: 29800,
      measurementMethod: 'http_availability_proxy',
      metrics: {
        uptimeRatio: 0.995,
        httpErrorRate: 0.005,
        videoFailureRate: 0.08,
        queueDepth: 10,
        queueLatency: 120000,
      },
      breaches: [],
      totalCompensationPercent: 0,
      totalCompensationAmountCents: 0,
      createdAt: new Date('2026-04-10T13:05:00.000Z'),
    }))

    const result = await service.getCurrentSla({
      orgId: 'org-2',
      userId: 'user-2',
    })

    expect(result.scopeType).toBe('org')
    expect(result.plan).toBe('team')
    expect(result.policy).toEqual(expect.objectContaining({
      tier: 'standard',
      maxCreditPercent: 5,
    }))
    expect(result.latestReport).toEqual(expect.objectContaining({
      tier: 'standard',
      claimRecommendation: {
        eligible: false,
        creditPercent: 0,
        creditAmountCents: 0,
      },
    }))
    expect(result.claimEligible).toBe(false)
  })
})
