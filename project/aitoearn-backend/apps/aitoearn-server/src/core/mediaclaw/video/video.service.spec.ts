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
      COMPLETED: 'completed',
      FAILED: 'failed',
      PARTIAL: 'partial',
    },
    VideoTaskStatus: {
      PENDING: 'pending',
      ANALYZING: 'analyzing',
      EDITING: 'editing',
      RENDERING: 'rendering',
      QUALITY_CHECK: 'quality_check',
      GENERATING_COPY: 'generating_copy',
      COMPLETED: 'completed',
      FAILED: 'failed',
      CANCELLED: 'cancelled',
      PUBLISHED: 'published',
      APPROVED: 'approved',
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
    sort: vi.fn(),
    exec: vi.fn().mockResolvedValue(value),
  }

  query.lean.mockReturnValue(query)
  query.select.mockReturnValue(query)
  query.sort.mockReturnValue(query)

  return query
}

describe('VideoService batch status', () => {
  const batchId = new Types.ObjectId().toString()
  const taskId = new Types.ObjectId().toString()

  let service: VideoService
  let videoTaskModel: Record<string, any>
  let productionBatchModel: Record<string, any>
  let usageService: Record<string, any>

  beforeEach(() => {
    videoTaskModel = {
      find: vi.fn(),
      findById: vi.fn(),
      findByIdAndUpdate: vi.fn(),
    }

    productionBatchModel = {
      findById: vi.fn(),
      findByIdAndUpdate: vi.fn().mockReturnValue(createQuery(null)),
    }

    usageService = {
      refundVideoCharge: vi.fn(),
    }

    service = new VideoService(
      videoTaskModel as any,
      {} as any,
      {} as any,
      productionBatchModel as any,
      usageService as any,
      undefined,
      undefined,
      undefined,
    )
  })

  it('应在批次有成功也有失败任务时更新为 PARTIAL', async () => {
    const batchObjectId = new Types.ObjectId(batchId)
    videoTaskModel.findById.mockReturnValue(createQuery({
      _id: new Types.ObjectId(taskId),
      userId: new Types.ObjectId().toString(),
      orgId: new Types.ObjectId(),
      batchId: batchObjectId,
      creditCharged: true,
      startedAt: new Date('2026-04-01T00:00:00.000Z'),
    }))
    videoTaskModel.findByIdAndUpdate.mockReturnValue(createQuery({
      _id: new Types.ObjectId(taskId),
      batchId: batchObjectId,
      status: VideoTaskStatus.COMPLETED,
    }))
    productionBatchModel.findById.mockReturnValue(createQuery({
      _id: batchObjectId,
      totalTasks: 2,
      summary: {},
      startedAt: new Date('2026-04-01T00:00:00.000Z'),
    }))
    videoTaskModel.find.mockReturnValue(createQuery([
      {
        _id: new Types.ObjectId(),
        status: VideoTaskStatus.COMPLETED,
        creditsConsumed: 2,
        sourceVideoUrl: 'https://a.test/1.mp4',
        errorMessage: '',
      },
      {
        _id: new Types.ObjectId(),
        status: VideoTaskStatus.FAILED,
        creditsConsumed: 0,
        sourceVideoUrl: 'https://a.test/2.mp4',
        errorMessage: 'render failed',
      },
    ]))

    await service.updateStatus(taskId, VideoTaskStatus.COMPLETED, {
      outputVideoUrl: 'https://cdn.test/output.mp4',
    })

    expect(productionBatchModel.findByIdAndUpdate).toHaveBeenCalledWith(
      expect.any(Types.ObjectId),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: ProductionBatchStatus.PARTIAL,
          totalTasks: 2,
          completedTasks: 1,
          failedTasks: 1,
          summary: expect.objectContaining({
            successRate: 50,
            creditsConsumed: 2,
          }),
        }),
      }),
    )
  })

  it('应在批次全部完成时更新为 COMPLETED', async () => {
    const batchObjectId = new Types.ObjectId(batchId)
    videoTaskModel.findById.mockReturnValue(createQuery({
      _id: new Types.ObjectId(taskId),
      userId: new Types.ObjectId().toString(),
      orgId: new Types.ObjectId(),
      batchId: batchObjectId,
      creditCharged: true,
      startedAt: new Date('2026-04-01T00:00:00.000Z'),
    }))
    videoTaskModel.findByIdAndUpdate.mockReturnValue(createQuery({
      _id: new Types.ObjectId(taskId),
      batchId: batchObjectId,
      status: VideoTaskStatus.COMPLETED,
    }))
    productionBatchModel.findById.mockReturnValue(createQuery({
      _id: batchObjectId,
      totalTasks: 2,
      summary: {},
      startedAt: new Date('2026-04-01T00:00:00.000Z'),
    }))
    videoTaskModel.find.mockReturnValue(createQuery([
      {
        _id: new Types.ObjectId(),
        status: VideoTaskStatus.COMPLETED,
        creditsConsumed: 2,
        sourceVideoUrl: 'https://a.test/1.mp4',
        errorMessage: '',
      },
      {
        _id: new Types.ObjectId(),
        status: VideoTaskStatus.APPROVED,
        creditsConsumed: 2,
        sourceVideoUrl: 'https://a.test/2.mp4',
        errorMessage: '',
      },
    ]))

    await service.updateStatus(taskId, VideoTaskStatus.COMPLETED)

    expect(productionBatchModel.findByIdAndUpdate).toHaveBeenCalledWith(
      expect.any(Types.ObjectId),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: ProductionBatchStatus.COMPLETED,
          totalTasks: 2,
          completedTasks: 2,
          failedTasks: 0,
          summary: expect.objectContaining({
            successRate: 100,
            creditsConsumed: 4,
          }),
        }),
      }),
    )
  })
})
