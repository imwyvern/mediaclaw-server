import {
  NotificationEvent,
  PipelineStatus,
  ProductionBatchStatus,
  VideoTaskStatus,
} from '@yikart/mongodb'
import { Types } from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProductionOrchestratorService } from './production-orchestrator.service'

function createQuery<T>(value: T) {
  const query = {
    sort: vi.fn(),
    skip: vi.fn(),
    limit: vi.fn(),
    lean: vi.fn(),
    exec: vi.fn().mockResolvedValue(value),
  }

  query.sort.mockReturnValue(query)
  query.skip.mockReturnValue(query)
  query.limit.mockReturnValue(query)
  query.lean.mockReturnValue(query)

  return query
}

describe('productionOrchestratorService', () => {
  let service: ProductionOrchestratorService
  let productionBatchModel: Record<string, any>
  let videoTaskModel: Record<string, any>
  let pipelineModel: Record<string, any>
  let brandModel: Record<string, any>
  let videoService: Record<string, any>
  let employeeDispatchService: Record<string, any>
  let notificationService: Record<string, any>
  let dedupService: Record<string, any>

  beforeEach(() => {
    productionBatchModel = {
      countDocuments: vi.fn().mockResolvedValue(0),
      create: vi.fn(),
      find: vi.fn(),
      findById: vi.fn(),
      findByIdAndUpdate: vi.fn(),
      findOne: vi.fn(),
    }
    videoTaskModel = {
      create: vi.fn(),
      find: vi.fn(),
      findById: vi.fn(),
      findByIdAndUpdate: vi.fn(),
      findOne: vi.fn(),
      updateMany: vi.fn().mockReturnValue(createQuery({ modifiedCount: 0 })),
    }
    pipelineModel = {
      find: vi.fn(),
      findById: vi.fn(),
    }
    brandModel = {
      findOne: vi.fn(),
    }
    videoService = {
      createTask: vi.fn(),
    }
    employeeDispatchService = {
      listAssignments: vi.fn(),
    }
    notificationService = {
      send: vi.fn().mockResolvedValue(undefined),
    }
    dedupService = {
      batchCheckDuplicateByBatch: vi.fn(),
    }

    service = new ProductionOrchestratorService(
      productionBatchModel as any,
      videoTaskModel as any,
      pipelineModel as any,
      brandModel as any,
      videoService as any,
      employeeDispatchService as any,
      notificationService as any,
      dedupService as any,
    )
  })

  it('应按员工分发路由生成账号级每日生产批次', async () => {
    const orgId = new Types.ObjectId().toString()
    const pipelineId = new Types.ObjectId().toString()

    pipelineModel.find.mockReturnValue(createQuery([
      {
        _id: new Types.ObjectId(pipelineId),
        orgId: new Types.ObjectId(orgId),
        brandId: new Types.ObjectId(),
        name: '小红书日更',
        status: PipelineStatus.ACTIVE,
        schedule: {
          enabled: true,
          timezone: 'Asia/Shanghai',
          cron: '0 9 * * *',
          concurrency: 3,
          retryLimit: 1,
          notifyChannel: 'ops-group',
        },
        distributionRules: {
          accountTypes: ['xiaohongshu'],
        },
        preferences: {
          subtitlePreferences: {
            templateId: 'b7-ai-live',
          },
          preferredStyles: ['clean'],
        },
      },
    ]))
    productionBatchModel.findOne.mockReturnValue(createQuery(null))
    brandModel.findOne.mockReturnValue(createQuery({
      _id: new Types.ObjectId(),
      assets: {
        keywords: ['茶饮'],
        slogans: ['轻养生'],
        colors: ['green'],
      },
      videoStyle: {
        referenceVideoUrl: 'https://cdn.example.com/reference.mp4',
      },
    }))
    employeeDispatchService.listAssignments.mockResolvedValue({
      items: [
        {
          id: 'assignment-1',
          employeeName: 'Ava',
          employeePhone: '13800000000',
          distributionRules: {
            maxDailyVideos: 2,
            accountTypes: ['xiaohongshu'],
            templateIds: ['b7-ai-live'],
          },
          defaultPlatformAccount: {
            id: 'account-1',
          },
          platformAccounts: [
            {
              id: 'account-1',
              platform: 'xiaohongshu',
              accountId: 'xh-001',
              accountName: '小红书账号',
              avatarUrl: 'https://cdn.example.com/frame.jpg',
            },
          ],
        },
      ],
    })

    const createBatchSpy = vi.spyOn(service, 'createBatch').mockResolvedValue({
      id: 'batch-object-id',
      batchId: 'batch-001',
      totalCount: 2,
      summary: {
        totalAccounts: 1,
      },
    } as any)
    vi.spyOn(service, 'startBatch').mockResolvedValue({
      batchId: 'batch-001',
      totalCount: 2,
      summary: {
        totalAccounts: 1,
      },
    } as any)

    const result = await service.scheduleDailyProduction(orgId)

    expect(result.scheduledCount).toBe(1)
    expect(createBatchSpy).toHaveBeenCalledWith(
      orgId,
      orgId,
      expect.objectContaining({
        templateId: 'b7-ai-live',
        count: 2,
        config: expect.objectContaining({
          concurrency: 3,
          retryLimit: 1,
          notifyChannel: 'ops-group',
        }),
        scheduleContext: expect.objectContaining({
          totalAccounts: 1,
          accountTypes: {
            xiaohongshu: 2,
          },
        }),
        taskPlan: [
          expect.objectContaining({
            assignmentId: 'assignment-1',
            platformAccountId: 'account-1',
            accountType: 'xiaohongshu',
            dailySequence: 1,
            firstFrameUrl: 'https://cdn.example.com/frame.jpg',
          }),
          expect.objectContaining({
            assignmentId: 'assignment-1',
            platformAccountId: 'account-1',
            accountType: 'xiaohongshu',
            dailySequence: 2,
          }),
        ],
      }),
    )
  })

  it('应在单任务失败后按批次重试一次再继续', async () => {
    const batchObjectId = new Types.ObjectId().toString()
    const runningBatch = {
      _id: new Types.ObjectId(batchObjectId),
      batchId: 'batch-001',
      status: ProductionBatchStatus.RUNNING,
      params: {
        config: {
          retryLimit: 1,
        },
        taskPlan: [
          {
            assignmentId: 'assignment-1',
            referenceVideoUrl: 'https://cdn.example.com/reference.mp4',
          },
        ],
      },
    }
    const failedTask = {
      _id: new Types.ObjectId(),
      batchIndex: 0,
      status: VideoTaskStatus.FAILED,
      metadata: {
        productionBatch: {
          attempt: 0,
        },
      },
    }
    const retriedTask = {
      _id: new Types.ObjectId(),
      batchIndex: 0,
      status: VideoTaskStatus.PENDING,
      metadata: {
        productionBatch: {
          attempt: 1,
        },
      },
    }
    const succeededTask = {
      _id: new Types.ObjectId(),
      batchIndex: 0,
      status: VideoTaskStatus.COMPLETED,
      metadata: {
        productionBatch: {
          attempt: 1,
        },
      },
    }

    vi.spyOn(service as any, 'syncBatchStateFromTasks').mockResolvedValue(runningBatch)
    vi.spyOn(service as any, 'getLatestTaskForIndex')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(failedTask)
      .mockResolvedValueOnce(succeededTask)
    const createBatchTaskSpy = vi.spyOn(service as any, 'createBatchTask')
      .mockResolvedValueOnce(retriedTask)
      .mockResolvedValueOnce(retriedTask)
    vi.spyOn(service as any, 'waitForTaskTerminalState')
      .mockResolvedValueOnce(failedTask)
      .mockResolvedValueOnce(succeededTask)

    await (service as any).processBatchIndex(batchObjectId, 0, {
      concurrency: 1,
      retryLimit: 1,
      dedupOnComplete: true,
      batchDedupOnFinish: true,
      notifyChannel: '',
      pauseOnErrorRate: null,
    })

    expect(createBatchTaskSpy).toHaveBeenCalledTimes(2)
    expect(createBatchTaskSpy).toHaveBeenNthCalledWith(1, runningBatch, 0, 0)
    expect(createBatchTaskSpy).toHaveBeenNthCalledWith(2, runningBatch, 0, 1)
  })

  it('应在批次完成后写入去重汇总并发送生产报告', async () => {
    const orgId = new Types.ObjectId().toString()
    const batch = {
      _id: new Types.ObjectId(),
      batchId: 'batch-001',
      orgId: new Types.ObjectId(orgId),
      pipelineId: new Types.ObjectId().toString(),
      status: ProductionBatchStatus.COMPLETED,
      summary: {
        totalAccounts: 1,
        successAccounts: 1,
        totalVideos: 2,
        totalDurationSec: 18,
        totalCost: 6,
      },
      params: {
        config: {
          dedupOnComplete: true,
          batchDedupOnFinish: true,
        },
      },
    }
    const dedupUpdatedBatch = {
      ...batch,
      summary: {
        ...batch.summary,
        dedupPassed: 2,
        dedupFailed: 1,
        dedupCheckedAt: new Date(),
      },
    }
    const notifiedBatch = {
      ...dedupUpdatedBatch,
      summary: {
        ...dedupUpdatedBatch.summary,
        notifiedAt: new Date(),
      },
    }

    dedupService.batchCheckDuplicateByBatch.mockResolvedValue({
      batchId: batch.batchId,
      total: 3,
      passed: 2,
      duplicate: 1,
      error: 0,
      passedTaskIds: [],
      blockedTaskIds: [],
      errorTaskIds: [],
      items: [],
      results: [],
    })
    productionBatchModel.findByIdAndUpdate
      .mockReturnValueOnce(createQuery(dedupUpdatedBatch))
      .mockReturnValueOnce(createQuery(notifiedBatch))

    const afterDedup = await (service as any).runBatchDedupIfNeeded(orgId, batch)
    const afterNotify = await (service as any).notifyBatchSummaryIfNeeded(orgId, afterDedup)

    expect(dedupService.batchCheckDuplicateByBatch).toHaveBeenCalledWith(
      orgId,
      batch.pipelineId,
      batch._id.toString(),
    )
    expect(notificationService.send).toHaveBeenCalledWith(
      orgId,
      NotificationEvent.TASK_COMPLETED,
      expect.objectContaining({
        batchId: 'batch-001',
        totalAccounts: 1,
        totalVideos: 2,
        dedupPassed: 2,
        dedupFailed: 1,
      }),
    )
    expect(afterNotify.summary.dedupPassed).toBe(2)
    expect(afterNotify.summary.dedupFailed).toBe(1)
    expect(afterNotify.summary.notifiedAt).toBeTruthy()
  })
})
