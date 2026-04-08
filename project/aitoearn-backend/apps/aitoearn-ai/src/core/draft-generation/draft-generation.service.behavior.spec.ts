import { FileUtil, UserType } from '@yikart/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DraftGenerationService } from './draft-generation.service'

vi.mock('../../config', () => {
  return {
    config: {
      ai: {
        models: {
          video: {
            generation: [
              {
                name: 'grok-imagine-video',
                channel: 'grok',
              },
            ],
          },
          chat: [
            {
              name: 'gemini-3-flash-preview',
              pricing: { price: '0' },
            },
          ],
        },
        gemini: {
          apiKey: 'test-key',
          baseUrl: 'https://gemini.example.com',
        },
        draftGeneration: {
          imageModels: [],
        },
      },
      serverClient: {
        baseUrl: 'https://server.example.com',
        token: 'server-token',
      },
    },
  }
})

vi.mock('@yikart/mongodb', () => {
  return {
    AiLogChannel: {
      Gemini: 'gemini',
      Grok: 'grok',
      AicsoVeo: 'aicso-veo',
      AicsoGrok: 'aicso-grok',
    },
    AiLogStatus: {
      Generating: 'generating',
      Success: 'success',
      Failed: 'failed',
    },
    AiLogType: {
      DraftGeneration: 'draft_generation',
      Agent: 'agent',
    },
    AssetType: {
      VideoThumbnail: 'video_thumbnail',
    },
    MaterialSource: {
      PlaceDraft: 'place_draft',
    },
    MaterialStatus: {
      SUCCESS: 1,
    },
    MaterialType: {
      VIDEO: 'video',
      ARTICLE: 'article',
    },
    MediaType: {
      VIDEO: 'video',
      IMG: 'img',
    },
    MaterialGroupRepository: class {},
    MaterialRepository: class {},
    AiLogRepository: class {},
    MediaRepository: class {},
    UserRepository: class {},
  }
})

function createService() {
  const materialGroupRepository = {}
  const materialRepository = {
    create: vi.fn(),
  }
  const aiLogRepository = {
    updateById: vi.fn(),
    create: vi.fn(),
  }
  const mediaMcp = {}
  const utilMcp = {}
  const videoUtilsMcp = {}
  const agentService = {}
  const queueService = {}
  const userRepository = {}
  const videoService = {}
  const assetsService = {
    uploadFromBuffer: vi.fn(),
  }
  const videoMetadataService = {
    extractThumbnailFromUrl: vi.fn(),
  }
  const imageService = {}
  const mediaRepository = {
    create: vi.fn(),
  }
  const draftCopyClientService = {
    generateCopy: vi.fn(),
  }

  const service = new DraftGenerationService(
    materialGroupRepository as never,
    materialRepository as never,
    aiLogRepository as never,
    mediaMcp as never,
    utilMcp as never,
    videoUtilsMcp as never,
    agentService as never,
    queueService as never,
    userRepository as never,
    videoService as never,
    assetsService as never,
    videoMetadataService as never,
    imageService as never,
    mediaRepository as never,
    draftCopyClientService as never,
  )

  return {
    service,
    materialRepository,
    aiLogRepository,
    assetsService,
    videoMetadataService,
    mediaRepository,
    draftCopyClientService,
  }
}

function createCopyResult(overrides: Partial<{
  copyHistoryId: string | null
  title: string
  subtitle: string
  description: string
  hashtags: string[]
  blueWords: string[]
  commentGuide: string
  commentGuides: string[]
}> = {}) {
  return {
    copyHistoryId: 'copy-1',
    variantIndex: 1,
    title: '夏日咖啡店标题',
    subtitle: '夏日咖啡门店氛围和招牌饮品一起展示',
    description: '这是一段适合直接发布的图文或视频文案，突出门店氛围、招牌饮品和到店转化。',
    hashtags: ['#夏日咖啡', '#探店', '#门店日常', '#饮品推荐', '#周末去处'],
    blueWords: ['求店名', '想看菜单'],
    commentGuide: '留言要地址\n评论想看菜单\n点个收藏下次来',
    commentGuides: ['留言要地址', '评论想看菜单', '点个收藏下次来'],
    ...overrides,
  }
}

type DraftGenerationServicePrivate = DraftGenerationService & {
  generateVideo: (...args: unknown[]) => Promise<{ videoUrl: string, points: number }>
  planImageTextWithGemini: (...args: unknown[]) => Promise<{ plan: { imagePrompts: string[] }, points: number }>
  generateImages: (...args: unknown[]) => Promise<{ urls: string[], points: number }>
}

describe('draftGenerationService behavior', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    FileUtil.init({ endpoint: 'https://assets.example.com' })
  })

  it('should persist copy-engine v2 payload for video drafts', async () => {
    const {
      service,
      materialRepository,
      aiLogRepository,
      assetsService,
      videoMetadataService,
      draftCopyClientService,
    } = createService()
    const privateService = service as unknown as DraftGenerationServicePrivate

    vi.spyOn(privateService, 'generateVideo').mockResolvedValue({
      videoUrl: '/video/generated.mp4',
      points: 12,
    })
    videoMetadataService.extractThumbnailFromUrl.mockResolvedValue(Buffer.from('thumb'))
    assetsService.uploadFromBuffer.mockResolvedValue({
      asset: { path: '/cover/generated.png' },
    })
    draftCopyClientService.generateCopy.mockResolvedValue(createCopyResult())
    materialRepository.create.mockResolvedValue({ id: 'material-video-1' })

    const result = await service.generateContentV2('ai-log-1', 'user-1', UserType.User, 'group-1', {
      prompt: '生成一条夏日咖啡店探店短视频',
      model: 'grok-imagine-video',
      draftType: 'draft',
      platforms: ['tiktok'],
      copyModel: 'deepseek',
      copyStyle: '种草',
    })

    expect(result.consumedPoints).toBe(12)
    expect(draftCopyClientService.generateCopy).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      theme: '生成一条夏日咖啡店探店短视频',
      platform: 'tiktok',
      style: '种草',
      provider: 'deepseek',
      videoUrl: '/video/generated.mp4',
    }))
    expect(materialRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      title: '夏日咖啡店标题',
      desc: expect.stringContaining('适合直接发布'),
      topics: ['#夏日咖啡', '#探店', '#门店日常', '#饮品推荐', '#周末去处'],
      option: {
        copy: expect.objectContaining({
          copyHistoryId: 'copy-1',
          requestedCopyModel: 'deepseek',
          copyStyle: '种草',
          subtitle: '夏日咖啡门店氛围和招牌饮品一起展示',
        }),
      },
    }))
    expect(aiLogRepository.updateById).toHaveBeenCalledWith('ai-log-1', expect.objectContaining({
      $set: expect.objectContaining({
        response: expect.objectContaining({
          materialId: 'material-video-1',
          subtitle: '夏日咖啡门店氛围和招牌饮品一起展示',
          hashtags: ['#夏日咖啡', '#探店', '#门店日常', '#饮品推荐', '#周末去处'],
          blueWords: ['求店名', '想看菜单'],
          commentGuides: ['留言要地址', '评论想看菜单', '点个收藏下次来'],
        }),
      }),
    }))
  })

  it('should persist copy-engine v2 payload for image-text drafts', async () => {
    const {
      service,
      materialRepository,
      aiLogRepository,
      draftCopyClientService,
    } = createService()
    const privateService = service as unknown as DraftGenerationServicePrivate

    vi.spyOn(privateService, 'planImageTextWithGemini').mockResolvedValue({
      plan: {
        imagePrompts: ['summer cafe storefront', 'iced latte close-up', 'dessert detail'],
      },
      points: 0,
    })
    vi.spyOn(privateService, 'generateImages').mockResolvedValue({
      urls: ['/img/1.png', '/img/2.png', '/img/3.png'],
      points: 9,
    })
    draftCopyClientService.generateCopy.mockResolvedValue(createCopyResult({
      copyHistoryId: 'copy-2',
      title: '夏日图文标题',
    }))
    materialRepository.create.mockResolvedValue({ id: 'material-article-1' })

    const result = await service.generateContentImageText('ai-log-2', 'user-2', UserType.User, 'group-2', {
      prompt: '生成一组夏日咖啡馆图文内容',
      imageModel: 'gemini-3.1-flash-image-preview',
      imageCount: 3,
      draftType: 'draft',
      platforms: ['xhs'],
      copyModel: 'gemini',
      copyStyle: '测评',
    })

    expect(result.consumedPoints).toBe(9)
    expect(draftCopyClientService.generateCopy).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-2',
      theme: '生成一组夏日咖啡馆图文内容',
      platform: 'xhs',
      style: '测评',
      provider: 'gemini',
      sourceHint: expect.stringContaining('AI 图文草稿已生成。'),
    }))
    expect(materialRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      title: '夏日图文标题',
      topics: ['#夏日咖啡', '#探店', '#门店日常', '#饮品推荐', '#周末去处'],
      option: {
        copy: expect.objectContaining({
          copyHistoryId: 'copy-2',
          requestedCopyModel: 'gemini',
          copyStyle: '测评',
        }),
      },
    }))
    expect(aiLogRepository.updateById).toHaveBeenCalledWith('ai-log-2', expect.objectContaining({
      $set: expect.objectContaining({
        response: expect.objectContaining({
          materialId: 'material-article-1',
          title: '夏日图文标题',
          hashtags: ['#夏日咖啡', '#探店', '#门店日常', '#饮品推荐', '#周末去处'],
          imageUrls: ['/img/1.png', '/img/2.png', '/img/3.png'],
        }),
      }),
    }))
  })
})
