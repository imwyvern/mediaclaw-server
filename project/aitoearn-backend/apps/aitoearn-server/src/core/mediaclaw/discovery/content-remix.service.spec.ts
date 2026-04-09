import { Types } from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContentRemixService } from './content-remix.service'

function createQuery<T>(value: T) {
  const query = {
    lean: vi.fn(),
    exec: vi.fn().mockResolvedValue(value),
  }
  query.lean.mockReturnValue(query)
  return query
}

describe('contentRemixService', () => {
  let viralContentModel: Record<string, ReturnType<typeof vi.fn>>
  let brandModel: Record<string, ReturnType<typeof vi.fn>>
  let pipelineModel: Record<string, ReturnType<typeof vi.fn>>
  let configService: {
    getString: ReturnType<typeof vi.fn>
    getNumber: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    viralContentModel = {
      findById: vi.fn(),
      findOne: vi.fn(),
      findByIdAndUpdate: vi.fn(),
    }
    brandModel = {
      findById: vi.fn(),
    }
    pipelineModel = {
      findById: vi.fn(),
      findByIdAndUpdate: vi.fn(),
    }
    configService = {
      getString: vi.fn().mockReturnValue(''),
      getNumber: vi.fn().mockReturnValue(5000),
    }
  })

  it('should generate a 5-dimension video recipe from video url and persist it', async () => {
    const contentId = new Types.ObjectId()
    const content = {
      _id: contentId,
      platform: 'bilibili',
      videoId: 'BV123456',
      title: '护肤教程为什么更容易起量',
      author: 'creator-a',
      industry: '美妆',
      keywords: ['护肤', '教程'],
      contentUrl: 'https://www.bilibili.com/video/BV123456',
      views: 120000,
      likes: 8600,
      comments: 920,
      shares: 510,
      viralScore: 88.6,
      publishedAt: new Date('2026-04-06T12:00:00.000Z'),
      remixBriefs: [],
    }
    viralContentModel.findOne.mockReturnValue(createQuery(content))
    viralContentModel.findByIdAndUpdate.mockReturnValue({ exec: vi.fn().mockResolvedValue(null) })

    const service = new ContentRemixService(
      viralContentModel as any,
      brandModel as any,
      pipelineModel as any,
      configService as any,
    )
    vi.spyOn(service as any, 'resolveAnalysis').mockResolvedValue({
      source: 'fallback',
      model: 'fallback',
      contentId: contentId.toString(),
      platform: 'bilibili',
      videoId: 'BV123456',
      title: content.title,
      summary: '结果前置 + 教程型结构 + 评论引导是核心爆点。',
      hooks: ['先给结果，再解释为什么有效'],
      narrativeBeats: ['结果', '证明', '评论 CTA'],
      structureBreakdown: ['开场抛结果', '中段给证明', '结尾让用户评论领取模板'],
      visualMotifs: ['近景产品特写', '大字利益点字幕'],
      audioCues: ['开场重拍', '结尾停顿'],
      copyStyle: ['短句推进', '问题式收尾'],
      tagStrategy: ['#护肤教程', '#美妆种草'],
      bestPostingTimes: ['工作日 19:30-21:30'],
      ctaStyle: '评论区领取模板',
      risks: ['避免绝对化承诺'],
      fallbackReason: '',
      raw: '',
      analyzedAt: new Date('2026-04-09T08:00:00.000Z'),
      videoRecipe: {} as any,
    })

    const result = await service.remixAnalyzeByVideoUrl(content.contentUrl)

    expect(result.recipe).toBeTruthy()
    expect(result.recipe.structure.signals.length).toBeGreaterThan(0)
    expect(result.recipe.visuals.motifs).toContain('近景产品特写')
    expect(result.recipe.copy.commentSeeds).toHaveLength(3)
    expect(result.recipe.audio.cues).toContain('开场重拍')
    expect(result.recipe.data.viralScore).toBe(88.6)
    const persistedPayload = viralContentModel.findByIdAndUpdate.mock.calls[0]?.[1]
    expect(persistedPayload.$set.analysisResult.videoRecipe).toBeTruthy()
  })

  it('should inject recipe into pipeline preferences when pipeline id is provided', async () => {
    const contentId = new Types.ObjectId()
    const pipelineId = new Types.ObjectId()
    const content = {
      _id: contentId,
      platform: 'douyin',
      videoId: 'video-1',
      title: '食品饮料场景爆款',
      author: 'creator-b',
      industry: '食品饮料',
      keywords: ['食品饮料', '试吃'],
      contentUrl: 'https://v.douyin.com/1234',
      views: 68000,
      likes: 5200,
      comments: 410,
      shares: 300,
      viralScore: 75.2,
      publishedAt: new Date('2026-04-07T09:00:00.000Z'),
      remixBriefs: [],
    }
    const pipeline = {
      _id: pipelineId,
      brandId: new Types.ObjectId(),
      preferences: {
        preferredStyles: ['原有风格'],
        subtitlePreferences: {},
        preferenceLearning: {},
      },
    }
    viralContentModel.findOne.mockReturnValue(createQuery(content))
    viralContentModel.findByIdAndUpdate.mockReturnValue({ exec: vi.fn().mockResolvedValue(null) })
    pipelineModel.findById.mockReturnValue(createQuery(pipeline))
    pipelineModel.findByIdAndUpdate.mockReturnValue(createQuery({
      _id: pipelineId,
      preferences: {
        preferredStyles: ['原有风格', '快切 B-roll'],
      },
    }))

    const service = new ContentRemixService(
      viralContentModel as any,
      brandModel as any,
      pipelineModel as any,
      configService as any,
    )
    vi.spyOn(service as any, 'resolveAnalysis').mockResolvedValue({
      source: 'fallback',
      model: 'fallback',
      contentId: contentId.toString(),
      platform: 'douyin',
      videoId: 'video-1',
      title: content.title,
      summary: '开场结果前置，后续用试吃反馈证明。',
      hooks: ['3 秒内先给试吃结果'],
      narrativeBeats: ['结果', '试吃证明', '评论 CTA'],
      structureBreakdown: ['开场给结果', '中段上真实反馈', '结尾评论区领取脚本'],
      visualMotifs: ['快切 B-roll'],
      audioCues: ['重拍卡点'],
      copyStyle: ['口语短句'],
      tagStrategy: ['#食品饮料'],
      bestPostingTimes: ['工作日 12:00-13:30'],
      ctaStyle: '评论区领脚本',
      risks: [],
      fallbackReason: '',
      raw: '',
      analyzedAt: new Date('2026-04-09T08:00:00.000Z'),
      videoRecipe: {} as any,
    })

    const result = await service.remixAnalyzeByVideoUrl(
      content.contentUrl,
      pipelineId.toString(),
    )

    expect(result.pipelineApplied).toBe(true)
    const updatePayload = pipelineModel.findByIdAndUpdate.mock.calls[0]?.[1]
    expect(updatePayload.$set.preferences.remixInsights.videoRecipe).toBeTruthy()
    expect(updatePayload.$set.preferences.preferenceLearning.videoRecipe.sourceContentId)
      .toBe(contentId.toString())
    expect(updatePayload.$set.preferences.preferredDuration).toBeGreaterThan(0)
  })
})
