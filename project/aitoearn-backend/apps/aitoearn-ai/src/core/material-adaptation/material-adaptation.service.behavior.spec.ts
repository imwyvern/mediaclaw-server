import { AccountType } from '@yikart/common'
import { Types } from 'mongoose'
import { describe, expect, it, vi } from 'vitest'
import { AdaptMaterialDto } from './material-adaptation.dto'
import { MaterialAdaptationService } from './material-adaptation.service'

vi.mock('../../config', () => {
  return {
    config: {
      serverClient: {
        baseUrl: 'https://server.example.com',
        token: 'server-token',
      },
      ai: {
        gemini: {
          apiKey: 'gemini-key',
          baseUrl: 'https://gemini.example.com',
        },
        models: {
          chat: [
            {
              name: 'gemini-3-flash-preview',
              pricing: {
                input: 1,
                output: 1,
              },
            },
          ],
        },
      },
    },
  }
})

vi.mock('@yikart/mongodb', () => {
  return {
    AiLogChannel: {
      Gemini: 'gemini',
    },
    AiLogStatus: {
      Success: 'success',
      Failed: 'failed',
    },
    AiLogType: {
      Agent: 'agent',
    },
    BrandRepository: class {},
    PipelineRepository: class {},
    VideoTaskRepository: class {},
    Material: class {},
    MaterialRepository: class {},
    MaterialAdaptationRepository: class {},
    AiLogRepository: class {},
  }
})

interface AdaptationContextSnapshotTest {
  brand: {
    id: string
    name: string
    keywords: string[]
    prohibitedWords: string[]
  } | null
  pipeline: {
    id: string
    type: string
    preferredStyles: string[]
  } | null
  copy: {
    copyStyle: string
    copyModel: string
  } | null
}

type MaterialAdaptationServicePrivate = MaterialAdaptationService & {
  resolveAdaptationContext: (
    material: Record<string, unknown>,
    dto: { brandId?: string, pipelineId?: string },
  ) => Promise<AdaptationContextSnapshotTest>
  handleCompliantPlatforms: (...args: unknown[]) => Promise<Array<{ platform: string }>>
  handleNonCompliantPlatforms: (...args: unknown[]) => Promise<Array<{ platform: string }>>
  buildAdaptationPrompt: (
    material: Record<string, unknown>,
    platforms: AccountType[],
    context?: unknown,
  ) => string
  mergePlatformOptions: (
    platform: string,
    material: Record<string, unknown>,
    context?: unknown,
    existingOptions?: Record<string, unknown>,
    aiGeneratedOption?: Record<string, unknown>,
  ) => Record<string, unknown> | undefined
}

function createService() {
  const brandId = new Types.ObjectId().toString()
  const pipelineId = new Types.ObjectId().toString()
  const taskId = new Types.ObjectId().toString()
  const materialId = new Types.ObjectId().toString()

  const brandRepository = {
    getActiveById: vi.fn().mockResolvedValue({
      _id: new Types.ObjectId(brandId),
      name: '柚子铺',
      industry: '茶饮',
      assets: {
        logoUrl: 'https://assets.example.com/logo.png',
        colors: ['#F97316'],
        fonts: ['HarmonyOS Sans'],
        slogans: ['鲜萃果茶，现做现饮'],
        keywords: ['柚子茶', '鲜果茶'],
        prohibitedWords: ['第一', '根治'],
        referenceImages: ['https://assets.example.com/ref-1.png'],
      },
      videoStyle: {
        preferredDuration: 15,
        aspectRatio: '9:16',
        subtitleStyle: { font: 'HarmonyOS Sans' },
        referenceVideoUrl: 'https://assets.example.com/reference.mp4',
      },
      isActive: true,
    }),
  }

  const pipelineRepository = {
    getById: vi.fn().mockResolvedValue({
      _id: new Types.ObjectId(pipelineId),
      name: '促销线 A',
      type: 'promo',
      description: '限时促销短视频',
      styleConfig: {
        duration: 12,
        aspectRatio: '9:16',
        tone: '紧迫感',
        visualStyle: '高对比明快',
        brandAssets: {
          logo: 'https://assets.example.com/logo.png',
          colors: ['#F97316'],
          fonts: ['HarmonyOS Sans'],
        },
        styleRewrite: {
          enabled: true,
          scope: 'shared',
          mutationDomains: ['lighting'],
        },
      },
      preferences: {
        preferredStyles: ['hook_fast'],
        avoidStyles: ['slow_intro'],
        preferredDuration: 12,
        aspectRatio: '9:16',
        subtitlePreferences: { emphasis: 'high' },
      },
      warmUp: {
        status: 'ready',
      },
    }),
  }

  const videoTaskRepository = {
    getById: vi.fn().mockResolvedValue({
      _id: new Types.ObjectId(taskId),
      brandId: new Types.ObjectId(brandId),
      pipelineId: new Types.ObjectId(pipelineId),
    }),
  }

  const materialRepository = {
    getInfo: vi.fn().mockResolvedValue({
      id: materialId,
      taskId,
      userId: 'user-1',
      type: 'video',
      title: '今天试喝柚子铺新品',
      desc: '12 秒看懂新品亮点和活动信息',
      topics: ['新品', '果茶'],
      option: {
        copy: {
          copyStyle: '种草',
          copyModel: 'gemini',
        },
      },
      accountTypes: [AccountType.INSTAGRAM],
    }),
  }

  const materialAdaptationRepository = {
    listByMaterialId: vi.fn().mockResolvedValue([]),
    upsertByMaterialIdAndPlatform: vi.fn(),
    getByMaterialIdAndPlatform: vi.fn(),
    updateByMaterialIdAndPlatform: vi.fn(),
    deleteByMaterialIdAndPlatform: vi.fn(),
    deleteManyByMaterialId: vi.fn(),
  }

  const creditsHelper = {
    deductCredits: vi.fn(),
  }

  const aiLogRepo = {
    create: vi.fn(),
  }

  const service = new MaterialAdaptationService(
    brandRepository as never,
    pipelineRepository as never,
    videoTaskRepository as never,
    materialRepository as never,
    materialAdaptationRepository as never,
    creditsHelper as never,
    aiLogRepo as never,
  )

  return {
    brandId,
    pipelineId,
    taskId,
    materialId,
    service,
    brandRepository,
    pipelineRepository,
    videoTaskRepository,
    materialRepository,
    materialAdaptationRepository,
  }
}

describe('materialAdaptationService behavior', () => {
  it('should resolve brand and pipeline context from the linked material task', async () => {
    const { materialRepository, materialId, service } = createService()
    const servicePrivate = service as unknown as MaterialAdaptationServicePrivate
    const material = await materialRepository.getInfo(materialId)

    const context = await servicePrivate.resolveAdaptationContext(material, {})

    expect(context.brand?.name).toBe('柚子铺')
    expect(context.brand?.keywords).toEqual(['柚子茶', '鲜果茶'])
    expect(context.pipeline?.type).toBe('promo')
    expect(context.pipeline?.preferredStyles).toEqual(['hook_fast'])
    expect(context.copy).toEqual({
      copyStyle: '种草',
      copyModel: 'gemini',
    })
  })

  it('should force contextual rewrite for compliant platforms when brand or pipeline context exists', async () => {
    const { brandId, materialId, pipelineId, service } = createService()
    const servicePrivate = service as unknown as MaterialAdaptationServicePrivate
    const compliantSpy = vi.spyOn(servicePrivate, 'handleCompliantPlatforms')
    const nonCompliantSpy = vi.spyOn(servicePrivate, 'handleNonCompliantPlatforms').mockResolvedValue([
      {
        platform: AccountType.INSTAGRAM,
      },
    ])

    const result = await service.adaptMaterial(AdaptMaterialDto.create({
      materialId,
      platforms: [AccountType.INSTAGRAM],
      brandId,
      pipelineId,
      forceRegenerate: false,
    }))

    expect(result).toHaveLength(1)
    expect(nonCompliantSpy).toHaveBeenCalledTimes(1)
    expect(compliantSpy).not.toHaveBeenCalled()
  })

  it('should inject brand assets and pipeline style into prompts and default platform options', async () => {
    const { materialRepository, materialId, service } = createService()
    const servicePrivate = service as unknown as MaterialAdaptationServicePrivate
    const material = await materialRepository.getInfo(materialId)
    const context = await servicePrivate.resolveAdaptationContext(material, {})

    const prompt = servicePrivate.buildAdaptationPrompt(material, [AccountType.INSTAGRAM, AccountType.TIKTOK], context)
    const instagramOption = servicePrivate.mergePlatformOptions(AccountType.INSTAGRAM, material, context)
    const tiktokOption = servicePrivate.mergePlatformOptions(AccountType.TIKTOK, material, context)

    expect(prompt).toContain('品牌资产约束')
    expect(prompt).toContain('禁用词')
    expect(prompt).toContain('促销线')
    expect(prompt).toContain('hook_fast')
    expect(instagramOption).toEqual({
      instagram: {
        content_category: 'reel',
      },
    })
    expect(tiktokOption).toEqual({
      tiktok: {
        brand_organic_toggle: true,
        brand_content_toggle: true,
        comment_disabled: false,
        duet_disabled: false,
        stitch_disabled: false,
      },
    })
  })
})
