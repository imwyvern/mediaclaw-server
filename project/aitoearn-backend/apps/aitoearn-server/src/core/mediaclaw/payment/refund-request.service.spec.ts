import {
  NotificationEvent,
  PackStatus,
  PaymentProductType,
  PaymentStatus,
  RefundExecutionMode,
  RefundRequestStatus,
  UserRole,
} from '@yikart/mongodb'
import { Types } from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RefundRequestService } from './refund-request.service'

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

function createOrder(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(),
    orderId: 'MC-REFUND-001',
    orgId: new Types.ObjectId(),
    userId: new Types.ObjectId().toString(),
    amount: 19900,
    currency: 'CNY',
    status: PaymentStatus.PAID,
    productType: PaymentProductType.VIDEO_PACK,
    xorpayOrderId: 'xor-trade-001',
    metadata: {},
    ...overrides,
  }
}

function createRequest(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(),
    requestId: 'RR001',
    paymentOrderId: new Types.ObjectId(),
    orderId: 'MC-REFUND-001',
    orgId: new Types.ObjectId(),
    userId: new Types.ObjectId().toString(),
    amount: 19900,
    currency: 'CNY',
    reason: '重复支付',
    description: '',
    status: RefundRequestStatus.PENDING,
    requestedBy: new Types.ObjectId().toString(),
    requestedAt: new Date('2026-04-10T10:00:00.000Z'),
    reviewedBy: null,
    reviewedAt: null,
    reviewComment: '',
    executedBy: null,
    executedAt: null,
    executionMode: null,
    executionResult: null,
    executionError: '',
    notifiedAt: null,
    notificationEvent: '',
    notificationError: '',
    metadata: {},
    createdAt: new Date('2026-04-10T10:00:00.000Z'),
    updatedAt: new Date('2026-04-10T10:00:00.000Z'),
    ...overrides,
  }
}

describe('refundRequestService', () => {
  let orderModel: Record<string, any>
  let refundRequestModel: Record<string, any>
  let videoPackModel: Record<string, any>
  let subscriptionModel: Record<string, any>
  let invoiceModel: Record<string, any>
  let notificationService: Record<string, any>
  let service: RefundRequestService

  beforeEach(() => {
    delete process.env['XORPAY_REFUND_URL']
    delete process.env['XORPAY_SECRET']

    orderModel = {
      findOne: vi.fn(),
      findByIdAndUpdate: vi.fn(),
    }
    refundRequestModel = {
      create: vi.fn(),
      countDocuments: vi.fn(),
      find: vi.fn(),
      findOne: vi.fn(),
      findByIdAndUpdate: vi.fn(),
    }
    videoPackModel = {
      updateMany: vi.fn(),
    }
    subscriptionModel = {
      findOne: vi.fn(),
      findByIdAndUpdate: vi.fn(),
    }
    invoiceModel = {
      findByIdAndUpdate: vi.fn(),
    }
    notificationService = {
      send: vi.fn().mockResolvedValue(undefined),
    }

    service = new RefundRequestService(
      orderModel as any,
      refundRequestModel as any,
      videoPackModel as any,
      subscriptionModel as any,
      invoiceModel as any,
      notificationService as any,
    )
  })

  it('应创建退款申请并通知组织', async () => {
    const userId = new Types.ObjectId().toString()
    const orgId = new Types.ObjectId()
    const order = createOrder({
      orgId,
      userId,
    })
    const created = createRequest({
      paymentOrderId: order._id,
      orderId: order.orderId,
      orgId,
      userId,
      requestedBy: userId,
    })

    orderModel.findOne.mockReturnValue(createQuery(order))
    refundRequestModel.findOne.mockReturnValue(createQuery(null))
    refundRequestModel.create.mockResolvedValue({
      ...created,
      toObject: () => ({ ...created }),
    })

    const result = await service.create(
      { id: userId, orgId: orgId.toString(), role: UserRole.EMPLOYEE },
      {
        orderId: order.orderId,
        amount: order.amount,
        reason: '重复支付',
        description: '用户提交退款',
      },
    )

    expect(refundRequestModel.create).toHaveBeenCalledWith(expect.objectContaining({
      orderId: order.orderId,
      amount: order.amount,
      status: RefundRequestStatus.PENDING,
      requestedBy: userId,
    }))
    expect(notificationService.send).toHaveBeenCalledWith(
      orgId.toString(),
      NotificationEvent.PAYMENT_REFUND_REQUESTED,
      expect.objectContaining({
        requestId: created.requestId,
        orderId: order.orderId,
      }),
    )
    expect(result.status).toBe(RefundRequestStatus.PENDING)
  })

  it('应驳回退款申请并通知申请人', async () => {
    const orgId = new Types.ObjectId()
    const userId = new Types.ObjectId().toString()
    const pendingRequest = createRequest({
      orgId,
      userId,
    })
    const rejectedRequest = {
      ...pendingRequest,
      status: RefundRequestStatus.REJECTED,
      reviewedBy: 'admin-1',
      reviewedAt: new Date('2026-04-10T11:00:00.000Z'),
      reviewComment: '凭证不足',
    }

    refundRequestModel.findOne.mockReturnValue(createQuery(pendingRequest))
    refundRequestModel.findByIdAndUpdate
      .mockReturnValueOnce(createQuery(rejectedRequest))
      .mockReturnValueOnce(createQuery({ modifiedCount: 1 }))

    const result = await service.review(
      { id: 'admin-1', orgId: orgId.toString(), role: UserRole.ENTERPRISE_ADMIN },
      pendingRequest.requestId,
      {
        action: 'reject',
        comment: '凭证不足',
      },
    )

    expect(result.status).toBe(RefundRequestStatus.REJECTED)
    expect(notificationService.send).toHaveBeenCalledWith(
      userId,
      NotificationEvent.PAYMENT_REFUND_REJECTED,
      expect.objectContaining({
        orderId: pendingRequest.orderId,
        reviewComment: '凭证不足',
      }),
    )
  })

  it('应在管理员批准后执行退款并同步订单状态', async () => {
    const orgId = new Types.ObjectId()
    const userId = new Types.ObjectId().toString()
    const order = createOrder({
      orgId,
      userId,
    })
    const pendingRequest = createRequest({
      paymentOrderId: order._id,
      orderId: order.orderId,
      orgId,
      userId,
      amount: 9900,
    })
    const approvedRequest = {
      ...pendingRequest,
      status: RefundRequestStatus.APPROVED,
      reviewedBy: 'admin-1',
      reviewedAt: new Date('2026-04-10T12:00:00.000Z'),
      reviewComment: '同意退款',
    }
    const refundedRequest = {
      ...approvedRequest,
      status: RefundRequestStatus.REFUNDED,
      executedBy: 'admin-1',
      executedAt: new Date('2026-04-10T12:05:00.000Z'),
      executionMode: RefundExecutionMode.MANUAL,
      executionResult: {
        provider: 'manual',
      },
    }

    refundRequestModel.findOne.mockReturnValue(createQuery(pendingRequest))
    orderModel.findOne.mockReturnValue(createQuery(order))
    refundRequestModel.findByIdAndUpdate
      .mockReturnValueOnce(createQuery(approvedRequest))
      .mockReturnValueOnce(createQuery({ modifiedCount: 1 }))
      .mockReturnValueOnce(createQuery(refundedRequest))
      .mockReturnValueOnce(createQuery({ modifiedCount: 1 }))
    videoPackModel.updateMany.mockReturnValue(createQuery({ modifiedCount: 1 }))
    orderModel.findByIdAndUpdate.mockReturnValue(createQuery({ modifiedCount: 1 }))

    const result = await service.review(
      { id: 'admin-1', orgId: orgId.toString(), role: UserRole.ENTERPRISE_ADMIN },
      pendingRequest.requestId,
      {
        action: 'approve',
        comment: '同意退款',
      },
    )

    expect(result.status).toBe(RefundRequestStatus.REFUNDED)
    expect(videoPackModel.updateMany).toHaveBeenCalledWith(
      { paymentOrderId: order.orderId },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: PackStatus.REFUNDED,
          remainingCredits: 0,
        }),
      }),
    )
    expect(orderModel.findByIdAndUpdate).toHaveBeenCalledWith(
      order._id,
      expect.objectContaining({
        $set: expect.objectContaining({
          status: PaymentStatus.REFUNDED,
          benefitGranted: false,
        }),
      }),
    )
    expect(notificationService.send).toHaveBeenCalledWith(
      userId,
      NotificationEvent.PAYMENT_REFUNDED,
      expect.objectContaining({
        orderId: order.orderId,
        amount: pendingRequest.amount,
      }),
    )
  })
})
