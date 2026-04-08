import {
  BillingMode,
  InvoiceStatus,
  PaymentMethod,
  PaymentProductType,
  SubscriptionPlan,
  SubscriptionStatus,
} from '@yikart/mongodb'
import { Types } from 'mongoose'
import { vi } from 'vitest'
import { BillingService } from './billing.service'

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

describe('billingService behavior', () => {
  let videoPackModel: Record<string, any>
  let paymentOrderModel: Record<string, any>
  let invoiceModel: Record<string, any>
  let subscriptionModel: Record<string, any>
  let organizationModel: Record<string, any>
  let usageService: Record<string, any>
  let xorPayService: Record<string, any>
  let service: BillingService

  beforeEach(() => {
    videoPackModel = {
      findOne: vi.fn(),
      findOneAndUpdate: vi.fn(),
      findByIdAndUpdate: vi.fn(),
    }
    paymentOrderModel = {}
    invoiceModel = {
      findOne: vi.fn(),
      create: vi.fn(),
      findByIdAndUpdate: vi.fn(),
    }
    subscriptionModel = {
      findOne: vi.fn(),
    }
    organizationModel = {
      findById: vi.fn(),
    }
    usageService = {
      getUsageSummary: vi.fn(),
    }
    xorPayService = {
      createOrder: vi.fn(),
      reconcilePaidOrders: vi.fn(),
    }

    service = new BillingService(
      videoPackModel as any,
      paymentOrderModel as any,
      invoiceModel as any,
      subscriptionModel as any,
      organizationModel as any,
      usageService as any,
      xorPayService as any,
    )
  })

  it('应根据订阅与用量生成企业月账单', async () => {
    const orgId = new Types.ObjectId()
    const subscriptionId = new Types.ObjectId()
    organizationModel.findById.mockReturnValue(createQuery({
      _id: orgId,
      monthlyQuota: 100,
      billingMode: BillingMode.QUOTA,
    }))
    subscriptionModel.findOne.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        lean: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue({
            _id: subscriptionId,
            plan: SubscriptionPlan.TEAM,
            status: SubscriptionStatus.ACTIVE,
            billingMode: BillingMode.QUOTA,
            monthlyFeeCents: 98000,
            perVideoCents: 2500,
            monthlyQuota: 100,
          }),
        }),
      }),
    })
    invoiceModel.findOne.mockReturnValue(createQuery(null))
    usageService.getUsageSummary.mockResolvedValue({
      totals: {
        creditsConsumed: 130,
      },
    })
    invoiceModel.create.mockResolvedValue({
      toObject: () => ({
        _id: new Types.ObjectId(),
        invoiceNo: 'INV-202603-001',
        status: InvoiceStatus.ISSUED,
        totalCents: 173000,
        periodStart: new Date('2026-03-01T00:00:00.000Z'),
        periodEnd: new Date('2026-03-31T23:59:59.999Z'),
        dueDate: new Date('2026-04-07T23:59:59.999Z'),
        paidAt: null,
        lineItems: [],
      }),
    })

    const result = await service.generateMonthlyInvoice(orgId.toString(), {
      period: '2026-03',
    })

    expect(usageService.getUsageSummary).toHaveBeenCalled()
    expect(invoiceModel.create).toHaveBeenCalledWith(expect.objectContaining({
      orgId,
      subscriptionId,
      status: InvoiceStatus.ISSUED,
      totalCents: 173000,
      lineItems: expect.arrayContaining([
        expect.objectContaining({
          description: `${SubscriptionPlan.TEAM} 平台月费`,
          amountCents: 98000,
        }),
        expect.objectContaining({
          description: '视频超额按条计费',
          quantity: 30,
          amountCents: 75000,
        }),
      ]),
    }))
    expect(result.usage).toMatchObject({
      totalUnits: 130,
      billableUnits: 30,
      platformFeeCents: 98000,
      videoChargesCents: 75000,
    })
  })

  it('应为订阅升级创建支付订单', async () => {
    const orgId = new Types.ObjectId()
    organizationModel.findById.mockReturnValue(createQuery({
      _id: orgId,
    }))
    xorPayService.createOrder.mockResolvedValue({
      orderId: 'MC-SUB-001',
      productType: PaymentProductType.SUBSCRIPTION,
    })

    const result = await service.createSubscriptionCheckout(
      'user-1',
      orgId.toString(),
      {
        plan: SubscriptionPlan.PRO,
        paymentMethod: PaymentMethod.ALIPAY,
        billingMode: BillingMode.POSTPAID,
      },
    )

    expect(xorPayService.createOrder).toHaveBeenCalledWith(expect.objectContaining({
      orgId: orgId.toString(),
      userId: 'user-1',
      productType: PaymentProductType.SUBSCRIPTION,
      subscriptionPlan: SubscriptionPlan.PRO,
      billingMode: BillingMode.POSTPAID,
      paymentMethod: PaymentMethod.ALIPAY,
    }))
    expect(result.orderId).toBe('MC-SUB-001')
  })

  it('应为企业发票生成支付链接并触发对账', async () => {
    const orgId = new Types.ObjectId()
    const invoiceId = new Types.ObjectId()
    invoiceModel.findOne.mockReturnValue(createQuery({
      _id: invoiceId,
      orgId,
      status: InvoiceStatus.ISSUED,
    }))
    xorPayService.createOrder.mockResolvedValue({
      orderId: 'MC-INV-001',
      productType: PaymentProductType.ADDON,
    })
    xorPayService.reconcilePaidOrders.mockResolvedValue({
      checked: 2,
      restored: 1,
      failed: 0,
      failures: [],
    })

    const payLink = await service.createInvoicePaymentLink(
      'user-1',
      orgId.toString(),
      invoiceId.toString(),
      {
        paymentMethod: PaymentMethod.WECHAT_NATIVE,
      },
    )
    const reconcile = await service.reconcileBilling(orgId.toString())

    expect(xorPayService.createOrder).toHaveBeenCalledWith(expect.objectContaining({
      orgId: orgId.toString(),
      userId: 'user-1',
      productType: PaymentProductType.ADDON,
      invoiceId: invoiceId.toString(),
      paymentMethod: PaymentMethod.WECHAT_NATIVE,
    }))
    expect(payLink.orderId).toBe('MC-INV-001')
    expect(reconcile).toMatchObject({
      checked: 2,
      restored: 1,
    })
  })
})
