import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DataDashboardService } from './data-dashboard.service'

vi.mock('@yikart/mongodb', () => {
  class Organization {}
  class Subscription {}
  class VideoAnalytics {}
  class VideoTask {}

  return {
    Organization,
    Subscription,
    VideoAnalytics,
    VideoTask,
    OrgType: {
      INDIVIDUAL: 'individual',
      TEAM: 'team',
      PROFESSIONAL: 'professional',
      ENTERPRISE: 'enterprise',
    },
    SubscriptionPlan: {
      TEAM: 'team',
      PRO: 'pro',
      FLAGSHIP: 'flagship',
    },
    SubscriptionStatus: {
      ACTIVE: 'active',
    },
    VideoTaskStatus: {
      COMPLETED: 'completed',
      FAILED: 'failed',
    },
  }
})

function createQuery<T>(value: T) {
  const query = {
    lean: vi.fn(),
    limit: vi.fn(),
    sort: vi.fn(),
    exec: vi.fn().mockResolvedValue(value),
  }

  query.lean.mockReturnValue(query)
  query.limit.mockReturnValue(query)
  query.sort.mockReturnValue(query)

  return query
}

describe('dataDashboardService behavior', () => {
  let videoTaskModel: Record<string, any>
  let videoAnalyticsModel: Record<string, any>
  let organizationModel: Record<string, any>
  let subscriptionModel: Record<string, any>
  let service: DataDashboardService

  beforeEach(() => {
    videoTaskModel = {
      aggregate: vi.fn(),
      find: vi.fn().mockReturnValue(createQuery([])),
    }
    videoAnalyticsModel = {
      aggregate: vi.fn(),
    }
    organizationModel = {
      findById: vi.fn(),
    }
    subscriptionModel = {
      findOne: vi.fn(),
    }

    service = new DataDashboardService(
      videoTaskModel as any,
      videoAnalyticsModel as any,
      organizationModel as any,
      subscriptionModel as any,
    )
  })

  it('应在 overview 中透出选中的 90 天窗口', async () => {
    vi.spyOn(service, 'getContentHealth').mockResolvedValue({
      source: 'mongodb',
      dashboardTier: 'advanced',
      windowDays: 90,
      engagementRate: 4.2,
      publishingConsistency: 55,
      averageViewsPerVideo: 320,
      trackedVideos: 10,
      totals: {
        totalVideos: 12,
        completedVideos: 10,
        totalViews: 3840,
        totalLikes: 320,
        totalComments: 80,
        totalShares: 40,
      },
    } as any)
    vi.spyOn(service as any, 'buildOverviewActivity').mockResolvedValue([
      { date: '2026-04-08', totalVideos: 1, completedVideos: 1, totalViews: 320 },
    ])

    const result = await service.getOverview('org_1', 90)

    expect(service.getContentHealth).toHaveBeenCalledWith('org_1', 90)
    expect(result.selectedWindow).toBe(90)
    expect(result.supportedWindows).toEqual([7, 30, 90])
    expect(result.windowDays).toBe(90)
  })

  it('应在 benchmark 中按传入窗口返回 period 对齐结果', async () => {
    vi.spyOn(service as any, 'getDashboardTier').mockResolvedValue('advanced')
    vi.spyOn(service as any, 'getResolvedIndustry').mockResolvedValue('beauty')
    vi.spyOn(service as any, 'buildContentHealthPayload').mockResolvedValue({
      orgId: 'org_1',
      source: 'mongodb',
      dashboardTier: 'advanced',
      windowDays: 7,
      engagementRate: 4.8,
      completionRate: 90,
      publishingConsistency: 65,
      averageViewsPerVideo: 600,
      trackedVideos: 4,
      lowPlayRatio: 10,
      abnormalEngagementRatio: 0,
      firstDayDecayRate: 8,
      totals: {
        totalVideos: 4,
        completedVideos: 4,
        totalViews: 2400,
        totalLikes: 200,
        totalComments: 40,
        totalShares: 20,
      },
    })
    vi.spyOn(service as any, 'getIndustryBenchmark').mockResolvedValue({
      engagementRate: 3.1,
      completionRate: 82,
      publishingConsistency: 48,
      averageViewsPerVideo: 420,
      lowPlayRatio: 20,
      abnormalEngagementRatio: 5,
      firstDayDecayRate: 12,
      trackedVideos: 40,
      taskCount: 30,
    })

    const result = await service.getCompetitorBenchmark('org_1', 'beauty', 7)

    expect(result.windowDays).toBe(7)
    expect(result.industry).toBe('beauty')
    expect(result.delta).toEqual(expect.objectContaining({
      engagementRate: 1.7,
      averageViewsPerVideo: 180,
    }))
  })
})
