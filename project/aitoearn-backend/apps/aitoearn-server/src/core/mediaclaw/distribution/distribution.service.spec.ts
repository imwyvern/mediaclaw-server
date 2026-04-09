import {
  DistributionRuleType,
  VideoTaskStatus,
} from '@yikart/mongodb'
import { Types } from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DistributionCallbackStatus,
  DistributionLifecycleStatus,
  DistributionPublishStatus,
} from './distribution.constants'
import { DistributionService } from './distribution.service'

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

describe('distributionService', () => {
  let service: DistributionService
  let distributionRuleModel: Record<string, any>
  let videoTaskModel: Record<string, any>
  let pipelineModel: Record<string, any>
  let webhookService: Record<string, any>
  let employeeDispatchService: Record<string, any>
  let notificationService: Record<string, any>
  let distributionQueueService: Record<string, any>

  beforeEach(() => {
    distributionRuleModel = {
      find: vi.fn(),
    }
    videoTaskModel = {
      find: vi.fn(),
      findOne: vi.fn(),
      findById: vi.fn(),
      findByIdAndUpdate: vi.fn(),
    }
    pipelineModel = {
      findOne: vi.fn(),
    }
    webhookService = {
      trigger: vi.fn().mockResolvedValue(undefined),
    }
    employeeDispatchService = {
      batchDispatch: vi.fn(),
      confirmPublished: vi.fn(),
      expireDeliveryRecord: vi.fn().mockResolvedValue(undefined),
    }
    notificationService = {
      send: vi.fn().mockResolvedValue(undefined),
    }
    distributionQueueService = {
      enqueueCompletedTask: vi.fn().mockResolvedValue({
        queued: true,
        taskId: 'task-queued',
      }),
    }

    service = new DistributionService(
      distributionRuleModel as any,
      videoTaskModel as any,
      pipelineModel as any,
      webhookService as any,
      employeeDispatchService as any,
      notificationService as any,
      distributionQueueService as any,
    )
  })

  it('应按优先级匹配分发规则', async () => {
    const orgId = new Types.ObjectId().toString()
    const rule = {
      _id: new Types.ObjectId(),
      orgId: new Types.ObjectId(orgId),
      name: '高优先级规则',
      type: DistributionRuleType.BY_PLATFORM,
      priority: 100,
      isActive: true,
      rules: [
        {
          condition: {
            field: 'platform',
            op: 'eq',
            value: 'xiaohongshu',
          },
          action: 'push',
          target: 'team-red',
        },
      ],
    }

    distributionRuleModel.find.mockReturnValue(createQuery([rule]))

    const result = await service.evaluateRules(orgId, {
      platform: 'xiaohongshu',
      tags: ['beauty'],
    })

    expect(result.matched).toBe(true)
    expect(result.selected).toEqual({
      action: 'push',
      target: 'team-red',
    })
    expect(result.rule?.name).toBe('高优先级规则')
  })

  it('应将命中的员工规则转换为投递路由', async () => {
    const orgId = new Types.ObjectId().toString()
    const taskId = new Types.ObjectId().toString()
    const assignmentId = new Types.ObjectId().toString()
    const task = {
      _id: new Types.ObjectId(taskId),
      orgId: new Types.ObjectId(orgId),
      status: VideoTaskStatus.COMPLETED,
      outputVideoUrl: 'https://cdn.example.com/task.mp4',
      dedup: {
        status: 'passed',
      },
      metadata: {
        platform: 'xiaohongshu',
        contentTags: ['beauty'],
      },
      toObject() {
        return this
      },
    }
    const rule = {
      _id: new Types.ObjectId(),
      orgId: new Types.ObjectId(orgId),
      name: '员工分发',
      type: DistributionRuleType.BY_EMPLOYEE,
      priority: 100,
      isActive: true,
      rules: [
        {
          condition: {
            field: 'platform',
            op: 'eq',
            value: 'xiaohongshu',
          },
          action: 'assign',
          target: assignmentId,
        },
      ],
    }

    distributionRuleModel.find.mockReturnValue(createQuery([rule]))
    videoTaskModel.findOne.mockReturnValue(createQuery(task))
    videoTaskModel.findById.mockReturnValue(createQuery({
      ...task,
      metadata: {
        distribution: {
          publishStatus: DistributionPublishStatus.PUSHED,
        },
      },
    }))
    employeeDispatchService.batchDispatch.mockResolvedValue({
      total: 1,
      dispatched: 1,
      failed: 0,
      pending: 0,
      strategy: 'round-robin',
      results: [
        {
          videoTaskId: taskId,
          dispatched: true,
          assignmentId,
          status: 'pushed',
        },
      ],
    })

    const result = await service.assignByRule(orgId, taskId)

    expect(employeeDispatchService.batchDispatch).toHaveBeenCalledWith(
      orgId,
      [taskId],
      expect.objectContaining({
        assignmentIds: [assignmentId],
      }),
    )
    expect(result.matchedRule?.type).toBe(DistributionRuleType.BY_EMPLOYEE)
    expect(result.assignment?.assignmentId).toBe(assignmentId)
  })

  it('应在按管线分发时透传模板绑定与账号覆盖规则', async () => {
    const orgId = new Types.ObjectId().toString()
    const pipelineId = new Types.ObjectId().toString()
    const taskId = new Types.ObjectId().toString()
    const assignmentId = new Types.ObjectId().toString()
    const platformAccountId = new Types.ObjectId().toString()
    const overridePlatformAccountId = new Types.ObjectId().toString()

    videoTaskModel.find.mockReturnValue(createQuery([
      {
        _id: new Types.ObjectId(taskId),
        orgId: new Types.ObjectId(orgId),
        outputVideoUrl: 'https://cdn.example.com/task.mp4',
        dedup: {
          status: 'passed',
        },
      },
    ]))
    pipelineModel.findOne.mockReturnValue(createQuery({
      _id: new Types.ObjectId(pipelineId),
      orgId: new Types.ObjectId(orgId),
      distributionRules: {
        assignmentIds: [assignmentId],
        preferredPlatforms: ['xiaohongshu'],
        preferredCategories: ['beer'],
        templateIds: ['b7-ai-live'],
        accountTypes: ['xiaohongshu'],
        platformAccountIds: [platformAccountId],
        strategy: 'load-balance',
      },
    }))
    employeeDispatchService.batchDispatch.mockResolvedValue({
      total: 1,
      dispatched: 1,
      failed: 0,
      pending: 0,
      strategy: 'load-balance',
      results: [],
    })

    await service.dispatchByPipelineRules(orgId, pipelineId, [taskId], {
      platformAccountIds: [overridePlatformAccountId],
    })

    expect(employeeDispatchService.batchDispatch).toHaveBeenCalledWith(
      orgId,
      [taskId],
      expect.objectContaining({
        assignmentIds: [assignmentId],
        preferredPlatforms: ['xiaohongshu'],
        preferredCategories: ['beer'],
        templateIds: ['b7-ai-live'],
        accountTypes: ['xiaohongshu'],
        platformAccountIds: expect.arrayContaining([platformAccountId, overridePlatformAccountId]),
        strategy: 'load-balance',
      }),
    )
  })

  it('应在内容去重未通过时阻止按规则分发', async () => {
    const orgId = new Types.ObjectId().toString()
    const taskId = new Types.ObjectId().toString()
    const task = {
      _id: new Types.ObjectId(taskId),
      orgId: new Types.ObjectId(orgId),
      status: VideoTaskStatus.COMPLETED,
      outputVideoUrl: 'https://cdn.example.com/task.mp4',
      dedup: {
        status: 'pending',
      },
      metadata: {},
      toObject() {
        return this
      },
    }

    videoTaskModel.findOne.mockReturnValue(createQuery(task))

    await expect(service.assignByRule(orgId, taskId)).rejects.toThrow(
      'Content dedup has not passed yet',
    )
  })

  it('应在48小时未确认发布后将任务标记为 expired', async () => {
    const orgId = new Types.ObjectId().toString()
    const taskId = new Types.ObjectId()
    const deliveryRecordId = new Types.ObjectId().toString()
    const staleTask = {
      _id: taskId,
      orgId: new Types.ObjectId(orgId),
      metadata: {
        distribution: {
          publishStatus: DistributionPublishStatus.PUSHED,
          lastDistributedAt: '2026-04-01T00:00:00.000Z',
          employeeDispatch: {
            deliveryRecordId,
          },
        },
      },
    }

    videoTaskModel.find.mockReturnValue(createQuery([staleTask]))
    videoTaskModel.findByIdAndUpdate.mockReturnValue(createQuery(null))

    const result = await service.expireStaleDistributions()

    expect(result.total).toBe(1)
    expect(result.alerted).toBe(1)
    expect(videoTaskModel.findByIdAndUpdate).toHaveBeenCalledWith(
      taskId,
      expect.objectContaining({
        $set: expect.objectContaining({
          'metadata.distribution.lifecycleStatus': DistributionLifecycleStatus.EXPIRED,
          'metadata.distribution.publishStatus': DistributionPublishStatus.EXPIRED,
        }),
      }),
    )
    expect(employeeDispatchService.expireDeliveryRecord).toHaveBeenCalledWith(
      orgId,
      deliveryRecordId,
      expect.objectContaining({
        reason: 'publish_not_confirmed_within_48h',
      }),
    )
    expect(webhookService.trigger).toHaveBeenCalledWith(
      'distribution.expired',
      expect.objectContaining({
        contentId: taskId.toString(),
      }),
    )
    expect(notificationService.send).toHaveBeenCalledWith(
      orgId,
      expect.any(String),
      expect.objectContaining({
        type: 'distribution_follow_up_required',
      }),
    )
  })

  it('应在任务完成后优先进入分发队列', async () => {
    const taskId = new Types.ObjectId().toString()

    const result = await service.notifyTaskComplete({
      _id: new Types.ObjectId(taskId),
    } as any)

    expect(distributionQueueService.enqueueCompletedTask).toHaveBeenCalledWith(taskId)
    expect(result).toEqual({
      queued: true,
      taskId: 'task-queued',
    })
  })

  it('应在已存在 deliveryRecordId 时跳过重复派发', async () => {
    const orgId = new Types.ObjectId().toString()
    const taskId = new Types.ObjectId().toString()
    const deliveryRecordId = new Types.ObjectId().toString()
    const task = {
      _id: new Types.ObjectId(taskId),
      orgId: new Types.ObjectId(orgId),
      status: VideoTaskStatus.COMPLETED,
      outputVideoUrl: 'https://cdn.example.com/task.mp4',
      dedup: {
        status: 'passed',
      },
      metadata: {
        distribution: {
          publishStatus: DistributionPublishStatus.PUSHED,
          employeeDispatch: {
            deliveryRecordId,
          },
        },
      },
      toObject() {
        return this
      },
    }

    videoTaskModel.findById.mockReturnValue(createQuery(task))

    const result = await service.processCompletedTask(taskId)

    expect(employeeDispatchService.batchDispatch).not.toHaveBeenCalled()
    expect(notificationService.send).not.toHaveBeenCalled()
    expect(webhookService.trigger).not.toHaveBeenCalledWith('task.completed', expect.anything())
    expect(result).toEqual({
      taskId,
      skipped: true,
      reason: 'already_dispatched',
      deliveryRecordId,
      publishStatus: DistributionPublishStatus.PUSHED,
    })
  })

  it('应在发布确认时回传 publishPostId 并触发数据回流', async () => {
    const orgId = new Types.ObjectId().toString()
    const taskId = new Types.ObjectId().toString()
    const task = {
      _id: new Types.ObjectId(taskId),
      orgId: new Types.ObjectId(orgId),
      status: VideoTaskStatus.COMPLETED,
      metadata: {
        distribution: {
          publishStatus: DistributionPublishStatus.PUSHED,
        },
      },
    }
    const refreshedTask = {
      ...task,
      status: VideoTaskStatus.PUBLISHED,
      metadata: {
        publishInfo: {
          platform: 'xiaohongshu',
          publishUrl: 'https://publish.example.com/post/1',
          publishPostId: 'post_1',
        },
        distribution: {
          publishStatus: DistributionPublishStatus.PUBLISHED,
        },
      },
    }

    videoTaskModel.findOne.mockReturnValue(createQuery(task))
    videoTaskModel.findById.mockReturnValue(createQuery(refreshedTask))
    employeeDispatchService.confirmPublished.mockResolvedValue({
      confirmed: true,
      id: new Types.ObjectId().toString(),
    })

    const result = await service.confirmPublish(
      orgId,
      taskId,
      'https://publish.example.com/post/1',
      'xiaohongshu',
      'post_1',
    )

    expect(employeeDispatchService.confirmPublished).toHaveBeenCalledWith(
      orgId,
      taskId,
      expect.objectContaining({
        publishPostId: 'post_1',
      }),
    )
    expect(notificationService.send).toHaveBeenCalledWith(
      orgId,
      expect.any(String),
      expect.objectContaining({
        publishPostId: 'post_1',
      }),
    )
    expect(webhookService.trigger).toHaveBeenCalledWith(
      'distribution.published',
      expect.objectContaining({
        publishPostId: 'post_1',
      }),
    )
    expect(result.publishPostId).toBe('post_1')
  })

  it('应在员工拒绝发布回调后转为 ready 并尝试重新分发', async () => {
    const orgId = new Types.ObjectId().toString()
    const pipelineId = new Types.ObjectId().toString()
    const taskId = new Types.ObjectId().toString()
    const deliveryRecordId = new Types.ObjectId().toString()
    const assignmentId = new Types.ObjectId().toString()
    const reassignedAssignmentId = new Types.ObjectId().toString()
    const task = {
      _id: new Types.ObjectId(taskId),
      orgId: new Types.ObjectId(orgId),
      pipelineId: new Types.ObjectId(pipelineId),
      status: VideoTaskStatus.COMPLETED,
      dedup: {
        status: 'passed',
      },
      metadata: {
        distribution: {
          publishStatus: DistributionPublishStatus.PUSHED,
          employeeDispatch: {
            assignmentId,
            deliveryRecordId,
            deliveryStatus: 'pushed',
          },
        },
      },
      toObject() {
        return this
      },
    }

    videoTaskModel.findOne.mockReturnValue(createQuery(task))
    videoTaskModel.findByIdAndUpdate.mockReturnValue(createQuery({
      ...task,
      metadata: {
        distribution: {
          publishStatus: DistributionPublishStatus.COMPLETED,
          lifecycleStatus: DistributionLifecycleStatus.READY,
          callbackStatus: DistributionCallbackStatus.REJECTED,
          rejectionReason: '素材不匹配',
        },
      },
    }))
    videoTaskModel.find.mockReturnValue(createQuery([task]))
    pipelineModel.findOne.mockReturnValue(createQuery({
      _id: new Types.ObjectId(pipelineId),
      orgId: new Types.ObjectId(orgId),
      distributionRules: {
        assignmentIds: [reassignedAssignmentId],
      },
    }))
    employeeDispatchService.batchDispatch.mockResolvedValue({
      total: 1,
      dispatched: 1,
      failed: 0,
      pending: 0,
      strategy: 'round-robin',
      results: [
        {
          videoTaskId: taskId,
          dispatched: true,
          assignmentId: reassignedAssignmentId,
          status: 'pushed',
        },
      ],
    })

    const result = await service.handleEmployeeCallback(orgId, taskId, {
      status: DistributionCallbackStatus.REJECTED,
      reason: '素材不匹配',
    })

    expect(employeeDispatchService.expireDeliveryRecord).toHaveBeenCalledWith(
      orgId,
      deliveryRecordId,
      expect.objectContaining({
        reason: '素材不匹配',
      }),
    )
    expect(employeeDispatchService.batchDispatch).toHaveBeenCalledWith(
      orgId,
      [taskId],
      expect.objectContaining({
        assignmentIds: [reassignedAssignmentId],
      }),
    )
    expect(result.callbackStatus).toBe(DistributionCallbackStatus.REJECTED)
    expect(result.reassignment).toEqual(
      expect.objectContaining({
        reassigned: true,
      }),
    )
  })

  it('应返回推送转发布转化率与平均发布时间', async () => {
    const orgId = new Types.ObjectId().toString()
    videoTaskModel.find.mockReturnValue(createQuery([
      {
        _id: new Types.ObjectId(),
        orgId: new Types.ObjectId(orgId),
        status: VideoTaskStatus.PUBLISHED,
        publishedAt: new Date('2026-04-08T02:00:00.000Z'),
        metadata: {
          distribution: {
            publishStatus: DistributionPublishStatus.PUBLISHED,
            pushedAt: '2026-04-08T00:00:00.000Z',
            publishedAt: '2026-04-08T02:00:00.000Z',
            lastStatusAt: '2026-04-08T02:00:00.000Z',
          },
        },
      },
      {
        _id: new Types.ObjectId(),
        orgId: new Types.ObjectId(orgId),
        status: VideoTaskStatus.COMPLETED,
        metadata: {
          distribution: {
            publishStatus: DistributionPublishStatus.PUSHED,
            pushedAt: '2026-04-08T03:00:00.000Z',
            lastStatusAt: '2026-04-08T03:00:00.000Z',
          },
        },
      },
    ]))

    const result = await service.getDashboardStats(orgId, { days: 30 })

    expect(result.totals.pushed).toBe(2)
    expect(result.totals.published).toBe(1)
    expect(result.pushToPublishConversionRate).toBe(50)
    expect(result.avgTimeToPublishHours).toBe(2)
  })
})
