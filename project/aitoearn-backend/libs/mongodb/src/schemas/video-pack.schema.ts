import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Schema as MongooseSchema } from 'mongoose'

import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

export enum PackType {
  TRIAL_FREE = 'trial_free',
  SINGLE = 'single',
  PACK_10 = 'pack_10',
  PACK_30 = 'pack_30',
  PACK_100 = 'pack_100',
  ENTERPRISE_MONTHLY = 'enterprise_monthly',
}

export enum PackStatus {
  ACTIVE = 'active',
  DEPLETED = 'depleted',
  EXPIRED = 'expired',
  REFUNDED = 'refunded',
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'video_packs' })
export class VideoPack extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: String, index: true })
  userId: string

  @Prop({ type: MongooseSchema.Types.ObjectId, index: true, default: null })
  orgId: MongooseSchema.Types.ObjectId | null

  @Prop({ required: true, type: String, enum: PackType })
  packType: PackType

  @Prop({ required: true, type: Number })
  totalCredits: number

  @Prop({ required: true, type: Number })
  remainingCredits: number

  @Prop({ required: true, type: Number, default: 0 })
  priceCents: number

  @Prop({ type: String, enum: PackStatus, default: PackStatus.ACTIVE, index: true })
  status: PackStatus

  @Prop({ type: Date, required: true })
  purchasedAt: Date

  @Prop({ type: Date, default: null })
  expiresAt: Date | null

  @Prop({ type: String, default: '' })
  paymentOrderId: string
}

export const VideoPackSchema = SchemaFactory.createForClass(VideoPack)
VideoPackSchema.index({ userId: 1, status: 1, purchasedAt: 1 })
