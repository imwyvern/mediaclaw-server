import { Types } from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PipelineService } from './pipeline.service'

vi.mock('@yikart/mongodb', () => {
  class Brand {}
  class Pipeline {}
  class VideoTask {}

  return {
    Brand,
    Pipeline,
    VideoTask,
    PipelineStatus: {
      ACTIVE: 'active',
      PAUSED: 'paused',
      ARCHIVED: 'archived',
    },
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

describe('pipelineService', () => {
  let service: PipelineService
  let pipelineModel: Record<string, any>
  let brandModel: Record<string, any>
  let frameExtractService: Record<string, any>
  let dedupService: Record<string, any>
  let modelResolverService: Record<string, any>

  beforeEach(() => {
    pipelineModel = {
      create: vi.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
      find: vi.fn().mockReturnValue(createQuery([])),
      findOne: vi.fn(),
      findOneAndUpdate: vi.fn().mockReturnValue(createQuery({})),
      findByIdAndUpdate: vi.fn().mockReturnValue(createQuery({})),
      findById: vi.fn().mockReturnValue(createQuery(null)),
    }
    brandModel = {
      findOne: vi.fn(),
      findById: vi.fn().mockReturnValue(createQuery(null)),
    }
    frameExtractService = {
      ensureLocalVideo: vi.fn(),
      probeVideoMetadata: vi.fn(),
      extractKeyFrames: vi.fn(),
    }
    dedupService = {
      createStrategy: vi.fn(),
    }
    modelResolverService = {
      validatePipelineOverrides: vi.fn().mockResolvedValue({}),
      resolveCapability: vi.fn().mockResolvedValue({
        id: 'runtime-model',
        label: 'Runtime Model',
        provider: 'test',
        runtimeModel: 'test-runtime',
        source: 'default',
      }),
    }

    service = new PipelineService(
      pipelineModel as any,
      brandModel as any,
      frameExtractService as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      dedupService as any,
      {} as any,
      modelResolverService as any,
    )
  })

  it('应在创建管线时落库模板配置、分发规则与群绑定', async () => {
    const orgId = new Types.ObjectId().toString()
    const brandId = new Types.ObjectId()
    const assignmentId = new Types.ObjectId().toString()
    const platformAccountId = new Types.ObjectId().toString()
    const brand = {
      _id: brandId,
      orgId: new Types.ObjectId(orgId),
      isActive: true,
      name: '越小啤',
      assets: {
        logoUrl: 'https://cdn.example.com/logo.png',
        colors: ['#111111'],
        fonts: ['PingFang SC'],
      },
      videoStyle: {
        preferredDuration: 20,
        aspectRatio: '9:16',
      },
    }

    brandModel.findOne.mockReturnValue(createQuery(brand))

    await service.create(orgId, brandId.toString(), {
      name: '种草线',
      templateId: 'preset-seeding-line',
      styleConfig: {
        tone: '生活化',
        visualStyle: '日常场景',
        platforms: ['douyin', 'xiaohongshu'],
      },
      distributionRules: {
        preferredCategories: ['beer'],
        templateIds: ['b7-ai-live'],
        accountTypes: ['xiaohongshu'],
        targets: [
          {
            employeeName: '小王',
            assignmentId,
            imChannel: 'wecom',
            imUserId: 'wecom_user_1',
            targetPlatforms: ['douyin'],
            outputConfig: {
              platformAccountId,
            },
          },
        ],
      },
      groupBinding: {
        channel: 'wecom',
        groupId: 'chat_1',
        groupName: '精酿啤酒种草线',
      },
    } as any)

    expect(pipelineModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '种草线',
        templateId: 'preset-seeding-line',
        imGroupId: 'chat_1',
        styleConfig: expect.objectContaining({
          duration: 20,
          tone: '生活化',
          visualStyle: '日常场景',
          platforms: ['douyin', 'xiaohongshu'],
          brandAssets: expect.objectContaining({
            logo: 'https://cdn.example.com/logo.png',
          }),
        }),
        distributionRules: expect.objectContaining({
          assignmentIds: [assignmentId],
          preferredPlatforms: ['douyin', 'xiaohongshu'],
          preferredCategories: ['beer'],
          templateIds: ['b7-ai-live'],
          accountTypes: ['xiaohongshu'],
          platformAccountIds: [platformAccountId],
        }),
        groupBinding: expect.objectContaining({
          channel: 'wecom',
          groupId: 'chat_1',
          groupName: '精酿啤酒种草线',
        }),
      }),
    )
  })

  it('应把员工目标规则折叠为可分发的 assignment 与平台集合', async () => {
    const orgId = new Types.ObjectId().toString()
    const pipelineId = new Types.ObjectId()
    const assignmentId = new Types.ObjectId().toString()
    const platformAccountId = new Types.ObjectId().toString()
    const pipeline = {
      _id: pipelineId,
      orgId: new Types.ObjectId(orgId),
      brandId: new Types.ObjectId(),
      status: 'active',
      styleConfig: {
        platforms: ['xiaohongshu'],
      },
      distributionRules: {
        strategy: 'round-robin',
      },
    }

    pipelineModel.findOne.mockReturnValue(createQuery(pipeline))

    await service.updateDistributionRules(orgId, pipelineId.toString(), {
      targets: [
        {
          employeeName: '小王',
          assignmentId,
          targetPlatforms: ['douyin'],
          outputConfig: {
            platformAccountId,
          },
        },
      ],
      preferredCategories: ['beer'],
      templateIds: ['b7-ai-live'],
      accountTypes: ['xiaohongshu'],
      strategy: 'priority',
    })

    expect(pipelineModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.any(Object),
      {
        $set: {
          distributionRules: expect.objectContaining({
            assignmentIds: [assignmentId],
            preferredPlatforms: ['douyin', 'xiaohongshu'],
            preferredCategories: ['beer'],
            templateIds: ['b7-ai-live'],
            accountTypes: ['xiaohongshu'],
            platformAccountIds: [platformAccountId],
            strategy: 'priority',
          }),
        },
      },
      { new: true },
    )
  })

  it('应在绑定群后同步 imGroupId 与群绑定信息', async () => {
    const orgId = new Types.ObjectId().toString()
    const pipelineId = new Types.ObjectId()
    const pipeline = {
      _id: pipelineId,
      orgId: new Types.ObjectId(orgId),
      brandId: new Types.ObjectId(),
      status: 'active',
      groupBinding: {},
    }

    pipelineModel.findOne.mockReturnValue(createQuery(pipeline))

    await service.bindGroup(
      orgId,
      pipelineId.toString(),
      {
        channel: 'feishu',
        groupId: 'ou_chat_1',
        groupName: '品牌故事线',
      },
      'user_1',
    )

    expect(pipelineModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.any(Object),
      {
        $set: {
          groupBinding: expect.objectContaining({
            channel: 'feishu',
            groupId: 'ou_chat_1',
            groupName: '品牌故事线',
            boundBy: 'user_1',
          }),
          imGroupId: 'ou_chat_1',
        },
      },
      { new: true },
    )
  })

  it('应为 b7 模板自动落库 style rewrite 默认配置', async () => {
    const orgId = new Types.ObjectId().toString()
    const brandId = new Types.ObjectId()
    const brand = {
      _id: brandId,
      orgId: new Types.ObjectId(orgId),
      isActive: true,
      name: '越小啤',
      assets: {},
      videoStyle: {},
    }

    brandModel.findOne.mockReturnValue(createQuery(brand))

    await service.create(orgId, brandId.toString(), {
      name: 'AI 微动效线',
      templateId: 'b7-ai-live',
    } as any)

    expect(pipelineModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        templateId: 'b7-ai-live',
        styleConfig: expect.objectContaining({
          styleRewrite: expect.objectContaining({
            enabled: true,
            scope: 'shared',
            preserveComposition: true,
            preserveProductPlacement: true,
          }),
        }),
      }),
    )
  })

  it('应在分析源视频时遵循模板默认值并允许 metadata 关闭 style rewrite', async () => {
    const orgId = new Types.ObjectId()
    const brandId = new Types.ObjectId()
    const pipelineId = new Types.ObjectId()
    const taskId = new Types.ObjectId()

    pipelineModel.findById.mockReturnValue(createQuery({
      _id: pipelineId,
      templateId: 'b9-product-showcase',
      styleConfig: {
        styleRewrite: {
          enabled: true,
          scope: 'per_scene',
        },
      },
      preferences: {},
    }))
    brandModel.findById.mockReturnValue(createQuery({
      _id: brandId,
      name: '测试品牌',
      assets: {
        colors: ['#111111'],
        fonts: ['PingFang SC'],
        slogans: ['好喝不贵'],
        keywords: ['精酿'],
        prohibitedWords: [],
      },
      videoStyle: {
        preferredDuration: 18,
        aspectRatio: '9:16',
        subtitleStyle: {},
        referenceVideoUrl: '',
      },
    }))
    frameExtractService.ensureLocalVideo.mockResolvedValue('/tmp/source.mp4')
    frameExtractService.probeVideoMetadata.mockResolvedValue({
      durationSeconds: 12,
      width: 1080,
      height: 1920,
      frameRate: 30,
      hasAudio: true,
    })
    frameExtractService.extractKeyFrames.mockResolvedValue([])
    dedupService.createStrategy.mockReturnValue({
      cropScale: 1,
      cropXRatio: 0,
      cropYRatio: 0,
      hueShift: 0,
      saturation: 1,
      contrast: 1,
      brightness: 0,
      noise: 0,
      speedFactor: 1,
      metadataFingerprint: 'fp-1',
    })

    const context = await service.analyzeSource({
      _id: taskId,
      orgId,
      brandId,
      pipelineId,
      sourceVideoUrl: 'https://cdn.example.com/source.mp4',
      metadata: {
        productionBatch: {
          templateId: 'b9-product-showcase',
          styleOverrides: {
            styleRewriteEnabled: false,
          },
        },
      },
    } as any)

    expect(context.templateId).toBe('b9-product-showcase')
    expect(context.styleRewrite).toEqual(expect.objectContaining({
      enabled: false,
      scope: 'per_scene',
      preserveComposition: true,
      preserveProductPlacement: true,
    }))
  })
})
