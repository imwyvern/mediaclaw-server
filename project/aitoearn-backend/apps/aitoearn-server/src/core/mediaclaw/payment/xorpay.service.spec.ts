import { createHash } from 'node:crypto'
import {
  PackStatus,
  PaymentMethod,
  PaymentProductType,
  PaymentStatus,
} from '@yikart/mongodb'
import { Types } from 'mongoose'
import { vi } from 'vitest'
import { XorPayService } from './xorpay.service'

const { axiosPost } = vi.hoisted(() => ({
  axiosPost: vi.fn(),
}))

vi.mock('@yikart/mongodb', () => {
  class PaymentOrder {}
  class VideoPack {}

  return {
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
      TRIAL_FREE: 'trial_free',
      ENTERPRISE_MONTHLY: 'enterprise_monthly',
    },
    PaymentMethod: {
      WECHAT_NATIVE: 'wechat_native',
      WECHAT_JSAPI: 'wechat_jsapi',
      ALIPAY: 'alipay',
    },
    PaymentProductType: {
      VIDEO_PACK: 'video_pack',
      SUBSCRIPTION: 'subscription',
      ADDON: 'addon',
    },
    PaymentStatus: {
      PENDING: 'pending',
      PAID: 'paid',
      FAILED: 'failed',
      REFUNDED: 'refunded',
      EXPIRED: 'expired',
    },
    PaymentOrder,
    VideoPack,
  }
})

vi.mock('axios', () => ({
  default: {
    post: axiosPost,
  },
}))

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

function createOrderDocument(overrides: Record<string, unknown> = {}) {
  const data = {
    _id: new Types.ObjectId(),
    orderId: 'MCORDER001',
    orgId: new Types.ObjectId(),
    userId: 'user-1',
    amount: 19900,
    currency: 'CNY',
    paymentMethod: PaymentMethod.WECHAT_NATIVE,
    status: PaymentStatus.PENDING,
    callbackData: {},
    productType: PaymentProductType.VIDEO_PACK,
    productId: 'pack_10',
    quantity: 1,
    paidAt: null,
    expiredAt: new Date(Date.now() + 30 * 60 * 1000),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }

  return {
    ...data,
    toObject: () => ({ ...data }),
  }
}

function buildSignature(payload: Record<string, unknown>, secret: string) {
  const serialized = Object.entries(payload)
    .filter(([key, value]) => !['sign', 'signature'].includes(key) && value !== undefined && value !== null && value !== '')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('&')

  return createHash('md5').update(`${serialized}${secret}`).digest('hex')
}

describe('xorPayService', () => {
  let service: XorPayService
  let orderModel: Record<string, any>
  let videoPackModel: Record<string, any>
  let distributionService: Record<string, any>

  beforeEach(() => {
    axiosPost.mockReset()
    delete process.env['XORPAY_API_URL']
    delete process.env['XORPAY_CREATE_ORDER_URL']
    delete process.env['XORPAY_SECRET']
    delete process.env['XORPAY_MD5_KEY']

    orderModel = {
      create: vi.fn(),
      findByIdAndUpdate: vi.fn(),
      findOne: vi.fn(),
      updateMany: vi.fn(),
    }

    videoPackModel = {
      create: vi.fn(),
      findOne: vi.fn(),
    }

    distributionService = {
      notifyPaymentSuccess: vi.fn().mockResolvedValue(undefined),
    }

    service = new XorPayService(
      orderModel as any,
      videoPackModel as any,
      distributionService as any,
    )
  })

  it('应创建支付订单并返回 mock 网关信息', async () => {
    const order = createOrderDocument()
    orderModel.create.mockResolvedValue(order)
    orderModel.findByIdAndUpdate.mockReturnValue(createQuery(order))

    const result = await service.createOrder({
      userId: 'user-1',
      productId: 'pack_10',
      paymentMethod: PaymentMethod.WECHAT_NATIVE,
      quantity: 2,
    })

    expect(orderModel.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      amount: 39800,
      currency: 'CNY',
      paymentMethod: PaymentMethod.WECHAT_NATIVE,
      productId: 'pack_10',
      productType: PaymentProductType.VIDEO_PACK,
      quantity: 2,
      status: PaymentStatus.PENDING,
    }))
    expect(axiosPost).not.toHaveBeenCalled()
    expect(result.orderId).toBe('MCORDER001')
    expect(result.callbackData).toMatchObject({
      gatewayMocked: true,
      tradeNo: 'MCORDER001',
      payUrl: 'xorpay://mock/MCORDER001',
    })
  })

  it('应校验合法回调签名并发放视频包', async () => {
    process.env['XORPAY_SECRET'] = 'xor-secret'

    const pendingOrder = createOrderDocument()
    const paidAt = new Date('2026-03-29T10:00:00.000Z')
    const paidOrder = createOrderDocument({
      status: PaymentStatus.PAID,
      paidAt,
      callbackData: { source: 'callback' },
    })

    orderModel.findOne
      .mockReturnValueOnce(createQuery(pendingOrder))
      .mockReturnValueOnce(createQuery({ ...pendingOrder }))
    orderModel.findByIdAndUpdate.mockReturnValue(createQuery(paidOrder))
    videoPackModel.findOne.mockReturnValue(createQuery(null))
    videoPackModel.create.mockResolvedValue(undefined)

    const callbackBody = {
      order_id: pendingOrder.orderId,
      amount: '199.00',
      status: 'success',
    }

    const result = await service.handleCallback(
      callbackBody,
      buildSignature(callbackBody, 'xor-secret'),
    )

    expect(result.status).toBe(PaymentStatus.PAID)
    expect(videoPackModel.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: pendingOrder.userId,
      paymentOrderId: pendingOrder.orderId,
      totalCredits: 10,
      remainingCredits: 10,
      priceCents: pendingOrder.amount,
      status: PackStatus.ACTIVE,
      purchasedAt: paidAt,
    }))
    expect(distributionService.notifyPaymentSuccess).toHaveBeenCalledWith(paidOrder)
  })

  it('应拒绝非法回调签名', async () => {
    await expect(service.handleCallback({
      order_id: 'MCORDER001',
      amount: '199.00',
      status: 'success',
    }, 'invalid-signature')).rejects.toThrow('Invalid callback signature')
  })

  it('应校验回调金额一致性', async () => {
    const order = createOrderDocument()
    orderModel.findOne
      .mockReturnValueOnce(createQuery({ ...order }))
      .mockReturnValueOnce(createQuery({ ...order }))

    await expect(service.checkAmountConsistency(order.orderId, '199.00')).resolves.toBe(true)
    await expect(service.checkAmountConsistency(order.orderId, '188.00')).resolves.toBe(false)
  })

  it('应标记已过期订单', async () => {
    orderModel.updateMany.mockReturnValue(createQuery({ modifiedCount: 2 }))

    await expect(service.cancelExpiredOrders()).resolves.toBe(2)
    expect(orderModel.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        status: PaymentStatus.PENDING,
        expiredAt: expect.objectContaining({
          $lte: expect.any(Date),
        }),
      }),
      {
        $set: {
          status: PaymentStatus.EXPIRED,
        },
      },
    )
  })
})
