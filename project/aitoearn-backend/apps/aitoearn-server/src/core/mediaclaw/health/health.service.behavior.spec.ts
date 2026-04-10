import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HealthService } from './health.service'

describe('healthService behavior', () => {
  let service: HealthService
  let videoWorkerQueue: Record<string, any>
  let clawHostService: Record<string, any>
  let clawHostGatewayPushService: Record<string, any>

  beforeEach(() => {
    videoWorkerQueue = {
      getJobs: vi.fn().mockResolvedValue([]),
    }
    clawHostService = {
      recordHeartbeat: vi.fn().mockResolvedValue(undefined),
    }
    clawHostGatewayPushService = {
      drainConfigUpdates: vi.fn().mockReturnValue([{
        key: 'gatewayConfig',
        value: { enabled: true },
        updatedAt: '2026-04-10T10:30:00.000Z',
      }]),
    }

    service = new HealthService(
      videoWorkerQueue as any,
      clawHostService as any,
      clawHostGatewayPushService as any,
    )
  })

  it('应在 heartbeat 返回队列里的 config updates', async () => {
    const result = await service.heartbeat({
      id: 'user-1',
      orgId: 'org-1',
      apiKeyId: 'mc_live_abcd1234',
      authType: 'apiKey',
    }, {
      agentId: 'agent-1',
      capabilities: ['delivery'],
      clientVersion: '1.2.3',
    })

    expect(clawHostGatewayPushService.drainConfigUpdates).toHaveBeenCalledWith('org-1', 'agent-1')
    expect(result.configUpdates).toEqual([{
      key: 'gatewayConfig',
      value: { enabled: true },
      updatedAt: '2026-04-10T10:30:00.000Z',
    }])
  })
})
