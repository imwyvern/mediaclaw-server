import { describe, expect, it, vi } from 'vitest'
import { Types } from 'mongoose'
vi.mock('@yikart/mongodb', () => {
  class Brand {}
  class Invoice {}
  class Organization {}
  class Pipeline {}
  class ProductionBatch {}
  class PaymentOrder {}
  class Subscription {}
  class VideoPack {}
  class VideoTask {}

  const roleRanks: Record<string, number> = {
    super_admin: 400,
    admin: 300,
    editor: 200,
    viewer: 100,
  }

  return {
    BillingMode: {
      QUOTA: 'quota',
      POSTPAID: 'postpaid',
      BYOK: 'byok',
    },
    Brand,
    Invoice,
    InvoiceStatus: {
      DRAFT: 'draft',
      ISSUED: 'issued',
      PAID: 'paid',
      OVERDUE: 'overdue',
      VOID: 'void',
    },
    Organization,
    OrgStatus: {
      ACTIVE: 'active',
      SUSPENDED: 'suspended',
      TRIAL: 'trial',
    },
    OrgType: {
      INDIVIDUAL: 'individual',
      TEAM: 'team',
      PROFESSIONAL: 'professional',
      ENTERPRISE: 'enterprise',
    },
    PackStatus: {
      ACTIVE: 'active',
      DEPLETED: 'depleted',
      EXPIRED: 'expired',
      REFUNDED: 'refunded',
    },
    PackType: {
      SINGLE: 'single',
      PACK_10: 'pack_10',
      PACK_30: 'pack_30',
      PACK_100: 'pack_100',
    },
    PaymentMethod: {
      WECHAT_NATIVE: 'wechat_native',
      WECHAT_JSAPI: 'wechat_jsapi',
      ALIPAY: 'alipay',
    },
    PaymentOrder,
    PaymentProductType: {
      VIDEO_PACK: 'video_pack',
      SUBSCRIPTION: 'subscription',
      ADDON: 'addon',
    },
    Pipeline,
    ProductionBatch,
    ProductionBatchStatus: {
      PENDING: 'pending',
      PROCESSING: 'processing',
      PARTIAL: 'partial',
      COMPLETED: 'completed',
      FAILED: 'failed',
      CANCELLED: 'cancelled',
    },
    Subscription,
    SubscriptionPlan: {
      TEAM: 'team',
      PRO: 'pro',
      FLAGSHIP: 'flagship',
    },
    SubscriptionStatus: {
      ACTIVE: 'active',
      PAST_DUE: 'past_due',
      CANCELLED: 'cancelled',
      EXPIRED: 'expired',
    },
    UserRole: {
      SUPER_ADMIN: 'super_admin',
      ENTERPRISE_ADMIN: 'admin',
      ADMIN: 'admin',
      OPERATOR: 'editor',
      EDITOR: 'editor',
      EMPLOYEE: 'viewer',
      VIEWER: 'viewer',
    },
    VideoPack,
    VideoTask,
    VideoTaskStatus: {
      DRAFT: 'draft',
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
    userRoleSatisfies: (role: string | null | undefined, requiredRole: string | null | undefined) =>
      (roleRanks[role || 'viewer'] || roleRanks['viewer']) >= (roleRanks[requiredRole || 'viewer'] || roleRanks['viewer']),
  }
})

import { PackStatus, VideoTaskType } from '@yikart/mongodb'
import { BillingService } from '../../apps/aitoearn-server/src/core/mediaclaw/billing/billing.service'
import { TaskMgmtService } from '../../apps/aitoearn-server/src/core/mediaclaw/task-mgmt/task-mgmt.service'
import { createChainQuery, createExecQuery } from '../support/query'

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
    const createdTaskDocs: Array<Record<string, any>> = []
    const batchDocs = new Map<string, Record<string, any>>()
    const videoTaskModel = {
      create: vi.fn().mockImplementation(async (payload: Record<string, any>) => {
        const task = {
          ...payload,
          toObject: () => ({ ...payload }),
        }
        createdTaskDocs.push(task)
        return task
      }),
      find: vi.fn().mockImplementation((query: Record<string, any>) => createChainQuery(
        createdTaskDocs.filter(task => task.batchId?.toString() === query.batchId?.toString()),
      )),
    }
    const productionBatchModel = {
      create: vi.fn().mockImplementation(async (payload: Record<string, any>) => {
        const batch = {
          _id: new Types.ObjectId(),
          ...payload,
        }
        batchDocs.set(batch._id.toString(), batch)
        return batch
      }),
      findById: vi.fn().mockImplementation((id: Types.ObjectId | string) =>
        createChainQuery(batchDocs.get(id.toString()) || null)),
      findByIdAndUpdate: vi.fn().mockImplementation((id: Types.ObjectId | string, update: Record<string, any>) => {
        const existing = batchDocs.get(id.toString())
        if (!existing) {
          return createChainQuery(null)
        }

        const next = {
          ...existing,
          ...(update.$set || {}),
        }
        batchDocs.set(id.toString(), next)
        return createChainQuery(next)
      }),
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
      productionBatchModel as any,
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
