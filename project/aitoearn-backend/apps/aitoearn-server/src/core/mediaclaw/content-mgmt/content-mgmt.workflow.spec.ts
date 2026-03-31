import { BadRequestException } from '@nestjs/common'
import {
  NotificationEvent,
  OrgType,
  SubscriptionPlan,
  SubscriptionStatus,
  UserRole,
  VideoTaskStatus,
} from '@yikart/mongodb'
import { Types } from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContentMgmtService } from './content-mgmt.service'

function createQuery<T>(value: T) {
  const query = {
    lean: vi.fn(),
    exec: vi.fn().mockResolvedValue(value),
    sort: vi.fn(),
    skip: vi.fn(),
    limit: vi.fn(),
  }

  query.lean.mockReturnValue(query)
  query.sort.mockReturnValue(query)
  query.skip.mockReturnValue(query)
  query.limit.mockReturnValue(query)

  return query
}

function createTask(overrides: Record<string, any> = {}) {
  const _id = overrides['_id'] || new Types.ObjectId()
  const orgId = overrides['orgId'] || new Types.ObjectId()

  return {
    _id,
    orgId,
    brandId: null,
    pipelineId: null,
    userId: 'user-1',
    taskType: 'remix',
    status: VideoTaskStatus.COMPLETED,
    sourceVideoUrl: 'https://cdn.example.com/source.mp4',
    outputVideoUrl: 'https://cdn.example.com/output.mp4',
    copy: {
      title: 'title',
      subtitle: 'subtitle',
      hashtags: ['#demo'],
      blueWords: ['转化'],
      commentGuide: '评论引导',
      commentGuides: ['评论引导 1', '评论引导 2', '评论引导 3'],
    },
    metadata: {},
    createdAt: new Date('2026-03-30T08:00:00.000Z'),
    updatedAt: new Date('2026-03-30T08:00:00.000Z'),
    completedAt: new Date('2026-03-30T08:05:00.000Z'),
    ...overrides,
  }
}

describe('ContentMgmtService approval workflow', () => {
  const notificationService = {
    send: vi.fn().mockResolvedValue(undefined),
  }
  const webhookService = {
    trigger: vi.fn().mockResolvedValue(undefined),
  }

  let videoTaskModel: Record<string, any>
  let organizationModel: Record<string, any>
  let subscriptionModel: Record<string, any>
  let mediaClawUserModel: Record<string, any>
  let service: ContentMgmtService

  beforeEach(() => {
    videoTaskModel = {
      findById: vi.fn(),
      findByIdAndUpdate: vi.fn(),
      findOne: vi.fn(),
      find: vi.fn(),
      updateMany: vi.fn(),
      countDocuments: vi.fn(),
    }
    organizationModel = {
      findById: vi.fn(),
      findByIdAndUpdate: vi.fn(),
    }
    subscriptionModel = {
      findOne: vi.fn(),
    }
    mediaClawUserModel = {
      findById: vi.fn(),
    }

    notificationService.send.mockClear()
    webhookService.trigger.mockClear()

    service = new ContentMgmtService(
      videoTaskModel as any,
      organizationModel as any,
      subscriptionModel as any,
      mediaClawUserModel as any,
      notificationService as any,
      webhookService as any,
    )
  })

  it('should auto-submit completed content into multi-level review for pro orgs', async () => {
    const task = createTask()
    const updatedTask = createTask({
      _id: task._id,
      orgId: task.orgId,
      status: VideoTaskStatus.PENDING_REVIEW,
      approval: {
        currentLevel: 1,
        maxLevel: 2,
        pendingRoles: [UserRole.EDITOR, UserRole.ADMIN],
        lastAction: 'submitted',
        lastComment: '',
        submittedAt: new Date('2026-03-30T08:06:00.000Z'),
        reviewedAt: null,
        history: [],
      },
    })

    videoTaskModel.findById.mockReturnValue(createQuery(task))
    videoTaskModel.findByIdAndUpdate.mockReturnValue(createQuery(updatedTask))
    organizationModel.findById.mockReturnValue(createQuery({
      _id: task.orgId,
      type: OrgType.PROFESSIONAL,
      settings: {},
    }))
    subscriptionModel.findOne.mockReturnValue(createQuery({
      orgId: task.orgId,
      plan: SubscriptionPlan.PRO,
      status: SubscriptionStatus.ACTIVE,
    }))

    const result = await service.initializeWorkflowForTask(task._id.toString())

    expect(result.status).toBe(VideoTaskStatus.PENDING_REVIEW)
    expect(result.approval.maxLevel).toBe(2)
    expect(result.approval.pendingRoles).toEqual([UserRole.EDITOR, UserRole.ADMIN])
    expect(notificationService.send).toHaveBeenCalledWith(
      task.orgId.toString(),
      NotificationEvent.CONTENT_PENDING_REVIEW,
      expect.objectContaining({
        currentLevel: 1,
        maxLevel: 2,
      }),
    )
  })

  it('should escalate review to the next level after editor approval', async () => {
    const task = createTask({
      status: VideoTaskStatus.PENDING_REVIEW,
      approval: {
        currentLevel: 1,
        maxLevel: 2,
        pendingRoles: [UserRole.EDITOR, UserRole.ADMIN],
        lastAction: 'submitted',
        lastComment: '',
        submittedAt: new Date('2026-03-30T08:06:00.000Z'),
        reviewedAt: null,
        history: [],
      },
    })
    const reviewerId = new Types.ObjectId()
    const updatedTask = createTask({
      _id: task._id,
      orgId: task.orgId,
      status: VideoTaskStatus.PENDING_REVIEW,
      approval: {
        currentLevel: 2,
        maxLevel: 2,
        pendingRoles: [UserRole.ADMIN],
        lastAction: 'approved',
        lastComment: '初审通过',
        submittedAt: new Date('2026-03-30T08:06:00.000Z'),
        reviewedAt: new Date('2026-03-30T08:10:00.000Z'),
        history: [
          {
            level: 1,
            reviewerId: reviewerId.toString(),
            reviewerName: 'Editor Reviewer',
            reviewerRole: UserRole.EDITOR,
            action: 'approved',
            comment: '初审通过',
            at: new Date('2026-03-30T08:10:00.000Z'),
          },
        ],
      },
    })

    videoTaskModel.findOne.mockReturnValue(createQuery(task))
    videoTaskModel.findByIdAndUpdate.mockReturnValue(createQuery(updatedTask))
    mediaClawUserModel.findById.mockReturnValue(createQuery({
      _id: reviewerId,
      orgId: task.orgId,
      role: UserRole.EDITOR,
      name: 'Editor Reviewer',
      isActive: true,
      orgMemberships: [],
    }))

    const result = await service.reviewContent(
      task.orgId.toString(),
      task._id.toString(),
      reviewerId.toString(),
      {
        action: 'approve',
        comment: '初审通过',
      },
    )

    expect(result.status).toBe(VideoTaskStatus.PENDING_REVIEW)
    expect(result.approval.currentLevel).toBe(2)
    expect(result.approval.pendingRoles).toEqual([UserRole.ADMIN])
    expect(notificationService.send).toHaveBeenCalledWith(
      task.orgId.toString(),
      NotificationEvent.CONTENT_PENDING_REVIEW,
      expect.objectContaining({
        currentLevel: 2,
        comment: '初审通过',
      }),
    )
  })

  it('should mark content approved after final admin review', async () => {
    const task = createTask({
      status: VideoTaskStatus.PENDING_REVIEW,
      approval: {
        currentLevel: 2,
        maxLevel: 2,
        pendingRoles: [UserRole.ADMIN],
        lastAction: 'approved',
        lastComment: '进入终审',
        submittedAt: new Date('2026-03-30T08:06:00.000Z'),
        reviewedAt: new Date('2026-03-30T08:10:00.000Z'),
        history: [],
      },
    })
    const reviewerId = new Types.ObjectId()
    const updatedTask = createTask({
      _id: task._id,
      orgId: task.orgId,
      status: VideoTaskStatus.APPROVED,
      approval: {
        currentLevel: 2,
        maxLevel: 2,
        pendingRoles: [],
        lastAction: 'approved',
        lastComment: '终审通过',
        submittedAt: new Date('2026-03-30T08:06:00.000Z'),
        reviewedAt: new Date('2026-03-30T08:15:00.000Z'),
        history: [],
      },
    })

    videoTaskModel.findOne.mockReturnValue(createQuery(task))
    videoTaskModel.findByIdAndUpdate.mockReturnValue(createQuery(updatedTask))
    mediaClawUserModel.findById.mockReturnValue(createQuery({
      _id: reviewerId,
      orgId: task.orgId,
      role: UserRole.ADMIN,
      name: 'Admin Reviewer',
      isActive: true,
      orgMemberships: [],
    }))

    const result = await service.reviewContent(
      task.orgId.toString(),
      task._id.toString(),
      reviewerId.toString(),
      {
        action: 'approve',
        comment: '终审通过',
      },
    )

    expect(result.status).toBe(VideoTaskStatus.APPROVED)
    expect(result.approval.pendingRoles).toEqual([])
    expect(notificationService.send).toHaveBeenCalledWith(
      task.orgId.toString(),
      NotificationEvent.CONTENT_APPROVED,
      expect.objectContaining({
        comment: '终审通过',
      }),
    )
  })

  it('should block publishing when content is still pending review', async () => {
    const task = createTask({
      status: VideoTaskStatus.PENDING_REVIEW,
      approval: {
        currentLevel: 1,
        maxLevel: 2,
        pendingRoles: [UserRole.EDITOR, UserRole.ADMIN],
        lastAction: 'submitted',
        lastComment: '',
        submittedAt: new Date('2026-03-30T08:06:00.000Z'),
        reviewedAt: null,
        history: [],
      },
    })

    videoTaskModel.findOne.mockReturnValue(createQuery(task))

    await expect(
      service.markPublished(
        task.orgId.toString(),
        task._id.toString(),
        'douyin',
        'https://publish.example.com/1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('should publish approved content and emit published event', async () => {
    const task = createTask({
      status: VideoTaskStatus.APPROVED,
      approval: {
        currentLevel: 2,
        maxLevel: 2,
        pendingRoles: [],
        lastAction: 'approved',
        lastComment: '终审通过',
        submittedAt: new Date('2026-03-30T08:06:00.000Z'),
        reviewedAt: new Date('2026-03-30T08:15:00.000Z'),
        history: [],
      },
    })
    const publisherId = new Types.ObjectId()
    const updatedTask = createTask({
      _id: task._id,
      orgId: task.orgId,
      status: VideoTaskStatus.PUBLISHED,
      publishedAt: new Date('2026-03-30T08:20:00.000Z'),
      approval: {
        currentLevel: 2,
        maxLevel: 2,
        pendingRoles: [],
        lastAction: 'published',
        lastComment: 'Published to xiaohongshu',
        submittedAt: new Date('2026-03-30T08:06:00.000Z'),
        reviewedAt: new Date('2026-03-30T08:15:00.000Z'),
        history: [],
      },
      metadata: {
        publishInfo: {
          platform: 'xiaohongshu',
          publishUrl: 'https://publish.example.com/2',
          publishedAt: '2026-03-30T08:20:00.000Z',
        },
        distribution: {
          publishStatus: 'published',
        },
      },
    })

    videoTaskModel.findOne.mockReturnValue(createQuery(task))
    videoTaskModel.findByIdAndUpdate.mockReturnValue(createQuery(updatedTask))
    mediaClawUserModel.findById.mockReturnValue(createQuery({
      _id: publisherId,
      orgId: task.orgId,
      role: UserRole.ADMIN,
      name: 'Publisher',
      isActive: true,
      orgMemberships: [],
    }))

    const result = await service.markPublished(
      task.orgId.toString(),
      task._id.toString(),
      'xiaohongshu',
      'https://publish.example.com/2',
      publisherId.toString(),
    )

    expect(result.status).toBe(VideoTaskStatus.PUBLISHED)
    expect(result.publishInfo.platform).toBe('xiaohongshu')
    expect(notificationService.send).toHaveBeenCalledWith(
      task.orgId.toString(),
      NotificationEvent.CONTENT_PUBLISHED,
      expect.objectContaining({
        platform: 'xiaohongshu',
        publishUrl: 'https://publish.example.com/2',
      }),
    )
  })
})
