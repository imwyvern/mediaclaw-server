import { Types } from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ImSessionService } from './im-session.service'

vi.mock('@yikart/mongodb', () => {
  class DeliveryRecord {}
  class ImSession {}
  class VideoTask {}

  return {
    DeliveryRecord,
    ImSession,
    VideoTask,
    DeliveryRecordStatus: {
      PENDING: 'pending',
      PUSHED: 'pushed',
      RECEIVED: 'received',
      PUBLISHED: 'published',
      EXPIRED: 'expired',
    },
    ImSessionMessageType: {
      CARD: 'card',
      APPROVAL: 'approval',
      REPORT: 'report',
      TEXT: 'text',
      SYSTEM: 'system',
    },
    ImSessionRole: {
      ADMIN: 'admin',
      EDITOR: 'editor',
      REVIEWER: 'reviewer',
      READONLY: 'readonly',
    },
    ImSessionState: {
      CREATED: 'created',
      REVIEWING: 'reviewing',
      VOTING: 'voting',
      CONFIRMED: 'confirmed',
      PUBLISHED: 'published',
      REJECTED: 'rejected',
      EXPIRED: 'expired',
    },
    ImSessionVoteDecision: {
      APPROVE: 'approve',
      REJECT: 'reject',
    },
  }
})

function createQuery<T>(value: T) {
  const query = {
    lean: vi.fn(),
    exec: vi.fn().mockResolvedValue(value),
  }

  query.lean.mockReturnValue(query)
  return query
}

describe('imSessionService', () => {
  let service: ImSessionService
  let imSessionModel: Record<string, any>
  let deliveryRecordModel: Record<string, any>
  let videoTaskModel: Record<string, any>

  beforeEach(() => {
    imSessionModel = {
      find: vi.fn(),
      findOne: vi.fn(),
      findOneAndUpdate: vi.fn(),
      findByIdAndUpdate: vi.fn(),
    }
    deliveryRecordModel = {
      findOne: vi.fn(),
    }
    videoTaskModel = {
      findByIdAndUpdate: vi.fn().mockReturnValue(createQuery(null)),
    }

    service = new ImSessionService(
      imSessionModel as any,
      deliveryRecordModel as any,
      videoTaskModel as any,
    )
  })

  it('应创建分发 session 并同步任务协作状态', async () => {
    const sessionId = new Types.ObjectId()
    imSessionModel.findOneAndUpdate.mockReturnValue(createQuery({
      _id: sessionId,
      orgId: 'org-1',
      videoTaskId: 'task-1',
      deliveryRecordId: 'delivery-1',
      employeeAssignmentId: 'assignment-1',
      channel: 'feishu',
      conversationId: 'chat-1',
      state: 'created',
      participants: [
        {
          memberId: 'editor-1',
          role: 'editor',
        },
      ],
      messages: [],
      deliverySnapshot: {
        title: '待审批视频',
        summary: '视频摘要',
      },
      collaboration: {
        lastTouchedAt: '2026-04-10T10:00:00.000Z',
      },
    }))

    const result = await service.ensureDispatchSession({
      orgId: 'org-1',
      videoTaskId: 'task-1',
      deliveryRecordId: 'delivery-1',
      employeeAssignmentId: 'assignment-1',
      channel: 'feishu',
      conversationId: 'chat-1',
      title: '待审批视频',
      summary: '视频摘要',
      initialMessage: '初始化消息',
      participant: {
        memberId: 'editor-1',
        role: 'editor',
      },
    })

    expect(result).toEqual(
      expect.objectContaining({
        id: sessionId.toString(),
        state: 'created',
        channel: 'feishu',
      }),
    )
    expect(videoTaskModel.findByIdAndUpdate).toHaveBeenCalledWith('task-1', {
      $set: {
        'metadata.distribution.sessionId': sessionId.toString(),
        'metadata.distribution.collaborationState': 'created',
      },
    })
  })

  it('应在投票达到阈值后将 session 标记为 confirmed', async () => {
    const sessionId = new Types.ObjectId()
    imSessionModel.findOne.mockReturnValue(createQuery({
      _id: sessionId,
      orgId: 'org-1',
      videoTaskId: 'task-1',
      deliveryRecordId: 'delivery-1',
      state: 'voting',
      participants: [
        {
          memberId: 'reviewer-1',
          role: 'reviewer',
        },
      ],
      approval: {
        requiredVotes: 1,
        votes: [],
      },
    }))
    imSessionModel.findByIdAndUpdate.mockReturnValue(createQuery({
      _id: sessionId,
      orgId: 'org-1',
      videoTaskId: 'task-1',
      deliveryRecordId: 'delivery-1',
      state: 'confirmed',
      participants: [
        {
          memberId: 'reviewer-1',
          role: 'reviewer',
        },
      ],
      approval: {
        requiredVotes: 1,
        votes: [
          {
            memberId: 'reviewer-1',
            decision: 'approve',
          },
        ],
      },
      collaboration: {
        lastTouchedAt: '2026-04-10T10:10:00.000Z',
      },
    }))

    const result = await service.submitVote(
      'org-1',
      sessionId.toString(),
      'reviewer-1',
      'approve',
      '可以发布',
    )

    expect(result.state).toBe('confirmed')
    expect(videoTaskModel.findByIdAndUpdate).toHaveBeenCalledWith('task-1', {
      $set: expect.objectContaining({
        'metadata.distribution.collaborationState': 'confirmed',
      }),
    })
  })

  it('应修复 session 与 deliveryRecord 的不一致关系', async () => {
    const sessionId = new Types.ObjectId()
    const actualRecordId = new Types.ObjectId()
    imSessionModel.find.mockReturnValue(createQuery([
      {
        _id: sessionId,
        orgId: 'org-1',
        videoTaskId: 'task-1',
        deliveryRecordId: 'stale-record',
      },
    ]))
    deliveryRecordModel.findOne.mockReturnValue(createQuery({
      _id: actualRecordId,
      orgId: 'org-1',
      videoTaskId: 'task-1',
    }))
    imSessionModel.findByIdAndUpdate.mockReturnValue(createQuery(null))

    const result = await service.validateConsistency()

    expect(result).toEqual({
      scanned: 1,
      repaired: 1,
    })
    expect(imSessionModel.findByIdAndUpdate).toHaveBeenCalledWith(sessionId, {
      $set: expect.objectContaining({
        deliveryRecordId: actualRecordId.toString(),
      }),
    })
  })
})
