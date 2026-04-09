import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HealthMonitorService } from './health-monitor.service'

vi.mock('@yikart/mongodb', () => {
  class PlatformAccount {}
  class PublishRecord {}
  class VideoTask {}

  return {
    NotificationEvent: {
      TASK_FAILED: 'task.failed',
    },
    PlatformAccount,
    PublishRecord,
    VideoTask,
  }
})

function createQuery<T>(value: T) {
  const query = {
    sort: vi.fn(),
    lean: vi.fn(),
    exec: vi.fn().mockResolvedValue(value),
  }

  query.sort.mockReturnValue(query)
  query.lean.mockReturnValue(query)

  return query
}

describe('healthMonitorService behavior', () => {
  let platformAccountModel: Record<string, any>
  let publishRecordModel: Record<string, any>
  let videoTaskModel: Record<string, any>
  let notificationService: Record<string, any>
  let service: HealthMonitorService

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-09T12:00:00.000Z'))

    platformAccountModel = {
      findOne: vi.fn(),
      findByIdAndUpdate: vi.fn().mockReturnValue(createQuery({ acknowledged: true })),
    }
    publishRecordModel = {
      find: vi.fn(),
    }
    videoTaskModel = {
      find: vi.fn(),
    }
    notificationService = {
      send: vi.fn().mockResolvedValue({ delivered: true }),
    }

    service = new HealthMonitorService(
      platformAccountModel as any,
      publishRecordModel as any,
      videoTaskModel as any,
      notificationService as any,
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('应计算账号健康度并在异常时通知', async () => {
    platformAccountModel.findOne.mockReturnValue(createQuery({
      _id: { toString: () => 'account_1' },
      orgId: { toString: () => 'org_1' },
      platform: 'xiaohongshu',
      accountId: 'xhs_001',
      accountName: '小红书主号',
      healthSnapshot: {},
    }))
    videoTaskModel.find.mockReturnValue(createQuery([
      {
        publishedAt: new Date('2026-04-08T12:00:00.000Z'),
        analyticsSnapshot: {
          views: 320,
          engagementRate: 2.2,
        },
        metadata: {
          distribution: {
            platformAccountId: 'account_1',
          },
        },
      },
      {
        publishedAt: new Date('2026-04-03T12:00:00.000Z'),
        analyticsSnapshot: {
          views: 1800,
          engagementRate: 2.2,
        },
        metadata: {
          distribution: {
            platformAccountId: 'account_1',
          },
        },
      },
      {
        publishedAt: new Date('2026-03-28T12:00:00.000Z'),
        analyticsSnapshot: {
          views: 2400,
          engagementRate: 7.1,
        },
        metadata: {
          distribution: {
            platformAccountId: 'account_1',
          },
        },
      },
    ]))
    publishRecordModel.find.mockReturnValue(createQuery([
      {
        publishTime: new Date('2026-04-08T12:00:00.000Z'),
      },
      {
        publishTime: new Date('2026-04-03T12:00:00.000Z'),
      },
      {
        publishTime: new Date('2026-03-28T12:00:00.000Z'),
      },
    ]))

    const result = await service.getAccountHealth('org_1', 'account_1')

    expect(result.status).toBe('risk')
    expect(result.engagementRate.deltaPct).toBeLessThan(-50)
    expect(result.lowPlayRatio.ratio).toBeGreaterThan(0.3)
    expect(result.anomalies.map(item => item.type)).toEqual(
      expect.arrayContaining(['engagement_drop', 'high_low_play_ratio']),
    )
    expect(notificationService.send).toHaveBeenCalledWith(
      'org_1',
      'task.failed',
      expect.objectContaining({
        type: 'platform_account_health_alert',
        platformAccountId: 'account_1',
      }),
    )
    expect(platformAccountModel.findByIdAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        toString: expect.any(Function),
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          'healthSnapshot': expect.objectContaining({
            status: 'risk',
          }),
          'metrics.totalViews': 4520,
        }),
      }),
    )
  })
})
