import { Types } from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DistributionPublishStatus } from '../distribution/distribution.constants'
import { EmployeeDispatchService } from './employee-dispatch.service'

const DELIVERY_PENDING = 'pending'
const DELIVERY_RECEIVED = 'received'
const DELIVERY_PUBLISHED = 'published'

vi.mock('@yikart/mongodb', () => {
  class EmployeeAssignment {}
  class DeliveryRecord {}
  class ImSession {}
  class PlatformAccount {}
  class VideoTask {}

  return {
    EmployeeAssignment,
    DeliveryRecord,
    ImSession,
    PlatformAccount,
    VideoTask,
    DeliveryChannel: {
      FEISHU: 'feishu',
      WECOM: 'wecom',
      DINGTALK: 'dingtalk',
      TELEGRAM: 'telegram',
      WEBHOOK: 'webhook',
      EMAIL: 'email',
      MANUAL: 'manual',
    },
    DeliveryRecordStatus: {
      PENDING: 'pending',
      PUSHED: 'pushed',
      DELIVERED: 'pushed',
      RECEIVED: 'received',
      CONFIRMED: 'received',
      DOWNLOADED: 'downloaded',
      PUBLISHED: 'published',
      EXPIRED: 'expired',
      FAILED: 'failed',
    },
    EmployeeAssignmentStatus: {
      ACTIVE: 'active',
      INACTIVE: 'inactive',
      REMOVED: 'removed',
      PAUSED: 'inactive',
      DISABLED: 'removed',
    },
    ImSessionRole: {
      ADMIN: 'admin',
      EDITOR: 'editor',
      REVIEWER: 'reviewer',
      READONLY: 'readonly',
    },
    VideoTaskStatus: {
      PUBLISHED: 'published',
    },
  }
})

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

describe('employeeDispatchService', () => {
  let service: EmployeeDispatchService
  let employeeAssignmentModel: Record<string, any>
  let deliveryRecordModel: Record<string, any>
  let platformAccountModel: Record<string, any>
  let videoTaskModel: Record<string, any>
  let imDeliveryService: Record<string, any>
  let clawHostGatewayPushService: Record<string, any>
  let imChannelRegistryService: Record<string, any>
  let imSessionService: Record<string, any>

  beforeEach(() => {
    employeeAssignmentModel = {
      find: vi.fn(),
      countDocuments: vi.fn().mockResolvedValue(0),
      findById: vi.fn().mockReturnValue(createQuery(null)),
      findOneAndUpdate: vi.fn().mockReturnValue(createQuery(null)),
      findByIdAndUpdate: vi.fn().mockReturnValue(createQuery(null)),
    }
    deliveryRecordModel = {
      create: vi.fn(),
      find: vi.fn(),
      findById: vi.fn(),
      findByIdAndUpdate: vi.fn().mockReturnValue(createQuery(null)),
      countDocuments: vi.fn().mockResolvedValue(1),
    }
    platformAccountModel = {
      find: vi.fn().mockReturnValue(createQuery([])),
    }
    videoTaskModel = {
      find: vi.fn(),
      findById: vi.fn().mockReturnValue(createQuery(null)),
      findByIdAndUpdate: vi.fn().mockReturnValue(createQuery(null)),
    }
    imDeliveryService = {
      buildGenericWebhookPayload: vi.fn(),
      deliverViaWebhook: vi.fn(),
    }
    clawHostGatewayPushService = {
      pushRealtimeEvent: vi.fn().mockResolvedValue({ attempted: 1, delivered: 1 }),
    }
    imChannelRegistryService = {
      pushVideoCard: vi.fn().mockResolvedValue(null),
      pushTemplateMessage: vi.fn().mockResolvedValue(null),
    }
    imSessionService = {
      ensureDispatchSession: vi.fn().mockResolvedValue({ id: 'session-1' }),
      markDeliveryReceived: vi.fn().mockResolvedValue(null),
      markPublished: vi.fn().mockResolvedValue(null),
      markExpired: vi.fn().mockResolvedValue(null),
      getSession: vi.fn().mockResolvedValue({
        id: 'session-1',
        deliveryRecordId: new Types.ObjectId().toString(),
      }),
      appendMessage: vi.fn().mockResolvedValue(null),
      startApproval: vi.fn().mockResolvedValue({
        id: 'session-1',
        state: 'reviewing',
        deliverySnapshot: {
          title: '审批标题',
          summary: '审批摘要',
        },
        approval: {
          requiredVotes: 2,
          votes: [],
        },
      }),
      submitVote: vi.fn().mockResolvedValue({
        id: 'session-1',
        state: 'confirmed',
        approval: {
          requiredVotes: 2,
          votes: [
            {
              memberId: 'reviewer-1',
              decision: 'approve',
            },
          ],
        },
      }),
    }

    service = new EmployeeDispatchService(
      employeeAssignmentModel as any,
      deliveryRecordModel as any,
      platformAccountModel as any,
      videoTaskModel as any,
      { pushVideoCard: vi.fn() } as any,
      { pushVideoCard: vi.fn() } as any,
      imDeliveryService as any,
      clawHostGatewayPushService as any,
      undefined,
      undefined,
      imChannelRegistryService as any,
      imSessionService as any,
    )
  })

  it('应对员工搜索关键字做正则转义', async () => {
    const orgId = new Types.ObjectId().toString()
    employeeAssignmentModel.find.mockReturnValue(createQuery([]))

    await service.listAssignments(orgId, { keyword: '1380+(vip).*' }, { page: 1, limit: 20 })

    expect(employeeAssignmentModel.find).toHaveBeenCalledWith({
      orgId,
      $or: [
        { employeeName: { $regex: '1380\\+\\(vip\\)\\.\\*', $options: 'i' } },
        { employeePhone: { $regex: '1380\\+\\(vip\\)\\.\\*', $options: 'i' } },
      ],
    })
    expect(employeeAssignmentModel.countDocuments).toHaveBeenCalledWith({
      orgId,
      $or: [
        { employeeName: { $regex: '1380\\+\\(vip\\)\\.\\*', $options: 'i' } },
        { employeePhone: { $regex: '1380\\+\\(vip\\)\\.\\*', $options: 'i' } },
      ],
    })
  })

  it('应按模板与账号类型筛选员工并支持单账号覆盖', async () => {
    const orgId = new Types.ObjectId().toString()
    const taskId = new Types.ObjectId().toString()
    const matchedAssignmentId = new Types.ObjectId().toString()
    const skippedAssignmentId = new Types.ObjectId().toString()
    const defaultAccountId = new Types.ObjectId().toString()
    const overrideAccountId = new Types.ObjectId().toString()
    const deliveryRecordId = new Types.ObjectId()
    const deliveredAt = new Date('2026-04-08T03:00:00.000Z')

    videoTaskModel.find.mockReturnValue(createQuery([
      {
        _id: new Types.ObjectId(taskId),
        orgId,
        outputVideoUrl: 'https://cdn.example.com/video.mp4',
        copy: {
          title: '今日上新',
        },
        metadata: {
          templateId: 'b7-ai-live',
          accountType: 'xiaohongshu',
          platform: 'xiaohongshu',
          contentTags: ['beer'],
        },
      },
    ]))
    employeeAssignmentModel.find.mockReturnValue(createQuery([
      {
        _id: new Types.ObjectId(matchedAssignmentId),
        orgId,
        employeeName: '小王',
        employeePhone: '13800000000',
        webhookUrl: 'https://dispatch.example.com/webhook',
        platformAccountIds: [defaultAccountId, overrideAccountId],
        distributionRules: {
          templateIds: ['b7-ai-live'],
          accountTypes: ['xiaohongshu'],
          defaultPlatformAccountId: defaultAccountId,
          preferredCategories: ['beer'],
        },
        stats: {
          totalPending: 0,
          totalAssigned: 0,
        },
      },
      {
        _id: new Types.ObjectId(skippedAssignmentId),
        orgId,
        employeeName: '小李',
        employeePhone: '13900000000',
        webhookUrl: 'https://dispatch.example.com/webhook',
        platformAccountIds: [new Types.ObjectId().toString()],
        distributionRules: {
          templateIds: ['b9-product-showcase'],
          accountTypes: ['douyin'],
        },
        stats: {
          totalPending: 0,
          totalAssigned: 0,
        },
      },
    ]))
    platformAccountModel.find.mockReturnValue(createQuery([
      {
        _id: new Types.ObjectId(defaultAccountId),
        platform: 'xiaohongshu',
        accountId: 'xhs_default',
        accountName: '小红书账号A',
        avatarUrl: '',
      },
      {
        _id: new Types.ObjectId(overrideAccountId),
        platform: 'xiaohongshu',
        accountId: 'xhs_override',
        accountName: '小红书账号B',
        avatarUrl: '',
      },
    ]))
    deliveryRecordModel.create.mockResolvedValue({
      _id: deliveryRecordId,
      orgId,
      videoTaskId: taskId,
      employeeAssignmentId: matchedAssignmentId,
    })
    imDeliveryService.buildGenericWebhookPayload.mockReturnValue({
      sent: true,
    })
    imDeliveryService.deliverViaWebhook.mockResolvedValue({
      success: true,
      manualPickupRequired: false,
      status: 'pushed',
      deliveredAt,
      retryCount: 0,
      payload: {
        delivered: true,
      },
    })

    const result = await service.batchDispatch(orgId, [taskId], {
      templateIds: ['b7-ai-live'],
      accountTypes: ['xiaohongshu'],
      platformAccountId: overrideAccountId,
    })

    expect(result.dispatched).toBe(1)
    expect(result.results[0]).toEqual(
      expect.objectContaining({
        videoTaskId: taskId,
        assignmentId: matchedAssignmentId,
        platformAccountId: overrideAccountId,
        platformAccountName: '小红书账号B',
        platform: 'xiaohongshu',
        status: 'pushed',
      }),
    )
    const [, taskUpdatePayload] = videoTaskModel.findByIdAndUpdate.mock.calls[0]
    expect(taskUpdatePayload.$set['metadata.distribution.accountType']).toBe('xiaohongshu')
    expect(taskUpdatePayload.$set['metadata.distribution.employeeDispatch']).toEqual(
      expect.objectContaining({
        platformAccountId: overrideAccountId,
        platformAccountName: '小红书账号B',
      }),
    )
    expect(clawHostGatewayPushService.pushRealtimeEvent).toHaveBeenCalledWith(orgId, expect.objectContaining({
      event: 'delivery.pending',
      capability: 'delivery',
    }))
  })

  it('应校验默认账号必须属于员工绑定账号集合', async () => {
    const orgId = new Types.ObjectId().toString()
    const platformAccountId = new Types.ObjectId().toString()
    const unexpectedDefaultAccountId = new Types.ObjectId().toString()

    platformAccountModel.find.mockReturnValue(createQuery([
      {
        _id: new Types.ObjectId(platformAccountId),
        orgId: new Types.ObjectId(orgId),
        platform: 'xiaohongshu',
        accountId: 'xhs_1',
        accountName: '小红书账号A',
      },
    ]))

    await expect(service.createAssignment(orgId, {
      employeeName: '小王',
      employeePhone: '13800000000',
      platformAccountIds: [platformAccountId],
      distributionRules: {
        defaultPlatformAccountId: unexpectedDefaultAccountId,
      },
    })).rejects.toThrow('defaultPlatformAccountId must belong to platformAccountIds')

    expect(employeeAssignmentModel.findOneAndUpdate).not.toHaveBeenCalled()
  })

  it('应在员工确认接收后把任务推进到 pushed 状态', async () => {
    const orgId = new Types.ObjectId().toString()
    const recordId = new Types.ObjectId()
    const record = {
      _id: recordId,
      orgId,
      videoTaskId: new Types.ObjectId().toString(),
      employeeAssignmentId: new Types.ObjectId().toString(),
      deliveryChannel: 'manual',
      status: DELIVERY_PENDING,
    }

    deliveryRecordModel.findById.mockReturnValue(createQuery(record))
    deliveryRecordModel.findByIdAndUpdate.mockReturnValue(createQuery({
      ...record,
      status: DELIVERY_RECEIVED,
      confirmedAt: new Date('2026-04-08T01:00:00.000Z'),
      receivedAt: new Date('2026-04-08T01:00:00.000Z'),
    }))

    const result = await service.confirmDelivery(orgId, recordId.toString())

    expect(result.status).toBe(DELIVERY_RECEIVED)
    expect(videoTaskModel.findByIdAndUpdate).toHaveBeenCalledWith(
      record.videoTaskId,
      expect.objectContaining({
        $set: expect.objectContaining({
          'metadata.distribution.publishStatus': DistributionPublishStatus.PUSHED,
          'metadata.distribution.employeeDispatch.deliveryStatus': DELIVERY_RECEIVED,
        }),
      }),
    )
    expect(imSessionService.markDeliveryReceived).toHaveBeenCalledWith(orgId, recordId.toString())
  })

  it('应在发布回传时写入 publish url 与 post id', async () => {
    const orgId = new Types.ObjectId().toString()
    const recordId = new Types.ObjectId()
    const record = {
      _id: recordId,
      orgId,
      videoTaskId: new Types.ObjectId().toString(),
      employeeAssignmentId: new Types.ObjectId().toString(),
      deliveryChannel: 'feishu',
      status: DELIVERY_RECEIVED,
    }

    deliveryRecordModel.findById.mockReturnValue(createQuery(record))
    deliveryRecordModel.findByIdAndUpdate.mockReturnValue(createQuery({
      ...record,
      status: DELIVERY_PUBLISHED,
      publishUrl: 'https://publish.example.com/post/2',
      publishPlatform: 'douyin',
      publishPostId: 'post_2',
    }))

    const result = await service.markPublished(orgId, recordId.toString(), {
      publishUrl: 'https://publish.example.com/post/2',
      publishPlatform: 'douyin',
      publishPostId: 'post_2',
    })

    expect(result.publishPostId).toBe('post_2')
    expect(videoTaskModel.findByIdAndUpdate).toHaveBeenCalledWith(
      record.videoTaskId,
      expect.objectContaining({
        $set: expect.objectContaining({
          'platformPostId': 'post_2',
          'platformPostUrl': 'https://publish.example.com/post/2',
          'metadata.platformPostId': 'post_2',
          'metadata.publishInfo': expect.objectContaining({
            publishPostId: 'post_2',
          }),
          'metadata.distribution.publishStatus': DistributionPublishStatus.PUBLISHED,
        }),
      }),
    )
    expect(imSessionService.markPublished).toHaveBeenCalledWith(orgId, recordId.toString(), {
      publishUrl: 'https://publish.example.com/post/2',
      publishPlatform: 'douyin',
      publishPostId: 'post_2',
    })
  })

  it('应返回 heartbeat 轮询所需的待处理投递列表', async () => {
    const orgId = new Types.ObjectId().toString()
    const assignmentId = new Types.ObjectId().toString()
    const taskId = new Types.ObjectId().toString()
    const record = {
      _id: new Types.ObjectId(),
      orgId,
      videoTaskId: taskId,
      employeeAssignmentId: assignmentId,
      deliveryChannel: 'manual',
      status: DELIVERY_PENDING,
      createdAt: new Date('2026-04-08T02:00:00.000Z'),
    }

    deliveryRecordModel.find.mockReturnValue(createQuery([record]))
    employeeAssignmentModel.find.mockReturnValue(createQuery([
      {
        _id: new Types.ObjectId(assignmentId),
        employeeName: '小王',
        employeePhone: '13800000000',
      },
    ]))
    videoTaskModel.find.mockReturnValue(createQuery([
      {
        _id: new Types.ObjectId(taskId),
        outputVideoUrl: 'https://cdn.example.com/video.mp4',
        copy: { title: '待发布视频' },
        metadata: {
          distribution: {
            heartbeatPending: true,
            publishStatus: DistributionPublishStatus.COMPLETED,
          },
        },
      },
    ]))

    const result = await service.listPendingDeliveries(orgId, {}, { page: 1, limit: 20 })

    expect(result.total).toBe(1)
    expect(result.items[0].heartbeatPending).toBe(true)
    expect(result.items[0].assignment).toEqual(
      expect.objectContaining({
        employeeName: '小王',
      }),
    )
    expect(result.items[0].task).toEqual(
      expect.objectContaining({
        id: taskId,
        publishStatus: DistributionPublishStatus.COMPLETED,
      }),
    )
  })

  it('应在 IM 渠道派发后自动建立协作 session', async () => {
    const orgId = new Types.ObjectId().toString()
    const taskId = new Types.ObjectId().toString()
    const assignmentId = new Types.ObjectId().toString()
    const deliveryRecordId = new Types.ObjectId()

    videoTaskModel.findById.mockReturnValue(createQuery({
      _id: new Types.ObjectId(taskId),
      orgId,
      outputVideoUrl: 'https://cdn.example.com/task.mp4',
      copy: {
        title: '待审批视频',
        description: '视频描述',
      },
      metadata: {
        platform: 'xiaohongshu',
      },
    }))
    employeeAssignmentModel.findById.mockReturnValue(createQuery({
      _id: new Types.ObjectId(assignmentId),
      orgId,
      employeeName: '小王',
      employeePhone: '13800000000',
      employeeUserId: 'editor-1',
      webhookUrl: 'https://open.feishu.cn/webhook/xxx',
      imBinding: {
        feishu: {
          chatId: 'chat_001',
        },
      },
    }))
    deliveryRecordModel.create.mockResolvedValue({
      _id: deliveryRecordId,
      orgId,
      videoTaskId: taskId,
      employeeAssignmentId: assignmentId,
    })
    imChannelRegistryService.pushVideoCard.mockResolvedValue({
      success: true,
      manualPickupRequired: false,
      status: 'pushed',
      deliveredAt: new Date('2026-04-10T10:00:00.000Z'),
      retryCount: 0,
      payload: { delivered: true },
    })

    const result = await service.dispatchToEmployee(orgId, taskId, assignmentId)

    expect(result.status).toBe('pushed')
    expect(imSessionService.ensureDispatchSession).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId,
        videoTaskId: taskId,
        employeeAssignmentId: assignmentId,
        channel: 'feishu',
        conversationId: 'chat_001',
      }),
    )
  })

  it('应在群审批发起后推送审批卡片', async () => {
    const orgId = new Types.ObjectId().toString()
    const recordId = new Types.ObjectId()
    const assignmentId = new Types.ObjectId().toString()

    deliveryRecordModel.findById.mockReturnValue(createQuery({
      _id: recordId,
      orgId,
      employeeAssignmentId: assignmentId,
      deliveryChannel: 'feishu',
      videoTaskId: new Types.ObjectId().toString(),
    }))
    employeeAssignmentModel.findById.mockReturnValue(createQuery({
      _id: new Types.ObjectId(assignmentId),
      orgId,
      employeeName: '小王',
      employeePhone: '13800000000',
      webhookUrl: 'https://open.feishu.cn/webhook/xxx',
      imBinding: {
        feishu: {
          chatId: 'chat_001',
        },
      },
    }))

    const result = await service.startSessionApproval(orgId, 'session-1', 'editor-1', 2, 12)

    expect(result.state).toBe('reviewing')
    expect(imChannelRegistryService.pushTemplateMessage).toHaveBeenCalledWith(
      'feishu',
      expect.any(Object),
      expect.objectContaining({
        kind: 'approval-card',
        title: '审批标题',
      }),
    )
  })
})
