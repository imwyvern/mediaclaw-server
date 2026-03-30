import { vi } from 'vitest'
import { Types } from 'mongoose'
vi.mock('@yikart/mongodb', () => {
  class Brand {}
  class Pipeline {}
  class VideoTask {}

  return {
    Brand,
    Pipeline,
    VideoTask,
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
    },
    VideoTaskType: {
      BRAND_REPLACE: 'brand_replace',
      REMIX: 'remix',
      NEW_CONTENT: 'new_content',
    },
  }
})

import { VideoTaskStatus, VideoTaskType } from '@yikart/mongodb'
import { TaskMgmtService } from '../../apps/aitoearn-server/src/core/mediaclaw/task-mgmt/task-mgmt.service'
import { VideoService } from '../../apps/aitoearn-server/src/core/mediaclaw/video/video.service'
import { VideoWorkerProcessor } from '../../apps/aitoearn-server/src/core/mediaclaw/worker/video-worker.processor'
import { createChainQuery, createExecQuery } from '../support/query'

function createVideoTaskDocument(overrides: Record<string, unknown> = {}) {
  const data = {
    _id: new Types.ObjectId(),
    userId: 'user-1',
    orgId: new Types.ObjectId(),
    brandId: null,
    pipelineId: null,
    taskType: VideoTaskType.NEW_CONTENT,
    status: VideoTaskStatus.PENDING,
    sourceVideoUrl: 'https://cdn.example.com/source.mp4',
    outputVideoUrl: '',
    creditsConsumed: 1,
    creditCharged: true,
    metadata: {},
    quality: {},
    createdAt: new Date('2026-03-30T08:00:00.000Z'),
    updatedAt: new Date('2026-03-30T08:00:00.000Z'),
    ...overrides,
  }

  return {
    ...data,
    toObject: () => ({ ...data }),
  }
}

describe('MediaClaw Video Pipeline E2E', () => {
  it('应创建视频任务并写入 BullMQ 队列', async () => {
    const videoTaskModel = {
      create: vi.fn().mockImplementation(async (payload: Record<string, unknown>) => createVideoTaskDocument(payload)),
    }
    const billingService = {
      deductCredit: vi.fn().mockResolvedValue(true),
    }
    const queue = {
      add: vi.fn().mockResolvedValue(undefined),
    }

    const service = new TaskMgmtService(
      videoTaskModel as any,
      {} as any,
      {} as any,
      billingService as any,
      queue as any,
    )

    const orgId = new Types.ObjectId().toString()
    const task = await service.createTask(orgId, {
      requestedBy: 'user-1',
      taskType: VideoTaskType.NEW_CONTENT,
      sourceVideoUrl: 'https://cdn.example.com/source.mp4',
      metadata: {
        scene: 'launch',
      },
    })

    expect(billingService.deductCredit).toHaveBeenCalledWith('user-1', expect.any(String), 1)
    expect(queue.add).toHaveBeenCalledWith(
      'analyze-source',
      { taskId: task._id.toString() },
      { jobId: `${task._id.toString()}:analyze-source` },
    )
    expect(task.status).toBe(VideoTaskStatus.PENDING)
  })

  it('应返回可轮询的任务状态时间线', async () => {
    const task = createVideoTaskDocument({
      status: VideoTaskStatus.COMPLETED,
      metadata: {
        timeline: [
          {
            status: 'completed',
            rawStatus: VideoTaskStatus.COMPLETED,
            timestamp: '2026-03-30T08:02:00.000Z',
            message: 'Task finished',
          },
          {
            status: 'queued',
            rawStatus: VideoTaskStatus.PENDING,
            timestamp: '2026-03-30T08:00:00.000Z',
            message: 'Queued for processing',
          },
          {
            status: 'processing',
            rawStatus: VideoTaskStatus.RENDERING,
            timestamp: '2026-03-30T08:01:00.000Z',
            message: 'Task processing',
          },
        ],
      },
    })

    const videoTaskModel = {
      findById: vi.fn().mockReturnValue(createChainQuery(task)),
    }
    const service = new TaskMgmtService(
      videoTaskModel as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    )

    const result = await service.getTaskTimeline(task._id.toString())
    expect(result.timeline.map(item => item.status)).toEqual([
      'queued',
      'processing',
      'completed',
    ])
  })

  it('应在任务完成后保持单次积分扣减并发送完成通知', async () => {
    const queue = {
      add: vi.fn().mockResolvedValue(undefined),
    }
    const videoTaskModel = {
      create: vi.fn().mockImplementation(async (payload: Record<string, unknown>) => createVideoTaskDocument(payload)),
    }
    const billingService = {
      deductCredit: vi.fn().mockResolvedValue(true),
    }

    const videoService = new VideoService(
      videoTaskModel as any,
      billingService as any,
      queue as any,
    )

    const createdTask = await videoService.createTask('user-1', {
      taskType: VideoTaskType.REMIX,
      sourceVideoUrl: 'https://cdn.example.com/source.mp4',
      metadata: {
        campaignId: 'cmp-1',
      },
    })

    const processorVideoService = {
      getTask: vi.fn().mockResolvedValue(createdTask),
      updateStatus: vi.fn()
        .mockResolvedValueOnce(createdTask)
        .mockResolvedValueOnce({
          ...createdTask,
          status: VideoTaskStatus.COMPLETED,
        }),
      recordRetry: vi.fn(),
    }
    const copyService = {
      generateCopy: vi.fn().mockResolvedValue({
        title: '成片标题',
        hashtags: ['#mediaclaw'],
      }),
    }
    const distributionService = {
      notifyTaskComplete: vi.fn().mockResolvedValue(undefined),
    }

    const processor = new VideoWorkerProcessor(
      queue as any,
      processorVideoService as any,
      copyService as any,
      distributionService as any,
    )
    vi.spyOn(processor as any, 'sleep').mockResolvedValue(undefined)

    await processor.process({
      name: 'generate-copy',
      data: { taskId: createdTask._id.toString() },
      attemptsMade: 0,
      opts: { attempts: 1 },
    } as any)

    expect(billingService.deductCredit).toHaveBeenCalledTimes(1)
    expect(distributionService.notifyTaskComplete).toHaveBeenCalledWith(expect.objectContaining({
      status: VideoTaskStatus.COMPLETED,
    }))
  })
})
