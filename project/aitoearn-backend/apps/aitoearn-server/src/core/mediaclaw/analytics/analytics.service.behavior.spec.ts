import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnalyticsService } from './analytics.service'

vi.mock('@yikart/mongodb', () => {
  class VideoAnalytics {}
  class VideoTask {}

  return {
    VideoAnalytics,
    VideoTask,
    VideoTaskStatus: {
      PUBLISHED: 'published',
    },
  }
})

function createAggregateQuery<T>(value: T) {
  return {
    exec: vi.fn().mockResolvedValue(value),
  }
}

function createFindQuery<T>(value: T) {
  const query = {
    lean: vi.fn(),
    select: vi.fn(),
    exec: vi.fn().mockResolvedValue(value),
  }

  query.lean.mockReturnValue(query)
  query.select.mockReturnValue(query)

  return query
}

describe('analyticsService behavior', () => {
  let videoTaskModel: Record<string, any>
  let videoAnalyticsModel: Record<string, any>
  let analyticsCollectorService: Record<string, any>
  let service: AnalyticsService

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-08T12:00:00.000Z'))

    videoTaskModel = {
      aggregate: vi.fn().mockReturnValue(createAggregateQuery([])),
      find: vi.fn().mockReturnValue(createFindQuery([])),
    }
    videoAnalyticsModel = {
      aggregate: vi.fn().mockReturnValue(createAggregateQuery([])),
    }
    analyticsCollectorService = {
      getVideoLatestMetrics: vi.fn(),
      getVideoTimeSeries: vi.fn(),
      collectForOrg: vi.fn(),
      collectForVideo: vi.fn(),
    }

    service = new AnalyticsService(
      videoTaskModel as any,
      videoAnalyticsModel as any,
      analyticsCollectorService as any,
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('应在总览中返回飞轮建议和 7/30/90 窗口', async () => {
    vi.spyOn(service as any, 'getTaskOverviewSummary').mockResolvedValue({
      totalVideos: 12,
      performance: { views: 3000 },
    })
    vi.spyOn(service as any, 'getOverviewWindow')
      .mockResolvedValueOnce({ windowDays: 7, trackedVideos: 2 })
      .mockResolvedValueOnce({ windowDays: 30, trackedVideos: 6 })
      .mockResolvedValueOnce({ windowDays: 90, trackedVideos: 12 })
    vi.spyOn(service as any, 'buildOptimizationLoop').mockResolvedValue({
      learningStage: 'hybrid',
      recommendations: ['优先保留高表现蓝词：修护 / 抗老'],
    })

    const result = await service.getOverview('org_1', 90)

    expect(result.selectedWindow).toBe(90)
    expect(result.supportedWindows).toEqual([7, 30, 90])
    expect(result.last90Days?.trackedVideos).toBe(12)
    expect(result.flywheel).toEqual(expect.objectContaining({
      learningStage: 'hybrid',
      recommendations: expect.arrayContaining(['优先保留高表现蓝词：修护 / 抗老']),
    }))
  })

  it('应返回蓝词和 hashtag 的排名变化', async () => {
    videoTaskModel.find.mockReturnValue(createFindQuery([
      {
        createdAt: new Date('2026-04-07T12:00:00.000Z'),
        copy: {
          hashtags: ['#抗老', '#修护'],
          blueWords: ['抗老'],
        },
        metadata: {
          keywords: ['紧致'],
        },
      },
      {
        createdAt: new Date('2026-04-05T12:00:00.000Z'),
        copy: {
          hashtags: ['#抗老'],
          blueWords: ['抗老'],
        },
        metadata: {},
      },
      {
        createdAt: new Date('2026-02-20T12:00:00.000Z'),
        copy: {
          hashtags: ['#修护', '#修护'],
          blueWords: ['修护', '修护'],
        },
        metadata: {},
      },
      {
        createdAt: new Date('2026-02-18T12:00:00.000Z'),
        copy: {
          hashtags: ['#抗老'],
          blueWords: ['抗老'],
        },
        metadata: {},
      },
    ]))

    const result = await service.getSeoInsights('org_1', 30, 5)

    expect(result.topHashtags[0]).toEqual(expect.objectContaining({
      hashtag: '#抗老',
      currentRank: 1,
      previousRank: 2,
      rankChange: 1,
      trend: 'up',
    }))
    expect(result.topKeywords[0]).toEqual(expect.objectContaining({
      keyword: '抗老',
      previousRank: 2,
      trend: 'up',
    }))
  })

  it('应支持按 conversion 指标返回 TOP 内容', async () => {
    videoAnalyticsModel.aggregate.mockReturnValue(createAggregateQuery([
      {
        taskId: { toString: () => 'task_1' },
        brandId: { toString: () => 'brand_1' },
        pipelineId: { toString: () => 'pipeline_1' },
        outputVideoUrl: 'https://example.com/video.mp4',
        metricValue: 12,
        views: 1200,
        likes: 120,
        comments: 30,
        shares: 12,
        saves: 10,
        followers: 4,
        engagement: 172,
        conversion: 12,
        engagementRate: 4.2,
        completedAt: new Date('2026-04-06T12:00:00.000Z'),
        publishedAt: new Date('2026-04-06T12:30:00.000Z'),
        latestRecordedAt: new Date('2026-04-07T12:00:00.000Z'),
      },
    ]))

    const result = await service.getTopContent('org_1', 10, 'conversion', 30)

    expect(result[0]).toEqual(expect.objectContaining({
      taskId: 'task_1',
      metric: 'conversion',
      metricValue: 12,
      conversion: 12,
      engagement: 172,
    }))
  })
})
