import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Schema as MongooseSchema } from 'mongoose'

import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

export enum DeliveryChannel {
  FEISHU = 'feishu',
  WECOM = 'wecom',
  EMAIL = 'email',
  MANUAL = 'manual',
}

export enum DeliveryRecordStatus {
  PENDING = 'pending',
  DELIVERED = 'delivered',
  CONFIRMED = 'confirmed',
  PUBLISHED = 'published',
  FAILED = 'failed',
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'delivery_records' })
export class DeliveryRecord extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: String, index: true })
  orgId: string

  @Prop({ required: true, type: String, index: true })
  videoTaskId: string

  @Prop({ required: true, type: String, index: true })
  employeeAssignmentId: string

  @Prop({
    required: true,
    type: String,
    enum: Object.values(DeliveryChannel),
  })
  deliveryChannel: DeliveryChannel

  @Prop({
    type: String,
    enum: Object.values(DeliveryRecordStatus),
    default: DeliveryRecordStatus.PENDING,
    index: true,
  })
  status: DeliveryRecordStatus

  @Prop({ type: Date, default: null })
  deliveredAt?: Date | null

  @Prop({ type: Date, default: null })
  confirmedAt?: Date | null

  @Prop({ type: Date, default: null })
  publishedAt?: Date | null

  @Prop({ type: String, default: '' })
  publishUrl?: string

  @Prop({ type: String, default: '' })
  publishPlatform?: string

  @Prop({ type: String, default: '' })
  publishPostId?: string

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  deliveryPayload?: Record<string, unknown> | null

  @Prop({ type: String, default: '' })
  failReason?: string

  @Prop({ type: Number, default: 0 })
  retryCount: number
}

export const DeliveryRecordSchema = SchemaFactory.createForClass(DeliveryRecord)

DeliveryRecordSchema.index({ orgId: 1, status: 1, createdAt: -1 })
DeliveryRecordSchema.index({ videoTaskId: 1, employeeAssignmentId: 1, createdAt: -1 })
