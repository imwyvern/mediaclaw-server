import { createHash } from 'node:crypto'
import { Types } from 'mongoose'
import { vi } from 'vitest'
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
    PaymentStatus: {
      PENDING: 'pending',
      PAID: 'paid',
      FAILED: 'failed',
      REFUNDED: 'refunded',
      EXPIRED: 'expired',
    },
    VideoPack,
  }
})

import {
  PackStatus,
  PaymentMethod,
  PaymentProductType,
  PaymentStatus,
} from '@yikart/mongodb'
import { XorPayService } from '../../apps/aitoearn-server/src/core/mediaclaw/payment/xorpay.service'
import { createChainQuery, createExecQuery } from '../support/query'

function createOrderDocument(overrides: Record<string, unknown> = {}) {
  const data = {
    _id: new Types.ObjectId(),
    orderId: 'MCORDER-S11',
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
    expiredAt: new Date('2026-03-30T09:00:00.000Z'),
    createdAt: new Date('2026-03-30T08:00:00.000Z'),
    updatedAt: new Date('2026-03-30T08:00:00.000Z'),
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

describe('MediaClaw Payment E2E', () => {
  afterEach(() => {
    delete process.env['XORPAY_SECRET']
  })

  it('应创建支付订单并返回支付地址', async () => {
    const orderModel = {
      create: vi.fn().mockResolvedValue(createOrderDocument()),
      findByIdAndUpdate: vi.fn().mockReturnValue(createExecQuery(createOrderDocument())),
    }
    const videoPackModel = {
      findOne: vi.fn(),
      create: vi.fn(),
    }
    const distributionService = {
      notifyPaymentSuccess: vi.fn(),
    }

    const service = new XorPayService(
      orderModel as any,
      videoPackModel as any,
      distributionService as any,
    )

    const result = await service.createOrder({
      userId: 'user-1',
      productId: 'pack_10',
      paymentMethod: PaymentMethod.WECHAT_NATIVE,
      quantity: 1,
    })

    expect(orderModel.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      status: PaymentStatus.PENDING,
      productType: PaymentProductType.VIDEO_PACK,
      amount: 19900,
    }))
    expect(result.callbackData).toMatchObject({
      gatewayMocked: true,
      payUrl: 'xorpay://mock/MCORDER-S11',
    })
  })

  it('应处理回调并发放视频包', async () => {
    process.env['XORPAY_SECRET'] = 'xorpay-secret'

    const pendingOrder = createOrderDocument()
    const paidOrder = createOrderDocument({
      status: PaymentStatus.PAID,
      paidAt: new Date('2026-03-30T08:05:00.000Z'),
    })

    const orderModel = {
      findOne: vi.fn()
        .mockReturnValueOnce(createExecQuery(pendingOrder))
        .mockReturnValueOnce(createExecQuery(pendingOrder.toObject())),
      findByIdAndUpdate: vi.fn().mockReturnValue(createExecQuery(paidOrder)),
    }
    const videoPackModel = {
      findOne: vi.fn().mockReturnValue(createChainQuery(null)),
      create: vi.fn().mockResolvedValue(undefined),
    }
    const distributionService = {
      notifyPaymentSuccess: vi.fn().mockResolvedValue(undefined),
    }

    const service = new XorPayService(
      orderModel as any,
      videoPackModel as any,
      distributionService as any,
    )

    const callbackBody = {
      order_id: pendingOrder.orderId,
      amount: '199.00',
      status: 'success',
    }
    const result = await service.handleCallback(
      callbackBody,
      buildSignature(callbackBody, 'xorpay-secret'),
    )

    expect(result.status).toBe(PaymentStatus.PAID)
    expect(videoPackModel.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: pendingOrder.userId,
      paymentOrderId: pendingOrder.orderId,
      totalCredits: 10,
      remainingCredits: 10,
      status: PackStatus.ACTIVE,
    }))
    expect(distributionService.notifyPaymentSuccess).toHaveBeenCalledWith(paidOrder)
  })

  it('应将超时订单标记为过期', async () => {
    const orderModel = {
      updateMany: vi.fn().mockReturnValue(createExecQuery({ modifiedCount: 3 })),
    }

    const service = new XorPayService(
      orderModel as any,
      {} as any,
      {} as any,
    )

    const result = await service.cancelExpiredOrders()
    expect(result).toBe(3)
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
