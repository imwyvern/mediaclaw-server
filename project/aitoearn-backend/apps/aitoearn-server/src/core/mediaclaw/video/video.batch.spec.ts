import { Types } from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@yikart/mongodb', () => {
  class Brand {}
  class Pipeline {}
  class ProductionBatch {}
  class VideoTask {}

  return {
    Brand,
    Pipeline,
    ProductionBatch,
    VideoTask,
    ProductionBatchStatus: {
      PENDING: 'pending',
      PROCESSING: 'processing',
      PARTIAL: 'partial',
      COMPLETED: 'completed',
      FAILED: 'failed',
    },
    VideoTaskStatus: {
      PENDING: 'pending',
      COMPLETED: 'completed',
      APPROVED: 'approved',
      PUBLISHED: 'published',
      FAILED: 'failed',
      CANCELLED: 'cancelled',
      ANALYZING: 'analyzing',
      EDITING: 'editing',
      RENDERING: 'rendering',
      QUALITY_CHECK: 'quality_check',
      GENERATING_COPY: 'generating_copy',
    },
    VideoTaskType: {
      REMIX: 'remix',
    },
  }
})

import { ProductionBatchStatus, VideoTaskStatus } from '@yikart/mongodb'
import { VideoService } from './video.service'

function createQuery<T>(value: T) {
  const query = {
    lean: vi.fn(),
    select: vi.fn(),
    exec: vi.fn().mockResolvedValue(value),
  }

  query.lean.mockReturnValue(query)
  query.select.mockReturnValue(query)

  return query
}

describe('VideoService batch status', () => {
  let service: VideoService
  let productionBatchModel: Record<string, any>
  let videoTaskModel: Record<string, any>

  beforeEach(() => {
    productionBatchModel = {
      findById: vi.fn(),
      findByIdAndUpdate: vi.fn().mockReturnValue(createQuery(null)),
    }
    videoTaskModel = {
      find: vi.fn(),
    }

    service = new VideoService(
      videoTaskModel as any,
      {} as any,
      {} as any,
      productionBatchModel as any,
      {} as any,
      undefined,
      undefined,
      undefined,
    )
  })

  it('应在成功与失败混合完成时将批次状态更新为 partial 并生成汇总', async () => {
    const batchId = '507f1f77bcf86cd799439031'
    const batch = {
      _id: new Types.ObjectId(batchId),
      totalTasks: 3,
      completedTasks: 0,
      failedTasks: 0,
      startedAt: new Date('2026-04-01T00:00:00.000Z'),
      summary: {},
    }
    const tasks = [
      {
        _id: new Types.ObjectId('507f1f77bcf86cd799439032'),
        status: VideoTaskStatus.COMPLETED,
        creditsConsumed: 2,
        completedAt: new Date('2026-04-01T01:00:00.000Z'),
        errorMessage: '',
        sourceVideoUrl: 'https://cdn.example.com/1.mp4',
      },
      {
        _id: new Types.ObjectId('507f1f77bcf86cd799439033'),
        status: VideoTaskStatus.PUBLISHED,
        creditsConsumed: 2,
        completedAt: new Date('2026-04-01T02:00:00.000Z'),
        errorMessage: '',
        sourceVideoUrl: 'https://cdn.example.com/2.mp4',
      },
      {
        _id: new Types.ObjectId('507f1f77bcf86cd799439034'),
        status: VideoTaskStatus.FAILED,
        creditsConsumed: 1,
        completedAt: new Date('2026-04-01T03:00:00.000Z'),
        errorMessage: 'render failed',
        sourceVideoUrl: 'https://cdn.example.com/3.mp4',
      },
    ]

    productionBatchModel.findById.mockReturnValueOnce(createQuery(batch))
    videoTaskModel.find.mockReturnValueOnce(createQuery(tasks))

    const result = await (service as any).syncBatchStats(batchId)

    expect(result).toBe(ProductionBatchStatus.PARTIAL)
    expect(productionBatchModel.findByIdAndUpdate).toHaveBeenCalledWith(
      batch._id,
      expect.objectContaining({
        $set: expect.objectContaining({
          status: ProductionBatchStatus.PARTIAL,
          totalTasks: 3,
          completedTasks: 2,
          failedTasks: 1,
          completedAt: expect.any(Date),
          summary: expect.objectContaining({
            totalTasks: 3,
            completedTasks: 2,
            failedTasks: 1,
            successRate: 66.67,
            creditsConsumed: 5,
          }),
        }),
      }),
    )
  })
})
