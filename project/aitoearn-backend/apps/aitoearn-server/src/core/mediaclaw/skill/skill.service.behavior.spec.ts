import { Types } from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SkillService } from './skill.service'

describe('skillService behavior', () => {
  let employeeDispatchService: Record<string, any>

  function createQueryMock(result: unknown) {
    return {
      sort: vi.fn().mockReturnThis(),
      lean: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue(result),
    }
  }

  beforeEach(() => {
    employeeDispatchService = {
      listPendingDeliveries: vi.fn(),
      confirmDelivery: vi.fn(),
    }
  })

  it('应在未显式声明能力时回填默认能力并暴露能力层级', async () => {
    const brandModel = {
      find: vi.fn().mockReturnValue(createQueryMock([])),
    }
    const pipelineModel = {
      find: vi.fn().mockReturnValue(createQueryMock([])),
    }
    const service = new SkillService(
      brandModel as any,
      pipelineModel as any,
      {} as any,
    )

    const registration = await service.registerAgent('agent-1', [], {
      orgId: new Types.ObjectId().toString(),
      userId: new Types.ObjectId().toString(),
    })

    expect(registration.capabilities).toEqual([
      'delivery',
      'review',
      'analytics',
      'scheduling',
      'brand',
      'pipeline',
      'campaign',
    ])
    expect(registration.totalCapabilities).toBe(7)
    expect(registration.capabilityLayers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          layer: 'L1',
          enabled: true,
        }),
        expect.objectContaining({
          layer: 'L4',
          enabled: true,
        }),
      ]),
    )
  })

  it('应返回 agent 能力发现结果和配置聚合', async () => {
    const orgId = new Types.ObjectId().toString()
    const userId = new Types.ObjectId().toString()
    const brandId = new Types.ObjectId()
    const pipelineId = new Types.ObjectId()

    const brandModel = {
      find: vi.fn().mockReturnValue(createQueryMock([
        {
          _id: brandId,
          name: '越小啤',
          industry: 'beer',
          assets: {
            logoUrl: 'https://cdn.example.com/logo.png',
          },
        },
      ])),
    }
    const pipelineModel = {
      find: vi.fn().mockReturnValue(createQueryMock([
        {
          _id: pipelineId,
          name: '爆款种草',
          brandId,
          type: 'b7-ai-live',
          status: 'active',
          schedule: {
            timezone: 'Asia/Shanghai',
          },
          preferences: {
            preferredDuration: 20,
            aspectRatio: '9:16',
            preferredStyles: ['hook_fast'],
            avoidStyles: ['slow_intro'],
            subtitlePreferences: {
              mode: 'burned',
            },
          },
        },
      ])),
    }

    const service = new SkillService(
      brandModel as any,
      pipelineModel as any,
      {} as any,
    )

    await service.registerAgent('agent-2', ['delivery', 'analytics', 'pipeline'], {
      orgId,
      userId,
    })

    const discovery = await service.discoverCapabilities('agent-2', { orgId, userId })
    const config = await service.getAgentConfig('agent-2', { orgId, userId })

    expect(discovery.summary).toEqual(expect.objectContaining({
      totalLayers: 4,
      enabledLayers: 3,
    }))
    expect(discovery.layers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        layer: 'L1',
        enabled: true,
      }),
      expect.objectContaining({
        layer: 'L2',
        enabled: false,
      }),
      expect.objectContaining({
        layer: 'L3',
        enabled: true,
      }),
      expect.objectContaining({
        layer: 'L4',
        enabled: true,
      }),
    ]))

    expect(config.brands).toEqual([
      expect.objectContaining({
        id: brandId.toString(),
        name: '越小啤',
      }),
    ])
    expect(config.pipelines).toEqual([
      expect.objectContaining({
        id: pipelineId.toString(),
        name: '爆款种草',
      }),
    ])
    expect(config.preferences).toEqual(expect.objectContaining({
      preferredDuration: 20,
      aspectRatio: '9:16',
    }))
    expect(config.capabilitySummary).toEqual(expect.objectContaining({
      total: 4,
      enabled: 3,
    }))
  })

  it('应优先聚合 employee dispatch 待交付记录', async () => {
    const orgId = new Types.ObjectId().toString()
    const userId = new Types.ObjectId().toString()
    const taskId = new Types.ObjectId().toString()
    const deliveryRecordId = new Types.ObjectId().toString()
    const assignmentId = new Types.ObjectId().toString()

    employeeDispatchService.listPendingDeliveries.mockResolvedValue({
      items: [
        {
          id: deliveryRecordId,
          videoTaskId: taskId,
          employeeAssignmentId: assignmentId,
          deliveryChannel: 'manual',
          status: 'pushed',
          deliveredAt: null,
          pushedAt: new Date('2026-04-09T15:00:00.000Z'),
          confirmedAt: null,
          receivedAt: null,
          createdAt: new Date('2026-04-09T14:00:00.000Z'),
          heartbeatPending: true,
          assignment: {
            id: assignmentId,
            employeeName: '小王',
            employeePhone: '13800000000',
          },
          task: {
            id: taskId,
            title: '今日上新',
            outputVideoUrl: 'https://cdn.example.com/video.mp4',
            publishStatus: 'completed',
          },
        },
      ],
      total: 1,
      page: 1,
      limit: 100,
    })

    const service = new SkillService(
      {} as any,
      {} as any,
      {} as any,
      employeeDispatchService as any,
    )

    await service.registerAgent('agent-3', ['delivery'], { orgId, userId })
    const deliveries = await service.getPendingDeliveries('agent-3', { orgId, userId })

    expect(employeeDispatchService.listPendingDeliveries).toHaveBeenCalledWith(orgId, {}, {
      page: 1,
      limit: 100,
    })
    expect(deliveries).toEqual([
      expect.objectContaining({
        taskId,
        deliveryRecordId,
        assignmentId,
        outputVideoUrl: 'https://cdn.example.com/video.mp4',
        title: '今日上新',
        heartbeatPending: true,
        publishStatus: 'completed',
        assignment: expect.objectContaining({
          employeeName: '小王',
        }),
        delivery: expect.objectContaining({
          status: 'pushed',
          deliveryChannel: 'manual',
          heartbeatPending: true,
        }),
      }),
    ])
  })

  it('应在无 employee dispatch 服务时回退到任务分发元数据', async () => {
    const orgId = new Types.ObjectId().toString()
    const userId = new Types.ObjectId().toString()
    const taskId = new Types.ObjectId()
    const videoTaskModel = {
      find: vi.fn().mockReturnValue(createQueryMock([
        {
          _id: taskId,
          brandId: new Types.ObjectId(),
          pipelineId: new Types.ObjectId(),
          outputVideoUrl: 'https://cdn.example.com/fallback.mp4',
          copy: {
            title: '回退交付任务',
          },
          completedAt: new Date('2026-04-09T10:00:00.000Z'),
          metadata: {
            distribution: {
              publishStatus: 'pushed',
              lastDistributedAt: '2026-04-09T10:05:00.000Z',
              heartbeatPending: true,
              employeeDispatch: {
                deliveryRecordId: 'delivery-fallback',
                assignmentId: 'assignment-fallback',
                employeeName: '小赵',
                employeePhone: '13700000000',
                deliveryChannel: 'wecom',
                deliveryStatus: 'pushed',
                receivedAt: null,
                confirmedAt: null,
                manualPickupRequired: false,
              },
            },
          },
        },
      ])),
    }

    const service = new SkillService(
      {} as any,
      {} as any,
      videoTaskModel as any,
    )

    await service.registerAgent('agent-fallback', ['delivery'], { orgId, userId })
    const deliveries = await service.getPendingDeliveries('agent-fallback', { orgId, userId })

    expect(videoTaskModel.find).toHaveBeenCalled()
    expect(deliveries).toEqual([
      expect.objectContaining({
        taskId: taskId.toString(),
        deliveryRecordId: 'delivery-fallback',
        assignmentId: 'assignment-fallback',
        heartbeatPending: true,
        publishStatus: 'pushed',
        assignment: expect.objectContaining({
          employeeName: '小赵',
        }),
        delivery: expect.objectContaining({
          status: 'pushed',
          deliveryChannel: 'wecom',
          pushedAt: '2026-04-09T10:05:00.000Z',
          heartbeatPending: true,
        }),
      }),
    ])
  })

  it('应在只提供 taskId 时桥接到 employee dispatch 的 deliveryRecord', async () => {
    const orgId = new Types.ObjectId().toString()
    const userId = new Types.ObjectId().toString()
    const taskId = new Types.ObjectId().toString()
    const deliveryRecordId = new Types.ObjectId().toString()
    const confirmedAt = new Date('2026-04-09T16:00:00.000Z')
    const videoTaskModel = {
      findOne: vi.fn().mockReturnValue(createQueryMock({
        _id: new Types.ObjectId(taskId),
        metadata: {
          distribution: {
            employeeDispatch: {
              deliveryRecordId,
            },
          },
        },
      })),
      findOneAndUpdate: vi.fn(),
    }

    employeeDispatchService.confirmDelivery.mockResolvedValue({
      id: deliveryRecordId,
      videoTaskId: taskId,
      status: 'received',
      confirmedAt,
      receivedAt: confirmedAt,
      deliveredAt: null,
    })

    const service = new SkillService(
      {} as any,
      {} as any,
      videoTaskModel as any,
      employeeDispatchService as any,
    )

    await service.registerAgent('agent-4', ['delivery'], { orgId, userId })
    const result = await service.confirmDelivery('agent-4', { taskId }, { orgId, userId })

    expect(videoTaskModel.findOne).toHaveBeenCalled()
    expect(employeeDispatchService.confirmDelivery).toHaveBeenCalledWith(orgId, deliveryRecordId)
    expect(videoTaskModel.findOneAndUpdate).not.toHaveBeenCalled()
    expect(result).toEqual({
      taskId,
      deliveryRecordId,
      delivered: true,
      deliveredAt: confirmedAt,
      status: 'received',
    })
  })
})
