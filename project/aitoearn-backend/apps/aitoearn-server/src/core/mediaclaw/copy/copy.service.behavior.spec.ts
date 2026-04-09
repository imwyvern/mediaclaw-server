import { NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CopyService } from './copy.service'

function createQuery<T>(value: T) {
  const query = {
    limit: vi.fn(),
    lean: vi.fn(),
    skip: vi.fn(),
    sort: vi.fn(),
    exec: vi.fn().mockResolvedValue(value),
  }
  query.limit.mockReturnValue(query)
  query.lean.mockReturnValue(query)
  query.skip.mockReturnValue(query)
  query.sort.mockReturnValue(query)
  return query
}

describe('copyService behavior', () => {
  let copyEngineService: {
    generateCopy: ReturnType<typeof vi.fn>
    generateBlueWords: ReturnType<typeof vi.fn>
    generateCommentGuide: ReturnType<typeof vi.fn>
    generateABVariants: ReturnType<typeof vi.fn>
    generateCopyRecord: ReturnType<typeof vi.fn>
    rewriteCopyRecord: ReturnType<typeof vi.fn>
  }

  let copyStrategyService: {
    recordCopyPerformance: ReturnType<typeof vi.fn>
    getCopyInsights: ReturnType<typeof vi.fn>
    getTopPerformingPatterns: ReturnType<typeof vi.fn>
  }

  let brandModel: {
    findById: ReturnType<typeof vi.fn>
  }

  let videoTaskModel: {
    findById: ReturnType<typeof vi.fn>
  }

  let copyHistoryModel: {
    findById: ReturnType<typeof vi.fn>
    countDocuments: ReturnType<typeof vi.fn>
    find: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    copyEngineService = {
      generateCopy: vi.fn(),
      generateBlueWords: vi.fn(),
      generateCommentGuide: vi.fn(),
      generateABVariants: vi.fn(),
      generateCopyRecord: vi.fn().mockResolvedValue({
        copyHistoryId: '507f1f77bcf86cd799439012',
        copy: {
          title: '标题',
          subtitle: '这是一段足够长的字幕内容',
          description: '这是一段足够长的正文内容，用于员工分发和发布前预览。',
          hashtags: ['#修护', '#种草', '#护肤', '#品牌', '#短视频'],
          blueWords: ['#修护'],
          commentGuide: '评论 1\n评论 2\n评论 3',
          commentGuides: ['评论 1', '评论 2', '评论 3'],
        },
      }),
      rewriteCopyRecord: vi.fn(),
    }

    copyStrategyService = {
      recordCopyPerformance: vi.fn(),
      getCopyInsights: vi.fn(),
      getTopPerformingPatterns: vi.fn(),
    }

    brandModel = {
      findById: vi.fn(),
    }

    videoTaskModel = {
      findById: vi.fn(),
    }

    copyHistoryModel = {
      findById: vi.fn(),
      countDocuments: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue(1) }),
      find: vi.fn().mockReturnValue(createQuery([
        {
          _id: { toString: () => '507f1f77bcf86cd799439013' },
          orgId: { toString: () => '507f1f77bcf86cd799439011' },
          taskId: { toString: () => '507f1f77bcf86cd799439099' },
          title: '标题',
          subtitle: '字幕',
          description: '正文',
          hashtags: ['#护肤'],
          blueWords: ['#修护'],
          commentGuide: '评论 1\n评论 2\n评论 3',
          commentGuides: ['评论 1', '评论 2', '评论 3'],
          variantIndex: 2,
          variantGroupId: 'variant-group-1',
          variantGoal: '生成第 2 个版本',
          dedupFingerprint: 'abcdef',
          variantPerformance: {
            score: 82,
            bestPerformer: true,
          },
          performance: {
            views: 100,
            clicks: 20,
            ctr: 0.2,
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ])),
    }
  })

  it('should clamp ab variant generation to 3 copies and preserve description', async () => {
    brandModel.findById.mockReturnValue(createQuery({
      _id: { toString: () => '507f1f77bcf86cd799439033' },
      orgId: { toString: () => '507f1f77bcf86cd799439011' },
      name: '同组织品牌',
    }))

    const service = new CopyService(
      copyEngineService as any,
      copyStrategyService as any,
      brandModel as any,
      videoTaskModel as any,
      copyHistoryModel as any,
    )

    const result = await service.generateForHttp(
      '507f1f77bcf86cd799439011',
      '507f1f77bcf86cd799439022',
      {
        brandId: '507f1f77bcf86cd799439033',
        count: 9,
        platform: 'xiaohongshu',
        style: '种草',
      },
    )

    expect(result.count).toBe(3)
    expect(result.primaryCopy?.description).toContain('正文内容')
    expect(result.primaryCopy?.variantGroupId).toBeTruthy()
    expect(new Set(result.copies.map(item => item.variantGroupId)).size).toBe(1)
    expect(copyEngineService.generateCopyRecord).toHaveBeenCalledTimes(3)
  })

  it('should reject cross-org brand access for generate endpoint', async () => {
    brandModel.findById.mockReturnValue(createQuery({
      _id: { toString: () => '507f1f77bcf86cd799439033' },
      orgId: { toString: () => '507f1f77bcf86cd799439044' },
      name: '跨组织品牌',
    }))

    const service = new CopyService(
      copyEngineService as any,
      copyStrategyService as any,
      brandModel as any,
      videoTaskModel as any,
      copyHistoryModel as any,
    )

    await expect(service.generateForHttp(
      '507f1f77bcf86cd799439011',
      '507f1f77bcf86cd799439022',
      {
        brandId: '507f1f77bcf86cd799439033',
      },
    )).rejects.toBeInstanceOf(NotFoundException)
  })

  it('should forward provider, source hint, and fallback video url into copy generation', async () => {
    const service = new CopyService(
      copyEngineService as any,
      copyStrategyService as any,
      brandModel as any,
      videoTaskModel as any,
      copyHistoryModel as any,
    )

    await service.generateForInternal({
      userId: '507f1f77bcf86cd799439022',
      theme: '夏日咖啡探店',
      platform: 'xiaohongshu',
      style: '种草',
      provider: 'deepseek',
      sourceHint: '图文首图展示冰咖啡和门店外立面',
      videoUrl: 'https://cdn.example.com/generated.mp4',
    })

    expect(copyEngineService.generateCopyRecord).toHaveBeenCalledWith(
      null,
      'https://cdn.example.com/generated.mp4',
      expect.objectContaining({
        userId: '507f1f77bcf86cd799439022',
        scene: '夏日咖啡探店',
        platform: 'xiaohongshu',
        style: '种草',
        sourceHint: '图文首图展示冰咖啡和门店外立面',
        copyProvider: 'deepseek',
        source: 'copy-internal-endpoint',
      }),
      expect.objectContaining({
        replaceExistingForTask: false,
      }),
    )
  })

  it('should expose normalized copy history payloads', async () => {
    const service = new CopyService(
      copyEngineService as any,
      copyStrategyService as any,
      brandModel as any,
      videoTaskModel as any,
      copyHistoryModel as any,
    )

    const result = await service.listHistory('507f1f77bcf86cd799439011')

    expect(result.total).toBe(1)
    expect(result.items[0]?.description).toBe('正文')
    expect(result.items[0]?.commentGuides).toEqual(['评论 1', '评论 2', '评论 3'])
    expect(result.items[0]?.variantGroupId).toBe('variant-group-1')
    expect(result.items[0]?.bestPerformer).toBe(true)
  })
})
