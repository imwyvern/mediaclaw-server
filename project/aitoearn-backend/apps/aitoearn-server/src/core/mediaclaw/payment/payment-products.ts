import { BadRequestException } from '@nestjs/common'
import {
  BillingMode,
  OrgType,
  PackType,
  PaymentProductType,
  SubscriptionPlan,
} from '@yikart/mongodb'

export interface PaymentProductDefinition {
  id: string
  name: string
  description: string
  productType: PaymentProductType
  unitAmount: number
  currency: 'CNY'
  unitCredits?: number
  packType?: PackType
  subscriptionPlan?: SubscriptionPlan
  monthlyFeeCents?: number
  perVideoCents?: number
  defaultBillingMode?: BillingMode
  recommendedOrgType?: OrgType
}

const productCatalog = [
  {
    id: 'team_monthly',
    name: 'Team 月度订阅',
    description: '企业 Team 套餐，支持月度升级或续费',
    productType: PaymentProductType.SUBSCRIPTION,
    unitAmount: 98000,
    currency: 'CNY',
    subscriptionPlan: SubscriptionPlan.TEAM,
    monthlyFeeCents: 98000,
    perVideoCents: 2500,
    defaultBillingMode: BillingMode.QUOTA,
    recommendedOrgType: OrgType.TEAM,
  },
  {
    id: 'pro_monthly',
    name: 'Pro 月度订阅',
    description: '企业 Pro 套餐，支持月度升级或续费',
    productType: PaymentProductType.SUBSCRIPTION,
    unitAmount: 298000,
    currency: 'CNY',
    subscriptionPlan: SubscriptionPlan.PRO,
    monthlyFeeCents: 298000,
    perVideoCents: 2000,
    defaultBillingMode: BillingMode.QUOTA,
    recommendedOrgType: OrgType.PROFESSIONAL,
  },
  {
    id: 'single',
    name: '单条视频',
    description: '适合单次创作或试用购买',
    productType: PaymentProductType.VIDEO_PACK,
    unitAmount: 2900,
    currency: 'CNY',
    unitCredits: 1,
    packType: PackType.SINGLE,
  },
  {
    id: 'pack_10',
    name: '10条套餐',
    description: '适合小批量视频生产',
    productType: PaymentProductType.VIDEO_PACK,
    unitAmount: 19900,
    currency: 'CNY',
    unitCredits: 10,
    packType: PackType.PACK_10,
  },
  {
    id: 'pack_30',
    name: '30条套餐',
    description: '适合团队日常分发',
    productType: PaymentProductType.VIDEO_PACK,
    unitAmount: 49900,
    currency: 'CNY',
    unitCredits: 30,
    packType: PackType.PACK_30,
  },
  {
    id: 'pack_100',
    name: '100条套餐',
    description: '适合规模化生产与投放',
    productType: PaymentProductType.VIDEO_PACK,
    unitAmount: 129900,
    currency: 'CNY',
    unitCredits: 100,
    packType: PackType.PACK_100,
  },
] satisfies PaymentProductDefinition[]

export const PAYMENT_PRODUCTS = Object.fromEntries(
  productCatalog.map(product => [product.id, product]),
) as Record<string, PaymentProductDefinition>

export function getPaymentProduct(productId: string) {
  return PAYMENT_PRODUCTS[productId]
}

export function listPaymentProducts() {
  return productCatalog.map(product => ({ ...product }))
}

export function resolveSubscriptionProduct(
  plan: SubscriptionPlan,
  input: {
    monthlyFeeCents?: number | null
    billingMode?: BillingMode | null
  } = {},
): PaymentProductDefinition {
  const product = productCatalog.find(item => item.subscriptionPlan === plan)
  if (product) {
    if (
      plan !== SubscriptionPlan.FLAGSHIP
      || !input.monthlyFeeCents
      || input.monthlyFeeCents <= 0
    ) {
      return {
        ...product,
        defaultBillingMode: input.billingMode || product.defaultBillingMode,
      }
    }
  }

  if (plan !== SubscriptionPlan.FLAGSHIP) {
    throw new BadRequestException(`Unsupported subscription plan: ${plan}`)
  }

  const monthlyFeeCents = Number(input.monthlyFeeCents || 0)
  if (!Number.isFinite(monthlyFeeCents) || monthlyFeeCents <= 0) {
    throw new BadRequestException('Flagship plan requires monthlyFeeCents')
  }

  return {
    id: 'flagship_monthly',
    name: 'Flagship 月度订阅',
    description: '企业旗舰套餐，按合同金额续费',
    productType: PaymentProductType.SUBSCRIPTION,
    unitAmount: Math.trunc(monthlyFeeCents),
    currency: 'CNY',
    subscriptionPlan: SubscriptionPlan.FLAGSHIP,
    monthlyFeeCents: Math.trunc(monthlyFeeCents),
    perVideoCents: 1500,
    defaultBillingMode: input.billingMode || BillingMode.QUOTA,
    recommendedOrgType: OrgType.ENTERPRISE,
  }
}

export function resolveSubscriptionOrgType(plan: SubscriptionPlan) {
  if (plan === SubscriptionPlan.TEAM) {
    return OrgType.TEAM
  }
  if (plan === SubscriptionPlan.PRO) {
    return OrgType.PROFESSIONAL
  }

  return OrgType.ENTERPRISE
}
