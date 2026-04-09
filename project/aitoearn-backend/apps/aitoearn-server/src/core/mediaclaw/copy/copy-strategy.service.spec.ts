import { Types } from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CopyStrategyService } from './copy-strategy.service'

function createQuery<T>(value: T) {
  const query = {
    lean: vi.fn(),
    sort: vi.fn(),
    exec: vi.fn().mockResolvedValue(value),
  }
  query.lean.mockReturnValue(query)
  query.sort.mockReturnValue(query)
  return query
}

describe('copyStrategyService', () => {
  let copyPerformanceModel: Record<string, ReturnType<typeof vi.fn>>
  let copyHistoryModel: Record<string, ReturnType<typeof vi.fn>>
  let videoTaskModel: Record<string, ReturnType<typeof vi.fn>>
  let organizationModel: Record<string, ReturnType<typeof vi.fn>>

  beforeEach(() => {
    copyPerformanceModel = {
      findOneAndUpdate: vi.fn(),
      aggregate: vi.fn(),
    }
    copyHistoryModel = {
      findById: vi.fn(),
      findByIdAndUpdate: vi.fn(),
      find: vi.fn(),
      updateMany: vi.fn(),
    }
    videoTaskModel = {
      findById: vi.fn(),
    }
    organizationModel = {
      findByIdAndUpdate: vi.fn(),
    }
  })

  it('should rank ab variants and mark the best performer after performance sync', async () => {
    const orgId = new Types.ObjectId()
    const copyId = new Types.ObjectId()
    const siblingId = new Types.ObjectId()
    const taskId = new Types.ObjectId()

    copyHistoryModel.findById.mockReturnValue(createQuery({
      _id: copyId,
      orgId,
      taskId,
      title: '标题',
      subtitle: '这是一段足够长的字幕内容',
      description: '这是一段足够长的正文内容',
      hashtags: ['#增长'],
      blueWords: ['#增长'],
      commentGuide: '评论“模板”我发你',
      variantGroupId: 'variant-group-1',
    }))
    videoTaskModel.findById.mockReturnValue(createQuery({
      _id: taskId,
      orgId,
      metadata: {
        platform: 'xiaohongshu',
      },
    }))
    copyPerformanceModel.findOneAndUpdate.mockReturnValue(createQuery({
      _id: new Types.ObjectId(),
      copyHistoryId: copyId.toString(),
      videoTaskId: taskId.toString(),
      orgId: orgId.toString(),
      platform: 'xiaohongshu',
      performanceScore: 64.2,
      metrics: {},
      copyFeatures: {},
      recordedAt: new Date(),
    }))
    copyHistoryModel.findByIdAndUpdate.mockReturnValue({ exec: vi.fn().mockResolvedValue(null) })
    copyHistoryModel.find.mockReturnValue(createQuery([
      {
        _id: copyId,
        variantPerformance: {
          score: 64.2,
        },
        performance: {
          ctr: 0.12,
          views: 20000,
        },
      },
      {
        _id: siblingId,
        variantPerformance: {
          score: 31.1,
        },
        performance: {
          ctr: 0.05,
          views: 9000,
        },
      },
    ]))
    copyHistoryModel.updateMany.mockReturnValue({ exec: vi.fn().mockResolvedValue({ modifiedCount: 2 }) })

    const service = new CopyStrategyService(
      copyPerformanceModel as any,
      copyHistoryModel as any,
      videoTaskModel as any,
      organizationModel as any,
    )
    vi.spyOn(service as any, 'updateStrategyFromPerformance').mockResolvedValue({
      updatedAt: new Date().toISOString(),
    })

    const result = await service.recordCopyPerformance(
      orgId.toString(),
      copyId.toString(),
      taskId.toString(),
      {
        views: 20000,
        likes: 2200,
        comments: 180,
        shares: 90,
        ctr: 0.12,
      },
    )

    expect(copyHistoryModel.updateMany).toHaveBeenCalledWith(
      {
        orgId,
        variantGroupId: 'variant-group-1',
      },
      {
        $set: {
          'variantPerformance.bestPerformer': false,
        },
      },
    )
    expect(copyHistoryModel.findByIdAndUpdate).toHaveBeenCalledWith(copyId, {
      $set: {
        'variantPerformance.bestPerformer': true,
      },
    })
    expect(result.variantGroup).toMatchObject({
      variantGroupId: 'variant-group-1',
      bestCopyHistoryId: copyId.toString(),
    })
  })
})
