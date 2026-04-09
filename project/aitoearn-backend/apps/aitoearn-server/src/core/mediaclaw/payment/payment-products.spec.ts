import { BadRequestException } from '@nestjs/common'
import { BillingMode, SubscriptionPlan } from '@yikart/mongodb'
import { describe, expect, it } from 'vitest'
import { resolveSubscriptionProduct } from './payment-products'

describe('payment-products', () => {
  it('应在旗舰套餐缺少合同金额时返回 400', () => {
    expect(() => resolveSubscriptionProduct(SubscriptionPlan.FLAGSHIP)).toThrowError(
      new BadRequestException('Flagship plan requires monthlyFeeCents'),
    )
  })

  it('应在传入不支持的订阅计划时返回 400', () => {
    expect(() => resolveSubscriptionProduct('legacy' as SubscriptionPlan)).toThrowError(
      new BadRequestException('Unsupported subscription plan: legacy'),
    )
  })

  it('应保留可用套餐的计费模式覆盖', () => {
    const product = resolveSubscriptionProduct(SubscriptionPlan.PRO, {
      billingMode: BillingMode.POSTPAID,
    })

    expect(product.subscriptionPlan).toBe(SubscriptionPlan.PRO)
    expect(product.defaultBillingMode).toBe(BillingMode.POSTPAID)
  })
})
