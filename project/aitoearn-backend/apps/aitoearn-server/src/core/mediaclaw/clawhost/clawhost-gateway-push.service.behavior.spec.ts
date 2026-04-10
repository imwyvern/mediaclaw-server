import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ClawHostGatewayPushService } from './clawhost-gateway-push.service'

const { axiosPost } = vi.hoisted(() => ({
  axiosPost: vi.fn(),
}))

vi.mock('axios', () => ({
  default: {
    post: axiosPost,
  },
}))

vi.mock('@yikart/mongodb', () => ({
  ClawHostInstance: class ClawHostInstance {},
  ClawHostInstanceStatus: {
    RUNNING: 'running',
  },
}))

function createQuery<T>(value: T) {
  const query = {
    lean: vi.fn(),
    exec: vi.fn().mockResolvedValue(value),
  }
  query.lean.mockReturnValue(query)
  return query
}

describe('clawHostGatewayPushService', () => {
  let service: ClawHostGatewayPushService
  let clawHostInstanceModel: Record<string, any>

  beforeEach(() => {
    axiosPost.mockReset()
    clawHostInstanceModel = {
      find: vi.fn(),
      updateOne: vi.fn().mockReturnValue(createQuery({ acknowledged: true })),
    }
    service = new ClawHostGatewayPushService(clawHostInstanceModel as any)
  })

  it('应按 agent 维度缓存并消费 heartbeat 配置更新', () => {
    service.queueConfigUpdate('org-1', 'agent-1', {
      key: 'gatewayConfig',
      value: { enabled: true },
      updatedAt: '2026-04-10T10:15:00.000Z',
    })

    const updates = service.drainConfigUpdates('org-1', 'agent-1')

    expect(updates).toEqual([{
      key: 'gatewayConfig',
      value: { enabled: true },
      updatedAt: '2026-04-10T10:15:00.000Z',
    }])
    expect(service.drainConfigUpdates('org-1', 'agent-1')).toEqual([])
  })

  it('应向 gateway /tools/invoke 推送实时事件并记录成功状态', async () => {
    clawHostInstanceModel.find.mockReturnValue(createQuery([{
      _id: 'mongo-1',
      instanceId: 'instance-1',
      orgId: 'org-1',
      heartbeatCapabilities: ['delivery'],
      gatewayConfig: {
        enabled: true,
        url: 'https://openclaw.example.com',
        toolName: 'mediaclaw.sync',
      },
    }]))
    axiosPost.mockResolvedValue({ status: 200 })

    const result = await service.pushRealtimeEvent('org-1', {
      event: 'delivery.pending',
      capability: 'delivery',
      input: {
        deliveryRecordId: 'record-1',
      },
    })

    expect(axiosPost).toHaveBeenCalledWith(
      'https://openclaw.example.com/tools/invoke',
      expect.objectContaining({
        tool: 'mediaclaw.sync',
        arguments: expect.objectContaining({
          event: 'delivery.pending',
          deliveryRecordId: 'record-1',
        }),
      }),
      expect.objectContaining({
        timeout: 5000,
      }),
    )
    expect(clawHostInstanceModel.updateOne).toHaveBeenCalledWith(
      { _id: 'mongo-1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          'gatewayConfig.lastPushStatus': 'success',
        }),
      }),
    )
    expect(result.delivered).toBe(1)
  })
})
