import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Types } from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PipelineFeedbackSourceType } from './pipeline-feedback.constants'
import { PipelinePreferenceLearningService } from './pipeline-preference-learning.service'
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
  let deepSynthesisMarkerService: Record<string, any>
  let dedupService: Record<string, any>
  let modelResolverService: Record<string, any>
  let qualityCheckService: Record<string, any>
  let subtitleService: Record<string, any>
  let templateRegistry: Record<string, any>
  let ttsService: Record<string, any>
  let pipelinePreferenceLearningService: PipelinePreferenceLearningService

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
    deepSynthesisMarkerService = {
      createMarker: vi.fn().mockReturnValue({
        visibleLabel: 'AI 生成',
        watermarkText: 'MediaClaw',
        metadata: {},
        manifest: {
          standard: 'mc-v1',
          label: 'AI 生成',
          watermarkText: 'MediaClaw',
          brandName: '越小啤',
          taskId: new Types.ObjectId().toString(),
          appliedAt: new Date('2026-04-09T00:00:00.000Z').toISOString(),
          metadata: {},
        },
      }),
    }
    subtitleService = {
      renderSubtitles: vi.fn(),
    }
    dedupService = {
      createStrategy: vi.fn(),
      applyVideoPostProcess: vi.fn().mockResolvedValue(undefined),
    }
    qualityCheckService = {
      assertQuality: vi.fn(),
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
    templateRegistry = {
      run: vi.fn(),
    }
    ttsService = {
      isConfigured: vi.fn().mockReturnValue(false),
      generateVoiceover: vi.fn(),
    }
    pipelinePreferenceLearningService = new PipelinePreferenceLearningService()

    service = new PipelineService(
      pipelineModel as any,
      brandModel as any,
      frameExtractService as any,
      {} as any,
      {} as any,
      deepSynthesisMarkerService as any,
      subtitleService as any,
      dedupService as any,
      qualityCheckService as any,
      modelResolverService as any,
      pipelinePreferenceLearningService as any,
      templateRegistry as any,
      ttsService as any,
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

  it('应支持通过 templateType 与 params 创建模板化 pipeline', async () => {
    const orgId = new Types.ObjectId().toString()
    const brandId = new Types.ObjectId()
    const brand = {
      _id: brandId,
      orgId: new Types.ObjectId(orgId),
      isActive: true,
      name: '越小啤',
      assets: {
        logoUrl: 'https://cdn.example.com/logo.png',
        colors: ['#111111'],
        fonts: ['PingFang SC'],
        slogans: ['越喝越上头'],
        keywords: ['精酿', '啤酒'],
      },
      videoStyle: {
        preferredDuration: 20,
        aspectRatio: '9:16',
      },
    }

    brandModel.findOne.mockReturnValue(createQuery(brand))
    templateRegistry.run.mockResolvedValue({
      templateId: 'b7-ai-live',
      type: 'seeding',
      name: '越小啤 AI 微动效线',
      description: '模板创建',
      styleConfig: {
        duration: 5,
        aspectRatio: '9:16',
        tone: '高频轻量种草',
        visualStyle: 'AI 微动效种草',
        platforms: ['douyin', 'xiaohongshu'],
        brandAssets: {
          logo: 'https://cdn.example.com/logo.png',
          colors: ['#111111'],
          fonts: ['PingFang SC'],
        },
        styleRewrite: {
          enabled: true,
          scope: 'shared',
          preserveComposition: true,
          preserveProductPlacement: true,
          mutationDomains: ['lighting direction'],
        },
      },
      distributionRules: {
        preferredPlatforms: ['douyin', 'xiaohongshu'],
        templateIds: ['b7-ai-live'],
        strategy: 'round-robin',
      },
      preferences: {
        preferredStyles: ['micro-motion'],
        preferredDuration: 5,
        aspectRatio: '9:16',
        subtitlePreferences: {
          templateId: 'b7-ai-live',
          workflow: 'brand_assets -> product_images -> kling/seedance i2v -> 5s video',
        },
      },
      runtime: {
        version: '1.0',
        estimatedCost: 15.1,
        estimatedDurationSec: 300,
        costMode: 'ai_video',
        requiredInputs: ['brand_assets', 'product_images'],
        optionalInputs: [],
        stages: [
          { name: 'i2v_generate', engine: 'kling/seedance', output: '5s branded video' },
        ],
        paramsSnapshot: {
          productImages: ['https://cdn.example.com/product-1.png'],
        },
      },
    })

    await service.create(orgId, brandId.toString(), {
      brandId: brandId.toString(),
      templateType: 'b7-ai-live',
      params: {
        productImages: ['https://cdn.example.com/product-1.png'],
      },
    } as any)

    expect(templateRegistry.run).toHaveBeenCalledWith('b7-ai-live', expect.objectContaining({
      brand: expect.objectContaining({
        id: brandId.toString(),
        name: '越小啤',
      }),
      params: {
        productImages: ['https://cdn.example.com/product-1.png'],
      },
    }))
    expect(pipelineModel.create).toHaveBeenCalledWith(expect.objectContaining({
      templateId: 'b7-ai-live',
      type: 'seeding',
      styleConfig: expect.objectContaining({
        duration: 5,
        visualStyle: 'AI 微动效种草',
      }),
      distributionRules: expect.objectContaining({
        preferredPlatforms: ['douyin', 'xiaohongshu'],
        templateIds: ['b7-ai-live'],
      }),
      preferences: expect.objectContaining({
        preferredStyles: ['micro-motion'],
        subtitlePreferences: expect.objectContaining({
          templateId: 'b7-ai-live',
          templateRuntime: expect.objectContaining({
            templateId: 'b7-ai-live',
            estimatedCost: 15.1,
          }),
        }),
      }),
    }))
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

  it('应按反馈权重学习并自动更新 pipeline 偏好参数', async () => {
    const orgId = new Types.ObjectId().toString()
    const pipelineId = new Types.ObjectId()
    const pipeline = {
      _id: pipelineId,
      orgId: new Types.ObjectId(orgId),
      brandId: new Types.ObjectId(),
      status: 'active',
      styleConfig: {
        duration: 15,
        aspectRatio: '9:16',
        tone: '平稳',
        visualStyle: '纪实',
      },
      distributionRules: {
        preferredPlatforms: ['douyin'],
        preferredCategories: ['beauty'],
      },
      preferences: {
        preferredStyles: ['story'],
        avoidStyles: [],
        preferredDuration: 15,
        aspectRatio: '9:16',
        feedbackLog: [
          {
            id: 'fb-1',
            sourceType: PipelineFeedbackSourceType.OPERATOR,
            weight: 0.7,
            preferredStyles: ['micro-motion'],
            avoidStyles: [],
            preferredPlatforms: ['xiaohongshu'],
            preferredCategories: ['beauty'],
            preferredDuration: 12,
            aspectRatio: '9:16',
            tone: '轻快',
            visualStyle: '近景展示',
            performanceData: {},
            rejectionReason: '',
            note: '运营反馈',
            createdAt: '2026-04-09T00:00:00.000Z',
          },
        ],
      },
      toObject() {
        return this
      },
    }

    pipelineModel.findOne.mockReturnValue(createQuery(pipeline))
    pipelineModel.findOneAndUpdate.mockReturnValue(createQuery({
      ...pipeline,
      preferences: {
        preferredStyles: ['micro-motion', 'close-up'],
        avoidStyles: ['slow-burn'],
        preferredDuration: 8,
        aspectRatio: '1:1',
        feedbackCount: 2,
        feedbackLog: [],
        preferenceLearning: {
          feedbackSources: {
            boss: 1,
            operator: 1,
          },
          preferredPlatforms: ['xiaohongshu', 'douyin'],
        },
      },
      styleConfig: {
        ...pipeline.styleConfig,
        tone: '高转化',
        visualStyle: '近景种草',
      },
      distributionRules: {
        preferredPlatforms: ['xiaohongshu', 'douyin'],
        preferredCategories: ['beauty', 'skincare'],
      },
    }))

    const result = await service.recordFeedback(orgId, pipelineId.toString(), {
      sourceType: PipelineFeedbackSourceType.BOSS,
      note: '老板要求更短更直接',
      preferredStyles: ['micro-motion', 'close-up'],
      avoidStyles: ['slow-burn'],
      preferredPlatforms: ['xiaohongshu'],
      preferredCategories: ['skincare'],
      preferredDuration: 8,
      aspectRatio: '1:1',
      tone: '高转化',
      visualStyle: '近景种草',
      performanceData: {
        engagementRate: 0.18,
      },
    })

    expect(pipelineModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        $set: expect.objectContaining({
          preferences: expect.objectContaining({
            preferredStyles: ['micro-motion', 'close-up'],
            avoidStyles: ['slow-burn'],
            preferredDuration: 10,
            aspectRatio: '1:1',
            feedbackCount: 2,
          }),
          styleConfig: expect.objectContaining({
            tone: '高转化',
            visualStyle: '近景种草',
          }),
          distributionRules: expect.objectContaining({
            preferredPlatforms: ['xiaohongshu', 'douyin'],
            preferredCategories: ['skincare', 'beauty'],
          }),
        }),
      }),
      { new: true },
    )
    expect(result.feedback.sourceType).toBe(PipelineFeedbackSourceType.BOSS)
    expect(result.learning).toEqual(expect.objectContaining({
      preferredPlatforms: ['xiaohongshu', 'douyin'],
    }))
  })

  it('应在视频收尾阶段生成配音并返回音频地址', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'pipeline-voiceover-'))
    const taskId = new Types.ObjectId()
    const task = {
      _id: taskId,
      metadata: {},
    }
    const context = {
      workspaceDir,
      composedVideoPath: join(workspaceDir, 'composed.mp4'),
      dedupStrategy: {},
      preserveSourceAudio: false,
      sourceMetadata: {
        hasAudio: false,
      },
      brand: {
        name: '越小啤',
        slogans: [],
        keywords: [],
      },
      targetDurationSeconds: 15,
      subtitles: [],
    }
    const copy = {
      title: '三步搞定精酿种草视频',
      subtitle: '开头三秒先抛记忆点',
      description: '结尾引导评论区互动',
      commentGuides: ['评论区告诉我你最想看的口味'],
    }
    const deepSynthesisMarker = deepSynthesisMarkerService.createMarker()

    subtitleService.renderSubtitles.mockResolvedValue({
      outputPath: join(workspaceDir, 'subtitled.mp4'),
      deepSynthesisMarker,
    })
    ttsService.isConfigured.mockReturnValue(true)
    ttsService.generateVoiceover.mockResolvedValue({
      buffer: Buffer.from('voiceover'),
      provider: 'minimax',
      voiceId: 'Chinese_Female_Gentle',
      format: 'mp3',
      sampleRate: 32000,
      durationMs: 1200,
    })

    const persistArtifactSpy = vi.spyOn(service as any, 'persistArtifact').mockImplementation(
      async (id: string, _inputPath: string, extension: string, suffix = '') =>
        `https://cdn.example.com/${id}${suffix ? `-${suffix}` : ''}.${extension}`,
    )
    const mixVoiceoverTrackSpy = vi.spyOn(service as any, 'mixVoiceoverTrack')
      .mockResolvedValue(join(workspaceDir, 'final-voiceover.mp4'))

    try {
      const result = await service.finalizeVideo(task as any, context as any, copy as any)

      expect(ttsService.generateVoiceover).toHaveBeenCalledWith(expect.objectContaining({
        text: '三步搞定精酿种草视频。开头三秒先抛记忆点。结尾引导评论区互动。评论区告诉我你最想看的口味',
      }))
      expect(persistArtifactSpy).toHaveBeenCalledWith(taskId.toString(), join(workspaceDir, 'voiceover.mp3'), 'mp3', 'voiceover')
      expect(mixVoiceoverTrackSpy).toHaveBeenCalledWith(
        join(workspaceDir, 'final.mp4'),
        join(workspaceDir, 'voiceover.mp3'),
        join(workspaceDir, 'final-voiceover.mp4'),
        false,
      )
      expect(result.voiceoverUrl).toBe(`https://cdn.example.com/${taskId.toString()}-voiceover.mp3`)
      expect(result.outputVideoUrl).toBe(`https://cdn.example.com/${taskId.toString()}.mp4`)
      expect(result.voiceoverMeta).toEqual(expect.objectContaining({
        provider: 'minimax',
        voiceId: 'Chinese_Female_Gentle',
      }))
    }
    finally {
      await rm(workspaceDir, { recursive: true, force: true })
    }
  })
})
