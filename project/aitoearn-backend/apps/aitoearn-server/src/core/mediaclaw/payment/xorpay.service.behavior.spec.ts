import { createHash } from 'node:crypto'
import {
  BillingMode,
  InvoiceStatus,
  OrgStatus,
  PaymentMethod,
  PaymentProductType,
  PaymentStatus,
  SubscriptionPlan,
  SubscriptionStatus,
} from '@yikart/mongodb'
import { Types } from 'mongoose'
import { vi } from 'vitest'
import { XorPayService } from './xorpay.service'

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

function buildSignature(payload: Record<string, unknown>, secret: string) {
  const serialized = Object.entries(payload)
    .filter(([key, value]) => !['sign', 'signature'].includes(key) && value !== undefined && value !== null && value !== '')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('&')

  return createHash('md5').update(`${serialized}${secret}`).digest('hex')
}

function createOrder(overrides: Record<string, unknown> = {}) {
  const data = {
    _id: new Types.ObjectId(),
    orderId: 'MC-SUB-001',
    orgId: new Types.ObjectId(),
    userId: 'user-1',
    amount: 98000,
    currency: 'CNY',
    paymentMethod: PaymentMethod.WECHAT_NATIVE,
    status: PaymentStatus.PENDING,
    callbackData: {},
    payResult: null,
    metadata: {},
    productType: PaymentProductType.SUBSCRIPTION,
    productId: 'team_monthly',
    productName: 'Team 月度订阅',
    quantity: 1,
    payChannel: 'xorpay',
    xorpayOrderId: null,
    xorpayPayUrl: null,
    benefitGranted: false,
    benefitGrantedAt: null,
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

describe('xorPayService behavior', () => {
  let orderModel: Record<string, any>
  let videoPackModel: Record<string, any>
  let subscriptionModel: Record<string, any>
  let invoiceModel: Record<string, any>
  let organizationModel: Record<string, any>
  let distributionService: Record<string, any>
  let service: XorPayService

  beforeEach(() => {
    delete process.env['XORPAY_SECRET']

    orderModel = {
      findOne: vi.fn(),
      findByIdAndUpdate: vi.fn(),
    }
    videoPackModel = {
      findOne: vi.fn(),
      create: vi.fn(),
    }
    subscriptionModel = {
      findOne: vi.fn(),
      findByIdAndUpdate: vi.fn(),
      create: vi.fn(),
    }
    invoiceModel = {
      findById: vi.fn(),
      findByIdAndUpdate: vi.fn(),
    }
    organizationModel = {
      findById: vi.fn(),
      findByIdAndUpdate: vi.fn(),
    }
    distributionService = {
      notifyPaymentSuccess: vi.fn().mockResolvedValue(undefined),
    }

    service = new XorPayService(
      orderModel as any,
      videoPackModel as any,
      subscriptionModel as any,
      invoiceModel as any,
      organizationModel as any,
      distributionService as any,
    )
  })

  it('应在订阅回调成功后升级企业套餐并重置周期', async () => {
    process.env['XORPAY_SECRET'] = 'xor-secret'
    const orgId = new Types.ObjectId()
    const pendingOrder = createOrder({
      orgId,
      metadata: {
        subscriptionPlan: SubscriptionPlan.PRO,
        billingMode: BillingMode.POSTPAID,
        monthlyFeeCents: 298000,
        perVideoCents: 2000,
        monthlyQuota: 120,
      },
    })
    const paidAt = new Date('2026-04-01T00:00:00.000Z')
    const paidOrder = createOrder({
      orgId,
      status: PaymentStatus.PAID,
      paidAt,
      metadata: pendingOrder.metadata,
    })
    const grantedOrder = createOrder({
      orgId,
      status: PaymentStatus.PAID,
      paidAt,
      metadata: pendingOrder.metadata,
      benefitGranted: true,
      benefitGrantedAt: paidAt,
    })

    orderModel.findOne
      .mockReturnValueOnce(createQuery(pendingOrder))
      .mockReturnValueOnce(createQuery(pendingOrder.toObject()))
    orderModel.findByIdAndUpdate
      .mockReturnValueOnce(createQuery(paidOrder))
      .mockReturnValueOnce(createQuery(grantedOrder))
    subscriptionModel.findOne.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue({
          _id: new Types.ObjectId(),
          plan: SubscriptionPlan.TEAM,
          billingMode: BillingMode.QUOTA,
          monthlyFeeCents: 98000,
          perVideoCents: 2500,
          monthlyQuota: 50,
        }),
      }),
    })
    subscriptionModel.findByIdAndUpdate.mockReturnValue(createQuery({
      _id: new Types.ObjectId(),
      plan: SubscriptionPlan.PRO,
      billingMode: BillingMode.POSTPAID,
      status: SubscriptionStatus.ACTIVE,
    }))
    organizationModel.findById.mockReturnValue(createQuery({
      _id: orgId,
      billingMode: BillingMode.QUOTA,
      monthlyQuota: 50,
      status: OrgStatus.TRIAL,
      videoCredits: { remaining: 20 },
    }))
    organizationModel.findByIdAndUpdate.mockReturnValue(createQuery({
      _id: orgId,
      status: OrgStatus.ACTIVE,
    }))

    const callbackBody = {
      order_id: pendingOrder.orderId,
      amount: '980.00',
      status: 'success',
      pay_time: '1711929600',
    }

    const result = await service.handleCallback(
      callbackBody,
      buildSignature(callbackBody, 'xor-secret'),
    )

    expect(result.benefitGranted).toBe(true)
    expect(subscriptionModel.findByIdAndUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $set: expect.objectContaining({
          plan: SubscriptionPlan.PRO,
          billingMode: BillingMode.POSTPAID,
          monthlyFeeCents: 298000,
          perVideoCents: 2000,
          status: SubscriptionStatus.ACTIVE,
        }),
      }),
    )
    expect(organizationModel.findByIdAndUpdate).toHaveBeenCalledWith(
      orgId,
      expect.objectContaining({
        $set: expect.objectContaining({
          planId: SubscriptionPlan.PRO,
          billingMode: BillingMode.POSTPAID,
          status: OrgStatus.ACTIVE,
        }),
      }),
    )
  })

  it('应在账单支付回调成功后将发票标记为已支付', async () => {
    process.env['XORPAY_SECRET'] = 'xor-secret'
    const invoiceId = new Types.ObjectId()
    const orgId = new Types.ObjectId()
    const pendingOrder = createOrder({
      orderId: 'MC-INV-001',
      orgId,
      amount: 173000,
      productType: PaymentProductType.ADDON,
      productId: `invoice_${invoiceId.toString()}`,
      productName: '企业账单 INV-001',
      metadata: {
        invoiceId: invoiceId.toString(),
        invoiceNo: 'INV-001',
      },
    })
    const paidAt = new Date('2026-04-02T10:00:00.000Z')
    const paidOrder = createOrder({
      ...pendingOrder.toObject(),
      status: PaymentStatus.PAID,
      paidAt,
    })
    const grantedOrder = createOrder({
      ...pendingOrder.toObject(),
      status: PaymentStatus.PAID,
      paidAt,
      benefitGranted: true,
      benefitGrantedAt: paidAt,
    })

    orderModel.findOne
      .mockReturnValueOnce(createQuery(pendingOrder))
      .mockReturnValueOnce(createQuery(pendingOrder.toObject()))
    orderModel.findByIdAndUpdate
      .mockReturnValueOnce(createQuery(paidOrder))
      .mockReturnValueOnce(createQuery(grantedOrder))
    invoiceModel.findById.mockReturnValue(createQuery({
      _id: invoiceId,
      orgId,
      status: InvoiceStatus.ISSUED,
      subscriptionId: null,
    }))
    invoiceModel.findByIdAndUpdate.mockReturnValue(createQuery({
      _id: invoiceId,
      orgId,
      status: InvoiceStatus.PAID,
    }))
    organizationModel.findByIdAndUpdate.mockReturnValue(createQuery({
      _id: orgId,
      status: OrgStatus.ACTIVE,
    }))

    const callbackBody = {
      order_id: pendingOrder.orderId,
      amount: '1730.00',
      status: 'success',
      pay_time: '1712052000',
    }

    const result = await service.handleCallback(
      callbackBody,
      buildSignature(callbackBody, 'xor-secret'),
    )

    expect(result.benefitGranted).toBe(true)
    expect(invoiceModel.findByIdAndUpdate).toHaveBeenCalledWith(
      invoiceId,
      expect.objectContaining({
        $set: expect.objectContaining({
          status: InvoiceStatus.PAID,
          paidAt,
        }),
      }),
    )
    expect(organizationModel.findByIdAndUpdate).toHaveBeenCalledWith(
      orgId,
      expect.objectContaining({
        $set: expect.objectContaining({
          status: OrgStatus.ACTIVE,
        }),
      }),
    )
  })
})
