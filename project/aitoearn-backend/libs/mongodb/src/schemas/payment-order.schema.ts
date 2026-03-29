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

export enum PaymentChannel {
  WECHAT_NATIVE = 'wechat_native',
  WECHAT_JSAPI = 'wechat_jsapi',
  ALIPAY = 'alipay',
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'payment_orders' })
export class PaymentOrder extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: String, unique: true, index: true })
  orderNo: string

  @Prop({ required: true, type: String, index: true })
  userId: string

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  orgId: MongooseSchema.Types.ObjectId | null

  @Prop({ required: true, type: Number })
  amountCents: number

  @Prop({ type: String, enum: PaymentStatus, default: PaymentStatus.PENDING, index: true })
  status: PaymentStatus

  @Prop({ type: String, enum: PaymentChannel })
  channel: PaymentChannel

  @Prop({ type: String, default: '' })
  productName: string

  @Prop({ type: String, default: '' })
  productId: string

  @Prop({ type: String, default: '' })
  xorpayTradeNo: string

  @Prop({ type: String, default: '' })
  xorpayPayUrl: string

  @Prop({ type: Date, default: null })
  paidAt: Date | null

  @Prop({ type: Date, required: true })
  expiresAt: Date

  @Prop({ type: Object, default: {} })
  callbackData: Record<string, any>
}

export const PaymentOrderSchema = SchemaFactory.createForClass(PaymentOrder)
PaymentOrderSchema.index({ userId: 1, status: 1, createdAt: -1 })
