import {
  PipelineType,
  ViralContent,
} from '@yikart/mongodb'
import { Types } from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PipelineMatchService } from './pipeline-match.service'

function createChainableQuery<T>(value: T) {
  const query = {
    sort: vi.fn(),
    lean: vi.fn(),
    exec: vi.fn().mockResolvedValue(value),
  }

  query.sort.mockReturnValue(query)
  query.lean.mockReturnValue(query)

  return query
}

describe('pipelineMatchService', () => {
  let service: PipelineMatchService
  let pipelineTemplateModel: Record<string, any>
  let viralContentModel: Record<string, any>
  let contentRemixService: Record<string, any>

  beforeEach(() => {
    pipelineTemplateModel = {
      find: vi.fn(),
      findOne: vi.fn(),
      create: vi.fn(),
    }
    viralContentModel = {
      findOne: vi.fn(),
    }
    contentRemixService = {
      analyzeViralElements: vi.fn(),
    }

    service = new PipelineMatchService(
      pipelineTemplateModel as any,
      viralContentModel as any,
      contentRemixService as any,
    )
  })

  it('应基于素材库爆款内容返回结构化参考分析', async () => {
    const contentId = new Types.ObjectId()
    viralContentModel.findOne.mockReturnValue(createChainableQuery({
      _id: contentId,
      industry: '美妆',
      title: '直播口红测评',
      keywords: ['口红', '直播', '种草'],
      contentUrl: 'https://example.com/video/abc123',
    } as Partial<ViralContent>))
    contentRemixService.analyzeViralElements.mockResolvedValue({
      hooks: ['前三秒反转'],
      visualMotifs: ['直播切镜'],
      copyStyle: ['种草'],
      summary: '直播口红测评拆解',
    })

    const result = await service.analyzeReferenceVideo('https://example.com/video/abc123?utm=share')

    expect(result).toMatchObject({
      analysisSource: 'content_remix',
      matchedContentId: contentId.toString(),
      category: '美妆',
      style: '直播',
      suggestedTemplateType: PipelineType.SEEDING,
    })
    expect(result.keyElements).toContain('前三秒反转')
  })

  it('应按匹配分数返回最佳模板', async () => {
    pipelineTemplateModel.find.mockReturnValue(createChainableQuery([
      {
        _id: new Types.ObjectId(),
        templateId: 'b7-ai-live',
        name: 'B7 AI Live',
        categories: ['美妆'],
        styles: ['直播'],
        durationRange: [10, 20],
        costPerVideo: 19.5,
        qualityStars: 4,
        limitations: [],
        verifiedClients: [],
        defaultParams: {},
        status: 'active',
        type: 'seeding',
        isPublic: true,
        createdBy: 'system',
      },
      {
        _id: new Types.ObjectId(),
        templateId: 'b9-product-showcase',
        name: 'B9 Product Showcase',
        categories: ['3c数码'],
        styles: ['产品展示'],
        durationRange: [30, 45],
        costPerVideo: 58,
        qualityStars: 5,
        limitations: [],
        verifiedClients: [],
        defaultParams: {},
        status: 'active',
        type: 'new_product',
        isPublic: true,
        createdBy: 'system',
      },
    ]))

    const result = await service.matchPipeline({
      category: '美妆',
      style: '直播',
      duration: 15,
      budget: 20,
    })

    expect(result.suggestion).toBeNull()
    expect(result.results[0]).toMatchObject({
      templateId: 'b7-ai-live',
      matchLevel: 'direct_match',
    })
    expect(result.results[0].matchScore).toBeGreaterThan(result.results[1].matchScore)
  })

  it('应在创建模板时规范化参数并推断类型', async () => {
    const createdId = new Types.ObjectId()
    pipelineTemplateModel.findOne.mockReturnValue(createChainableQuery(null))
    pipelineTemplateModel.create.mockResolvedValue({
      toObject: () => ({
        _id: createdId,
        templateId: '教学-模板',
        name: '教学 模板',
        description: '',
        categories: ['教程'],
        styles: ['讲解'],
        durationRange: [15, 30],
        costPerVideo: 0,
        qualityStars: 4,
        limitations: [],
        verifiedClients: [],
        defaultParams: {
          duration: 30,
          aspectRatio: '9:16',
          subtitleStyle: {},
          musicStyle: '',
          extra: {
            hook: '前三秒提问',
          },
        },
        status: 'active',
        type: 'brand_story',
        isPublic: false,
        createdBy: 'user-1',
        usageCount: 0,
        createdAt: new Date('2026-04-10T00:00:00.000Z'),
        updatedAt: new Date('2026-04-10T00:00:00.000Z'),
      }),
    })

    const result = await service.createTemplate({
      name: '教学 模板',
      categories: ['教程', '教程'],
      styles: ['讲解'],
      durationRange: [30, 15],
      qualityStars: 4,
      defaultParams: {
        duration: 30,
        hook: '前三秒提问',
      },
      createdBy: 'user-1',
    })

    expect(pipelineTemplateModel.create).toHaveBeenCalledWith(expect.objectContaining({
      templateId: '教学-模板',
      categories: ['教程'],
      durationRange: [15, 30],
      type: PipelineType.BRAND_STORY,
    }))
    expect(result).toMatchObject({
      id: createdId.toString(),
      templateId: '教学-模板',
      type: PipelineType.BRAND_STORY,
    })
  })
})
