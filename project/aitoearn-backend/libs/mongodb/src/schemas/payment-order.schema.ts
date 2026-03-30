import { randomBytes } from 'node:crypto'
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Schema as MongooseSchema } from 'mongoose'

import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

export enum PaymentStatus {
  PENDING = 'pending',
  PAID = 'paid',
  FAILED = 'failed',
  REFUNDED = 'refunded',
  EXPIRED = 'expired',
}

export enum PaymentMethod {
  WECHAT_NATIVE = 'wechat_native',
  WECHAT_JSAPI = 'wechat_jsapi',
  ALIPAY = 'alipay',
}

export enum PaymentProductType {
  VIDEO_PACK = 'video_pack',
  SUBSCRIPTION = 'subscription',
  ADDON = 'addon',
}

function generatePaymentOrderId() {
  return `MC${Date.now().toString(36).toUpperCase()}${randomBytes(3).toString('hex').toUpperCase()}`
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'payment_orders' })
export class PaymentOrder extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: String, unique: true, index: true, default: generatePaymentOrderId })
  orderId: string

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null, index: true })
  orgId: MongooseSchema.Types.ObjectId | null

  @Prop({ required: true, type: String, index: true })
  userId: string

  @Prop({ required: true, type: Number })
  amount: number

  @Prop({ type: String, default: 'CNY' })
  currency: string

  @Prop({ required: true, type: String, enum: PaymentMethod })
  paymentMethod: PaymentMethod

  @Prop({ type: String, enum: PaymentStatus, default: PaymentStatus.PENDING, index: true })
  status: PaymentStatus

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  callbackData: Record<string, any>

  @Prop({ type: String, enum: PaymentProductType, required: true })
  productType: PaymentProductType

  @Prop({ type: String, required: true })
  productId: string

  @Prop({ type: Number, default: 1, min: 1 })
  quantity: number

  @Prop({ type: Date, default: null })
  paidAt: Date | null

  @Prop({
    type: Date,
    required: true,
    default: () => new Date(Date.now() + 30 * 60 * 1000),
  })
  expiredAt: Date
}

export const PaymentOrderSchema = SchemaFactory.createForClass(PaymentOrder)
PaymentOrderSchema.index({ orgId: 1, status: 1, createdAt: -1 })
PaymentOrderSchema.index({ userId: 1, status: 1, createdAt: -1 })
PaymentOrderSchema.index(
  { expiredAt: 1 },
  {
    expireAfterSeconds: 0,
    partialFilterExpression: {
      status: PaymentStatus.PENDING,
    },
  },
)
