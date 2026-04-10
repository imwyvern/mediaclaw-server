import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TrendPredictionService } from './trend-prediction.service'

vi.mock('@yikart/mongodb', () => {
  class ViralContent {}
  class VideoAnalytics {}

  return {
    ViralContent,
    VideoAnalytics,
  }
})

function createExecQuery<T>(value: T) {
  const query = {
    lean: vi.fn(),
    exec: vi.fn().mockResolvedValue(value),
  }

  query.lean.mockReturnValue(query)
  return query
}

describe('trendPredictionService behavior', () => {
  let service: TrendPredictionService
  let viralContentModel: Record<string, any>
  let videoAnalyticsModel: Record<string, any>

  beforeEach(() => {
    viralContentModel = {
      find: vi.fn(),
    }
    videoAnalyticsModel = {
      aggregate: vi.fn(),
    }

    service = new TrendPredictionService(
      viralContentModel as any,
      videoAnalyticsModel as any,
    )
  })

  it('应基于市场热度和客户表现生成未来 7 天预测', async () => {
    viralContentModel.find.mockReturnValue(createExecQuery([
      {
        platform: 'douyin',
        title: '换季护肤 成分解析',
        keywords: ['成分解析', '换季护肤'],
        industry: '美妆',
        viralScore: 96,
        views: 500000,
        likes: 52000,
        comments: 9000,
        shares: 6000,
        publishedAt: '2026-04-08T12:00:00.000Z',
        discoveredAt: '2026-04-08T12:00:00.000Z',
      },
      {
        platform: 'douyin',
        title: '换季护肤 成分解析',
        keywords: ['成分解析'],
        industry: '美妆',
        viralScore: 90,
        views: 420000,
        likes: 43000,
        comments: 7000,
        shares: 5000,
        publishedAt: '2026-03-05T12:00:00.000Z',
        discoveredAt: '2026-03-05T12:00:00.000Z',
      },
      {
        platform: 'xiaohongshu',
        title: '平价粉底液 开箱测评',
        keywords: ['平价粉底液', '开箱测评'],
        industry: '美妆',
        viralScore: 82,
        views: 210000,
        likes: 18000,
        comments: 2500,
        shares: 1500,
        publishedAt: '2026-04-07T18:00:00.000Z',
        discoveredAt: '2026-04-07T18:00:00.000Z',
      },
    ]))
    videoAnalyticsModel.aggregate.mockReturnValue(createExecQuery([
      {
        orgId: 'org-1',
        publishedAt: '2026-04-08T12:00:00.000Z',
        views: 20000,
        likes: 2200,
        comments: 260,
        shares: 180,
        saves: 120,
        platformCandidates: ['douyin'],
        industryCandidates: ['美妆'],
      },
      {
        orgId: 'org-2',
        publishedAt: '2026-04-07T18:00:00.000Z',
        views: 13000,
        likes: 1700,
        comments: 210,
        shares: 120,
        saves: 90,
        platformCandidates: ['xiaohongshu'],
        industryCandidates: ['美妆'],
      },
    ]))

    const result = await service.getPredictions({
      industry: '美妆',
      horizonDays: 7,
      windowDays: 90,
    })

    expect(result.source).toBe('multi-source-history')
    expect(result.support.activeOrganizations).toBe(2)
    expect(result.bestPublishWindows[0]).toMatchObject({
      platform: 'douyin',
      hour: 12,
    })
    expect(result.directions[0]).toMatchObject({
      topic: '成分解析',
      recommendedTemplate: 'b10-explainer',
    })
    expect(result.templateRecommendations[0].templateType).toBe('b10-explainer')
  })

  it('应在样本不足时返回空预测而不是抛错', async () => {
    viralContentModel.find.mockReturnValue(createExecQuery([]))
    videoAnalyticsModel.aggregate.mockReturnValue(createExecQuery([]))

    const result = await service.getPredictions({
      industry: '食品饮料',
      horizonDays: 7,
    })

    expect(result.directions).toEqual([])
    expect(result.bestPublishWindows).toEqual([])
    expect(result.templateRecommendations).toEqual([])
    expect(result.support).toMatchObject({
      marketSignals: 0,
      customerSignals: 0,
      activeOrganizations: 0,
    })
  })
})
