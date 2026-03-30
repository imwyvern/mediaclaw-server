import {
  PackType,
  PaymentProductType,
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
}

const productCatalog = [
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
