import { randomBytes } from 'node:crypto'
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Schema as MongooseSchema } from 'mongoose'

import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

export enum RefundRequestStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  PROCESSING = 'processing',
  REFUNDED = 'refunded',
  FAILED = 'failed',
}

export enum RefundExecutionMode {
  MANUAL = 'manual',
  GATEWAY = 'gateway',
}

function generateRefundRequestId() {
  return `RR${Date.now().toString(36).toUpperCase()}${randomBytes(3).toString('hex').toUpperCase()}`
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'refund_requests' })
export class RefundRequest extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: String, unique: true, index: true, default: generateRefundRequestId })
  requestId: string

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  paymentOrderId: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: String, index: true })
  orderId: string

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null, index: true })
  orgId: MongooseSchema.Types.ObjectId | null

  @Prop({ required: true, type: String, index: true })
  userId: string

  @Prop({ required: true, type: Number, min: 1 })
  amount: number

  @Prop({ type: String, default: 'CNY' })
  currency: string

  @Prop({ required: true, type: String, trim: true })
  reason: string

  @Prop({ type: String, default: '' })
  description: string

  @Prop({ type: String, enum: RefundRequestStatus, default: RefundRequestStatus.PENDING, index: true })
  status: RefundRequestStatus

  @Prop({ required: true, type: String })
  requestedBy: string

  @Prop({ type: Date, default: Date.now })
  requestedAt: Date

  @Prop({ type: String, default: null })
  reviewedBy: string | null

  @Prop({ type: Date, default: null })
  reviewedAt: Date | null

  @Prop({ type: String, default: '' })
  reviewComment: string

  @Prop({ type: String, default: null })
  executedBy: string | null

  @Prop({ type: Date, default: null })
  executedAt: Date | null

  @Prop({ type: String, enum: RefundExecutionMode, default: null })
  executionMode: RefundExecutionMode | null

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  executionResult: Record<string, unknown> | null

  @Prop({ type: String, default: '' })
  executionError: string

  @Prop({ type: Date, default: null })
  notifiedAt: Date | null

  @Prop({ type: String, default: '' })
  notificationEvent: string

  @Prop({ type: String, default: '' })
  notificationError: string

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  metadata: Record<string, unknown>
}

export const RefundRequestSchema = SchemaFactory.createForClass(RefundRequest)
RefundRequestSchema.index({ orderId: 1, status: 1, createdAt: -1 })
RefundRequestSchema.index({ orgId: 1, status: 1, createdAt: -1 })
RefundRequestSchema.index({ userId: 1, status: 1, createdAt: -1 })
