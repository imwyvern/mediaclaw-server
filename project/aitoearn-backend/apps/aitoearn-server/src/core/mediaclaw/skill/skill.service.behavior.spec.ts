import { Types } from 'mongoose'
import { SkillService } from './skill.service'

describe('skillService behavior', () => {
  function createQueryMock(result: unknown) {
    return {
      sort: vi.fn().mockReturnThis(),
      lean: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue(result),
    }
  }

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
})
