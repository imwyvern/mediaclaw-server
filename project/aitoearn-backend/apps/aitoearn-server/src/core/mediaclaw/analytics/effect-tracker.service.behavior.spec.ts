import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EffectTrackerQueueService } from './effect-tracker.queue.service'
import { EffectTrackerService } from './effect-tracker.service'

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

function createQuery<T>(value: T) {
  const query = {
    sort: vi.fn(),
    limit: vi.fn(),
    lean: vi.fn(),
    exec: vi.fn().mockResolvedValue(value),
  }

  query.sort.mockReturnValue(query)
  query.limit.mockReturnValue(query)
  query.lean.mockReturnValue(query)

  return query
}

describe('effectTrackerService behavior', () => {
  let videoTaskModel: Record<string, any>
  let videoAnalyticsModel: Record<string, any>
  let analyticsCollectorService: Record<string, any>
  let service: EffectTrackerService

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-09T12:00:00.000Z'))

    videoTaskModel = {
      find: vi.fn(),
      findByIdAndUpdate: vi.fn().mockReturnValue(createQuery({ acknowledged: true })),
    }
    videoAnalyticsModel = {
      find: vi.fn(),
    }
    analyticsCollectorService = {
      collectForVideo: vi.fn(),
    }

    service = new EffectTrackerService(
      videoTaskModel as any,
      videoAnalyticsModel as any,
      analyticsCollectorService as any,
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('应按时间窗追踪已发布内容并回写趋势', async () => {
    videoTaskModel.find.mockReturnValue(createQuery([
      {
        _id: { toString: () => 'task_recent' },
        status: 'published',
        publishedAt: new Date('2026-04-07T08:00:00.000Z'),
        platformPostId: 'post_1',
        metadata: {},
      },
      {
        _id: { toString: () => 'task_old' },
        status: 'published',
        publishedAt: new Date('2026-04-01T08:00:00.000Z'),
        platformPostId: 'post_2',
        metadata: {},
      },
    ]))

    analyticsCollectorService.collectForVideo.mockResolvedValue({
      source: 'tikhub',
      metrics: {
        views: 1800,
        likes: 220,
        comments: 36,
        shares: 18,
      },
      snapshot: {
        publishPostId: 'post_1',
        publishPostUrl: 'https://example.com/post_1',
        recordedAt: '2026-04-09T12:00:00.000Z',
      },
    })

    videoAnalyticsModel.find.mockImplementation((query: Record<string, any>) => {
      if (query.videoTaskId === 'task_recent') {
        return createQuery([
          {
            recordedAt: new Date('2026-04-09T12:00:00.000Z'),
            engagementRate: 15.22,
            metrics: {
              views: 1800,
              likes: 220,
              comments: 36,
              shares: 18,
              saves: 9,
            },
          },
          {
            recordedAt: new Date('2026-04-08T12:00:00.000Z'),
            engagementRate: 11.5,
            metrics: {
              views: 1200,
              likes: 120,
              comments: 16,
              shares: 10,
              saves: 6,
            },
          },
        ])
      }

      return createQuery([])
    })

    const result = await service.trackWindow('t0_3')

    expect(result.tracked).toBe(1)
    expect(result.skipped).toBe(0)
    expect(result.failed).toBe(0)
    expect(result.items[0]).toEqual(expect.objectContaining({
      taskId: 'task_recent',
      tracked: true,
      trendDirection: 'up',
    }))
    expect(analyticsCollectorService.collectForVideo).toHaveBeenCalledTimes(1)
    expect(analyticsCollectorService.collectForVideo).toHaveBeenCalledWith('task_recent')
    expect(videoTaskModel.findByIdAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        toString: expect.any(Function),
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          'metadata.analyticsTrend': expect.objectContaining({
            direction: 'up',
            delta: expect.objectContaining({
              views: 600,
            }),
          }),
          'metadata.effectTracking': expect.objectContaining({
            cohort: 't0_3',
            tracked: true,
            source: 'tikhub',
          }),
        }),
      }),
    )
  })

  it('应为四个时间窗注册 repeatable jobs', async () => {
    const effectTrackerQueue = {
      upsertJobScheduler: vi.fn().mockResolvedValue(undefined),
    }

    const queueService = new EffectTrackerQueueService(effectTrackerQueue as any)
    await queueService.onModuleInit()

    expect(effectTrackerQueue.upsertJobScheduler).toHaveBeenCalledTimes(4)
    expect(effectTrackerQueue.upsertJobScheduler).toHaveBeenNthCalledWith(
      1,
      'mediaclaw-effect-tracker-t0-3',
      expect.objectContaining({ pattern: '0 9,21 * * *' }),
      expect.objectContaining({
        name: 'analytics.effect-track',
        data: expect.objectContaining({ cohort: 't0_3' }),
      }),
    )
    expect(effectTrackerQueue.upsertJobScheduler).toHaveBeenNthCalledWith(
      4,
      'mediaclaw-effect-tracker-t31-90',
      expect.objectContaining({ pattern: '0 12 * * 1' }),
      expect.objectContaining({
        data: expect.objectContaining({ cohort: 't31_90' }),
      }),
    )
  })
})
