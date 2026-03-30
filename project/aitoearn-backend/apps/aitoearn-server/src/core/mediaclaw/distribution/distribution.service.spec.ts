import { Types } from 'mongoose'
import { vi } from 'vitest'
import {
  DistributionRuleType,
  VideoTaskStatus,
} from '@yikart/mongodb'
import {
  DistributionPublishStatus,
  DistributionService,
} from './distribution.service'

vi.mock('@yikart/mongodb', () => {
  class DistributionRule {}
  class PaymentOrder {}
  class VideoTask {}

  return {
    DistributionRule,
    DistributionRuleType: {
      BY_EMPLOYEE: 'by-employee',
      BY_PLATFORM: 'by-platform',
      BY_DIMENSION: 'by-dimension',
    },
    PaymentOrder,
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
  }
})

function createQuery<T>(value: T) {
  const query = {
    sort: vi.fn(),
    lean: vi.fn(),
    exec: vi.fn().mockResolvedValue(value),
  }

  query.sort.mockReturnValue(query)
  query.lean.mockReturnValue(query)

  return query
}

describe('DistributionService', () => {
  let service: DistributionService
  let distributionRuleModel: Record<string, any>
  let videoTaskModel: Record<string, any>
  let webhookService: Record<string, any>

  beforeEach(() => {
    distributionRuleModel = {
      find: vi.fn(),
    }

    videoTaskModel = {
      findById: vi.fn(),
      findByIdAndUpdate: vi.fn(),
    }

    webhookService = {
      trigger: vi.fn().mockResolvedValue(undefined),
    }

    service = new DistributionService(
      distributionRuleModel as any,
      videoTaskModel as any,
      webhookService as any,
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

  it('应推送已完成内容并记录分发结果', async () => {
    const orgId = new Types.ObjectId().toString()
    const taskId = new Types.ObjectId().toString()
    const task = {
      _id: new Types.ObjectId(taskId),
      orgId: new Types.ObjectId(orgId),
      status: VideoTaskStatus.COMPLETED,
      metadata: {},
    }
    const updatedTask = {
      _id: task._id,
      orgId: task.orgId,
      status: VideoTaskStatus.COMPLETED,
      metadata: {
        distribution: {
          publishStatus: DistributionPublishStatus.PUSHED,
          targets: [
            {
              action: 'publish',
              target: 'douyin-official',
              status: DistributionPublishStatus.PUSHED,
              pushedAt: '2026-03-29T10:00:00.000Z',
            },
          ],
          history: [],
          feedback: [],
          lastDistributedAt: '2026-03-29T10:00:00.000Z',
          lastStatusAt: '2026-03-29T10:00:00.000Z',
        },
      },
    }

    videoTaskModel.findById.mockReturnValue(createQuery(task))
    videoTaskModel.findByIdAndUpdate.mockReturnValue(createQuery(updatedTask))

    const result = await service.distribute(orgId, taskId, [
      {
        action: 'publish',
        target: 'douyin-official',
      },
    ])

    expect(result.publishStatus).toBe(DistributionPublishStatus.PUSHED)
    expect(result.targets).toHaveLength(1)
    expect(result.targets[0]).toMatchObject({
      action: 'publish',
      target: 'douyin-official',
      status: DistributionPublishStatus.PUSHED,
    })
    expect(webhookService.trigger).toHaveBeenCalledWith(
      'distribution.pushed',
      expect.objectContaining({
        orgId,
        contentId: taskId,
      }),
    )
  })

  it('应跟踪内容发布状态', async () => {
    const taskId = new Types.ObjectId().toString()
    const task = {
      _id: new Types.ObjectId(taskId),
      status: VideoTaskStatus.COMPLETED,
      metadata: {
        distribution: {
          publishStatus: DistributionPublishStatus.PUSHED,
        },
      },
      toObject: () => ({
        _id: new Types.ObjectId(taskId),
        status: VideoTaskStatus.COMPLETED,
        metadata: {
          distribution: {
            publishStatus: DistributionPublishStatus.PUSHED,
          },
        },
      }),
    }
    const publishedTask = {
      _id: task._id,
      status: VideoTaskStatus.COMPLETED,
      metadata: {
        publishedAt: '2026-03-29T11:00:00.000Z',
        distribution: {
          publishStatus: DistributionPublishStatus.PUBLISHED,
          history: [],
          feedback: [],
          targets: [],
          lastStatusAt: '2026-03-29T11:00:00.000Z',
        },
      },
    }

    videoTaskModel.findById.mockReturnValue(createQuery(task))
    videoTaskModel.findByIdAndUpdate.mockReturnValue(createQuery(publishedTask))

    const result = await service.trackPublishStatus(
      taskId,
      DistributionPublishStatus.PUBLISHED,
    )

    expect(result.publishStatus).toBe(DistributionPublishStatus.PUBLISHED)
    expect(videoTaskModel.findByIdAndUpdate).toHaveBeenCalledWith(
      task._id,
      expect.objectContaining({
        $set: expect.objectContaining({
          'metadata.distribution.publishStatus': DistributionPublishStatus.PUBLISHED,
          'metadata.publishedAt': expect.any(String),
        }),
      }),
      { new: true },
    )
  })
})
