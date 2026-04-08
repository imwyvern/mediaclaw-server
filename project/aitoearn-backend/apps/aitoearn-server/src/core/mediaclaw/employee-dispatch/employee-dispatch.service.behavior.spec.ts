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
  class PlatformAccount {}
  class VideoTask {}

  return {
    EmployeeAssignment,
    DeliveryRecord,
    PlatformAccount,
    VideoTask,
    DeliveryChannel: {
      FEISHU: 'feishu',
      WECOM: 'wecom',
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

  beforeEach(() => {
    employeeAssignmentModel = {
      find: vi.fn(),
      findByIdAndUpdate: vi.fn().mockReturnValue(createQuery(null)),
    }
    deliveryRecordModel = {
      find: vi.fn(),
      findById: vi.fn(),
      findByIdAndUpdate: vi.fn(),
      countDocuments: vi.fn().mockResolvedValue(1),
    }
    platformAccountModel = {
      find: vi.fn().mockReturnValue(createQuery([])),
    }
    videoTaskModel = {
      find: vi.fn(),
      findByIdAndUpdate: vi.fn().mockReturnValue(createQuery(null)),
    }

    service = new EmployeeDispatchService(
      employeeAssignmentModel as any,
      deliveryRecordModel as any,
      platformAccountModel as any,
      videoTaskModel as any,
      { pushVideoCard: vi.fn() } as any,
      { pushVideoCard: vi.fn() } as any,
      { buildGenericWebhookPayload: vi.fn(), deliverViaWebhook: vi.fn() } as any,
    )
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
})
