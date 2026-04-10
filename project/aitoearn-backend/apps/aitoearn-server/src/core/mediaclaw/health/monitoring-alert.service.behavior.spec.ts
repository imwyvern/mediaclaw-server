import axios from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MonitoringAlertService } from './monitoring-alert.service'

vi.mock('axios', () => ({
  default: {
    post: vi.fn().mockResolvedValue({ status: 200 }),
  },
}))

describe('monitoringAlertService behavior', () => {
  let metricsService: Record<string, any>
  let configService: Record<string, any>
  let service: MonitoringAlertService

  beforeEach(() => {
    metricsService = {
      captureQueueMetrics: vi.fn().mockResolvedValue(undefined),
      getOperationalSnapshot: vi.fn().mockReturnValue({
        http: {
          totalRequests: 100,
          serverErrors: 12,
          errorRate: 0.12,
        },
        video: {
          total: 10,
          failed: 4,
          failureRate: 0.4,
        },
        queue: {
          depth: 135,
          latency: 92_000,
          capturedAt: '2026-04-09T12:00:00.000Z',
        },
      }),
    }
    configService = {
      getString: vi.fn((keys: string[]) => {
        if (keys.includes('MEDIACLAW_MONITOR_FEISHU_WEBHOOK')) {
          return 'https://feishu.example.com/hook'
        }

        if (keys.includes('MEDIACLAW_MONITOR_DINGTALK_WEBHOOK')) {
          return 'https://dingtalk.example.com/hook'
        }

        return ''
      }),
    }

    service = new MonitoringAlertService(
      metricsService as any,
      configService as any,
    )
  })

  it('应在阈值触发时向 Feishu 和 DingTalk 发送告警', async () => {
    const result = await service.checkThresholds()

    expect(metricsService.captureQueueMetrics).toHaveBeenCalledTimes(1)
    expect(result.alertCount).toBeGreaterThanOrEqual(3)
    expect((axios as any).post).toHaveBeenCalledTimes(2)
    expect((axios as any).post).toHaveBeenNthCalledWith(
      1,
      'https://feishu.example.com/hook',
      expect.objectContaining({
        msg_type: 'text',
      }),
      expect.any(Object),
    )
    expect((axios as any).post).toHaveBeenNthCalledWith(
      2,
      'https://dingtalk.example.com/hook',
      expect.objectContaining({
        msgtype: 'text',
      }),
      expect.any(Object),
    )
  })
})
