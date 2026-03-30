import { vi } from 'vitest'
import { Types } from 'mongoose'
vi.mock('@yikart/mongodb', () => {
  class Brand {}
  class Pipeline {}
  class PaymentOrder {}
  class VideoPack {}
  class VideoTask {}

  return {
    Brand,
    PackStatus: {
      ACTIVE: 'active',
      DEPLETED: 'depleted',
      EXPIRED: 'expired',
      REFUNDED: 'refunded',
    },
    PaymentOrder,
    Pipeline,
    VideoPack,
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

import { PackStatus, VideoTaskType } from '@yikart/mongodb'
import { BillingService } from '../../apps/aitoearn-server/src/core/mediaclaw/billing/billing.service'
import { TaskMgmtService } from '../../apps/aitoearn-server/src/core/mediaclaw/task-mgmt/task-mgmt.service'
import { createExecQuery } from '../support/query'

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

describe('MediaClaw Concurrent Video Stress', () => {
  it('应在 10 个并发视频任务下避免积分竞态并保持入队顺序', async () => {
    const packState = {
      _id: new Types.ObjectId(),
      userId: 'stress-user',
      packType: 'pack_10',
      totalCredits: 10,
      remainingCredits: 10,
      status: PackStatus.ACTIVE,
      purchasedAt: new Date('2026-03-01T00:00:00.000Z'),
      expiresAt: null,
    }

    const videoPackModel = {
      findOne: vi.fn((query: Record<string, any>) => createExecQuery(async () => {
        await wait(Math.floor(Math.random() * 5))
        if (query['metadata.taskId']) {
          return null
        }

        if (packState.remainingCredits >= (query.remainingCredits?.$gte || 1) && packState.status === PackStatus.ACTIVE) {
          return { ...packState }
        }

        return null
      })),
      findOneAndUpdate: vi.fn((filter: Record<string, any>, update: Record<string, any>) => createExecQuery(async () => {
        await wait(Math.floor(Math.random() * 5))
        const needed = filter.remainingCredits?.$gte || 1
        if (packState._id.toString() !== filter._id.toString() || packState.remainingCredits < needed) {
          return null
        }

        packState.remainingCredits += update.$inc.remainingCredits
        return { ...packState }
      })),
      findByIdAndUpdate: vi.fn((_id: Types.ObjectId, update: Record<string, any>) => createExecQuery(async () => {
        packState.status = update.status
        return { ...packState }
      })),
    }

    const billingService = new BillingService(
      videoPackModel as any,
      {} as any,
    )

    const creditResults = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        billingService.deductCredit('stress-user', `task-${index + 1}`, 1)),
    )

    expect(creditResults.every(Boolean)).toBe(true)
    expect(packState.remainingCredits).toBe(0)
    expect(packState.status).toBe(PackStatus.DEPLETED)
    await expect(billingService.deductCredit('stress-user', 'task-overflow', 1)).resolves.toBe(false)

    const queuedJobIds: string[] = []
    const videoTaskModel = {
      create: vi.fn().mockImplementation(async (payload: Record<string, any>) => ({
        ...payload,
        toObject: () => ({ ...payload }),
      })),
    }
    const queue = {
      add: vi.fn().mockImplementation(async (_name: string, _data: Record<string, any>, options: { jobId: string }) => {
        queuedJobIds.push(options.jobId)
      }),
    }
    const taskService = new TaskMgmtService(
      videoTaskModel as any,
      {} as any,
      {} as any,
      { deductCredit: vi.fn().mockResolvedValue(true) } as any,
      queue as any,
    )

    const orgId = new Types.ObjectId().toString()
    const createdTasks = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        taskService.createTask(orgId, {
          requestedBy: `stress-user-${index + 1}`,
          taskType: VideoTaskType.NEW_CONTENT,
          sourceVideoUrl: `https://cdn.example.com/video-${index + 1}.mp4`,
        })),
    )

    expect(queuedJobIds).toHaveLength(10)
    expect(queuedJobIds).toEqual(
      createdTasks.map(task => `${task._id.toString()}:analyze-source`),
    )
  })
})
