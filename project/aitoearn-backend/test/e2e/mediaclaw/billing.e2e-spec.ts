import { GUARDS_METADATA, INTERCEPTORS_METADATA } from '@nestjs/common/constants'
import {
  PaymentMethod,
  PaymentProductType,
  SubscriptionPlan,
} from '@yikart/mongodb'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { BillingController } from '../../../apps/aitoearn-server/src/core/mediaclaw/billing/billing.controller'
import { BillingService } from '../../../apps/aitoearn-server/src/core/mediaclaw/billing/billing.service'
import { XorPayController } from '../../../apps/aitoearn-server/src/core/mediaclaw/payment/xorpay.controller'
import { XorPayService } from '../../../apps/aitoearn-server/src/core/mediaclaw/payment/xorpay.service'
import {
  createMediaClawTestApp,
  testAccessToken,
  testUser,
} from './test-app.helper'

Reflect.defineMetadata('design:paramtypes', [BillingService], BillingController)
Reflect.defineMetadata('design:paramtypes', [XorPayService], XorPayController)
Reflect.defineMetadata(GUARDS_METADATA, [], BillingController)
Reflect.defineMetadata(INTERCEPTORS_METADATA, [], BillingController)
Reflect.defineMetadata(GUARDS_METADATA, [], XorPayController)
Reflect.defineMetadata(INTERCEPTORS_METADATA, [], XorPayController)
Reflect.defineMetadata(GUARDS_METADATA, [], XorPayController.prototype.createOrder)

describe('MediaClaw Billing E2E', () => {
  let app: Awaited<ReturnType<typeof createMediaClawTestApp>>['app']
  let client: Awaited<ReturnType<typeof createMediaClawTestApp>>['client']

  const billingService = {
    getUsageSummary: vi.fn(),
  }

  const xorPayService = {
    getProducts: vi.fn(),
    createOrder: vi.fn(),
  }

  beforeAll(async () => {
    const testApp = await createMediaClawTestApp({
      controllers: [BillingController, XorPayController],
      providers: [
        { provide: BillingService, useValue: billingService },
        { provide: XorPayService, useValue: xorPayService },
      ],
    })

    app = testApp.app
    client = testApp.client
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    billingService.getUsageSummary.mockResolvedValue({
      totalCredits: 1200,
      remainingCredits: 800,
    })
    xorPayService.getProducts.mockResolvedValue([
      {
        id: 'starter-plan',
        type: PaymentProductType.SUBSCRIPTION,
      },
    ])
    xorPayService.createOrder.mockResolvedValue({
      orderId: 'pay_123',
      payUrl: 'https://pay.example.com/pay_123',
    })
  })

  it('应完成查询用量、获取商品并创建支付订单', async () => {
    const usageResponse = await client
      .get('/api/v1/billing/usage-summary?start=2026-04-01&end=2026-04-09')
      .set('authorization', `Bearer ${testAccessToken}`)

    expect(usageResponse.status).toBe(200)
    expect(billingService.getUsageSummary).toHaveBeenCalledWith(
      testUser.id,
      testUser.orgId,
      '2026-04-01',
      '2026-04-09',
    )

    const productsResponse = await client
      .get('/api/v1/payment/products')

    expect(productsResponse.status).toBe(200)
    expect(productsResponse.body).toEqual([
      expect.objectContaining({
        id: 'starter-plan',
      }),
    ])

    const createPaymentResponse = await client
      .post('/api/v1/payment/create')
      .set('authorization', `Bearer ${testAccessToken}`)
      .send({
        paymentMethod: PaymentMethod.WECHAT_NATIVE,
        productType: PaymentProductType.SUBSCRIPTION,
        subscriptionPlan: SubscriptionPlan.PRO,
      })

    expect(createPaymentResponse.status).toBe(201)
    expect(xorPayService.createOrder).toHaveBeenCalledWith(expect.objectContaining({
      userId: testUser.id,
      orgId: testUser.orgId,
      paymentMethod: PaymentMethod.WECHAT_NATIVE,
      productType: PaymentProductType.SUBSCRIPTION,
      subscriptionPlan: SubscriptionPlan.PRO,
    }))
  })
})
