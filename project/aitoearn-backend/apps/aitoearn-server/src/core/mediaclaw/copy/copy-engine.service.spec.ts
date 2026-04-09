import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CopyEngineService } from './copy-engine.service'

function createQuery<T>(value: T) {
  const query = {
    limit: vi.fn(),
    lean: vi.fn(),
    sort: vi.fn(),
    exec: vi.fn().mockResolvedValue(value),
  }
  query.limit.mockReturnValue(query)
  query.lean.mockReturnValue(query)
  query.sort.mockReturnValue(query)
  return query
}

describe('copyEngineService', () => {
  beforeEach(() => {
    delete process.env['MEDIACLAW_COPY_PROVIDER']
    delete process.env['MEDIACLAW_DEEPSEEK_API_KEY']
    delete process.env['MEDIACLAW_GEMINI_API_KEY']
    process.env['MEDIACLAW_COPY_PROVIDER'] = 'heuristic'
  })

  it('should generate heuristic copy with blue words and 3 comment guides', async () => {
    const brandModel = {
      findById: vi.fn().mockReturnValue(createQuery({
        _id: { toString: () => 'brand-1' },
        name: '今斑堂',
        orgId: { toString: () => 'org-1' },
        assets: {
          keywords: ['护肤', '修护'],
          prohibitedWords: [],
        },
        videoStyle: {
          preferredDuration: 15,
          aspectRatio: '9:16',
          subtitleStyle: {},
          referenceVideoUrl: '',
        },
      })),
    }
    const copyHistoryModel = {
      create: vi.fn().mockResolvedValue(undefined),
      find: vi.fn().mockReturnValue(createQuery([])),
      findOneAndUpdate: vi.fn().mockReturnValue(createQuery({})),
    }

    const service = new CopyEngineService(brandModel as any, copyHistoryModel as any)
    const result = await service.generateCopy('507f1f77bcf86cd799439031', 'https://cdn.example.com/video.mp4', {
      scene: '新品上架',
      taskId: '507f1f77bcf86cd799439011',
    })

    expect(result.title.length).toBeLessThanOrEqual(60)
    expect(result.hashtags.length).toBeGreaterThanOrEqual(5)
    expect(result.blueWords.length).toBeGreaterThan(0)
    expect(result.description.length).toBeGreaterThanOrEqual(30)
    expect(result.commentGuides).toHaveLength(3)
    expect(result.commentGuide.split('\n')).toHaveLength(3)
  })

  it('should normalize unstable llm output into valid copy payload', async () => {
    const brandModel = {
      findById: vi.fn().mockReturnValue(createQuery({
        _id: { toString: () => 'brand-2' },
        name: 'MediaClaw',
        orgId: { toString: () => 'org-2' },
        assets: {
          keywords: ['营销', '增长'],
          prohibitedWords: ['最强'],
        },
        videoStyle: {
          preferredDuration: 15,
          aspectRatio: '9:16',
          subtitleStyle: {},
          referenceVideoUrl: '',
        },
      })),
    }
    const copyHistoryModel = {
      create: vi.fn().mockResolvedValue(undefined),
      find: vi.fn().mockReturnValue(createQuery([])),
      findOneAndUpdate: vi.fn().mockReturnValue(createQuery({})),
    }

    const service = new CopyEngineService(brandModel as any, copyHistoryModel as any)
    vi.spyOn(service as any, 'generateWithProvider').mockResolvedValue({
      draft: {
        title: '超短标题',
        subtitle: '太短',
        hashtags: ['增长'],
        blueWords: [],
        commentGuides: ['只给一条'],
      },
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        model: '',
        cost: 0,
      },
      provider: 'heuristic',
    })

    const result = await service.generateCopy('507f1f77bcf86cd799439032', 'https://cdn.example.com/video.mp4', {
      platform: 'xiaohongshu',
    })

    expect(result.subtitle.length).toBeGreaterThanOrEqual(15)
    expect(result.description.length).toBeGreaterThanOrEqual(30)
    expect(result.hashtags.length).toBeGreaterThanOrEqual(5)
    expect(result.commentGuides).toHaveLength(3)
    expect(result.blueWords.length).toBeGreaterThan(0)
  })

  it('should filter prohibited words from generated copy payload', async () => {
    const brandModel = {
      findById: vi.fn().mockReturnValue(createQuery({
        _id: { toString: () => 'brand-3' },
        name: 'MediaClaw',
        orgId: { toString: () => 'org-3' },
        industry: '护肤',
        assets: {
          keywords: ['修护'],
          slogans: ['温和修护'],
          prohibitedWords: ['最强', '第一'],
        },
      })),
    }
    const copyHistoryModel = {
      create: vi.fn().mockResolvedValue(undefined),
      find: vi.fn().mockReturnValue(createQuery([])),
      findOneAndUpdate: vi.fn().mockReturnValue(createQuery({})),
    }

    const service = new CopyEngineService(brandModel as any, copyHistoryModel as any)
    vi.spyOn(service as any, 'generateWithProvider').mockResolvedValue({
      draft: {
        title: '最强修护方案来了',
        subtitle: '第一眼就能看懂',
        description: '这是第一套最强修护方案，适合直接照着发。',
        hashtags: ['最强修护', '护肤'],
        blueWords: ['修护'],
        commentGuides: ['留言最强', '评论第一', '一起交流'],
      },
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        model: '',
        cost: 0,
      },
      provider: 'heuristic',
    })

    const result = await service.generateCopy('507f1f77bcf86cd799439033', 'https://cdn.example.com/video.mp4', {
      scene: '新品种草',
    })

    expect(result.title).not.toContain('最强')
    expect(result.subtitle).not.toContain('第一')
    expect(result.description).not.toContain('最强')
    expect(result.description).not.toContain('第一')
    expect(result.hashtags.some(item => item.includes('最强') || item.includes('第一'))).toBe(false)
    expect(result.commentGuides.some(item => item.includes('最强') || item.includes('第一'))).toBe(false)
  })

  it('should use source hint metadata when video url is unavailable', async () => {
    const brandModel = {
      findById: vi.fn().mockResolvedValue(null),
    }
    const copyHistoryModel = {
      create: vi.fn().mockResolvedValue(undefined),
      find: vi.fn().mockReturnValue(createQuery([])),
      findOneAndUpdate: vi.fn().mockReturnValue(createQuery({})),
    }

    const service = new CopyEngineService(brandModel as any, copyHistoryModel as any)
    const generateWithProviderSpy = vi.spyOn(service as any, 'generateWithProvider').mockResolvedValue({
      draft: {
        title: '图文标题',
        subtitle: '这是一段足够长的图文字幕内容',
        description: '这是一段足够长的图文正文内容，用于图文草稿输出。',
        hashtags: ['#图文', '#探店', '#咖啡', '#夏日', '#种草'],
        blueWords: ['想看菜单'],
        commentGuides: ['留言要地址', '评论想看菜单', '点个收藏下次来'],
      },
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        model: '',
        cost: 0,
      },
      provider: 'heuristic',
    })

    await service.generateCopy(null, '', {
      scene: '夏日图文种草',
      sourceHint: '首图为门店外立面，后续图片包含冰咖啡与甜品近景。',
    })

    expect(generateWithProviderSpy).toHaveBeenCalledWith(expect.objectContaining({
      sourceHint: '首图为门店外立面，后续图片包含冰咖啡与甜品近景。',
    }))
  })

  it('should honor forced copy provider metadata before env fallback', async () => {
    process.env['MEDIACLAW_COPY_PROVIDER'] = 'gemini'
    process.env['MEDIACLAW_DEEPSEEK_API_KEY'] = 'deepseek-key'
    process.env['MEDIACLAW_GEMINI_API_KEY'] = 'gemini-key'
    process.env['DEEPSEEK_MODEL'] = 'deepseek-v3'

    const brandModel = {
      findById: vi.fn().mockResolvedValue(null),
    }
    const copyHistoryModel = {
      create: vi.fn().mockResolvedValue(undefined),
      find: vi.fn().mockReturnValue(createQuery([])),
      findOneAndUpdate: vi.fn().mockReturnValue(createQuery({})),
    }

    const service = new CopyEngineService(brandModel as any, copyHistoryModel as any)
    const runtime = await (service as any).resolveProviderConfig({
      copyProvider: 'deepseek',
    })

    expect(runtime).toMatchObject({
      provider: 'deepseek',
      model: 'deepseek-v3',
    })
  })

  it('should use trending blue words and comment guide words from recent history', async () => {
    const brandModel = {
      findById: vi.fn().mockReturnValue(createQuery({
        _id: { toString: () => 'brand-4' },
        name: 'MediaClaw',
        orgId: { toString: () => '507f1f77bcf86cd799439041' },
        assets: {
          keywords: ['护肤'],
          prohibitedWords: [],
        },
      })),
    }
    const history = [
      {
        _id: { toString: () => '507f1f77bcf86cd799439051' },
        title: '春日护肤别再乱拍',
        subtitle: '字幕',
        description: '正文',
        hashtags: ['#春日变美', '#护肤教程'],
        blueWords: ['#春日变美'],
        commentGuides: ['评论“模板”我发你'],
        performance: {
          views: 82000,
          ctr: 0.18,
        },
        variantPerformance: {
          score: 86,
          bestPerformer: true,
        },
        createdAt: new Date().toISOString(),
      },
    ]
    const copyHistoryModel = {
      create: vi.fn().mockResolvedValue(undefined),
      find: vi.fn().mockReturnValue(createQuery(history)),
      findOneAndUpdate: vi.fn().mockReturnValue(createQuery({})),
    }
    const organizationModel = {
      findById: vi.fn().mockReturnValue(createQuery(null)),
    }

    const service = new CopyEngineService(
      brandModel as any,
      copyHistoryModel as any,
      organizationModel as any,
    )
    vi.spyOn(service as any, 'generateWithProvider').mockResolvedValue({
      draft: {
        title: '护肤结果直接拉满',
        subtitle: '这是一段足够长的字幕内容',
        description: '这是一段足够长的正文内容，适合直接发到平台。',
        hashtags: ['#护肤教程'],
        blueWords: [],
        commentGuides: [],
      },
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        model: '',
        cost: 0,
      },
      provider: 'heuristic',
    })

    const result = await service.generateCopy(
      '507f1f77bcf86cd799439042',
      'https://cdn.example.com/video.mp4',
      {
        orgId: '507f1f77bcf86cd799439041',
        scene: '春日护肤种草',
      },
    )

    expect(result.blueWords).toContain('#春日变美')
    expect(result.commentGuides[0]).toContain('模板')
  })

  it('should diversify duplicate copy against recent 1000 captions and store dedup fingerprint', async () => {
    const brandModel = {
      findById: vi.fn().mockReturnValue(createQuery({
        _id: { toString: () => 'brand-5' },
        name: 'MediaClaw',
        orgId: { toString: () => '507f1f77bcf86cd799439061' },
        assets: {
          keywords: ['增长'],
          prohibitedWords: [],
        },
      })),
    }
    const duplicateHistory = [
      {
        _id: { toString: () => '507f1f77bcf86cd799439071' },
        taskId: { toString: () => '507f1f77bcf86cd799439072' },
        title: '同款标题',
        subtitle: '这是一段足够长的字幕内容，用于重复检测',
        description: '这是一段足够长的正文内容，用于重复检测和标题去重。',
        hashtags: ['#增长'],
        blueWords: ['#增长'],
        commentGuides: ['评论“案例”我发你'],
        performance: {
          views: 10000,
          ctr: 0.1,
        },
        variantPerformance: {
          score: 30,
          bestPerformer: false,
        },
        dedupFingerprint: '同款标题这是一段足够长的字幕内容用于重复检测这是一段足够长的正文内容用于重复检测和标题去重',
        createdAt: new Date().toISOString(),
      },
    ]
    const copyHistoryModel = {
      create: vi.fn().mockResolvedValue(undefined),
      find: vi.fn().mockReturnValue(createQuery(duplicateHistory)),
      findOneAndUpdate: vi.fn().mockReturnValue(createQuery({})),
    }
    const organizationModel = {
      findById: vi.fn().mockReturnValue(createQuery(null)),
    }

    const service = new CopyEngineService(
      brandModel as any,
      copyHistoryModel as any,
      organizationModel as any,
    )
    vi.spyOn(service as any, 'generateWithProvider').mockResolvedValue({
      draft: {
        title: '同款标题',
        subtitle: '这是一段足够长的字幕内容，用于重复检测',
        description: '这是一段足够长的正文内容，用于重复检测和标题去重。',
        hashtags: ['#增长'],
        blueWords: ['#增长'],
        commentGuides: ['评论“案例”我发你'],
      },
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        model: '',
        cost: 0,
      },
      provider: 'heuristic',
    })

    const result = await service.generateCopy(
      '507f1f77bcf86cd799439062',
      'https://cdn.example.com/video.mp4',
      {
        orgId: '507f1f77bcf86cd799439061',
        scene: '增长投放',
      },
    )

    expect(result.title).not.toBe('同款标题')
    expect(copyHistoryModel.create).toHaveBeenCalledWith(expect.objectContaining({
      dedupFingerprint: expect.any(String),
    }))
  })
})
