import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Schema as MongooseSchema } from 'mongoose'

import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

export enum NotificationChannel {
  EMAIL = 'email',
  WEBHOOK = 'webhook',
  SMS = 'sms',
  WECHAT = 'wechat',
}

export enum NotificationEvent {
  TASK_COMPLETED = 'task.completed',
  TASK_FAILED = 'task.failed',
  CONTENT_PENDING_REVIEW = 'content.pending_review',
  CONTENT_APPROVED = 'content.approved',
  CONTENT_REJECTED = 'content.rejected',
  CONTENT_CHANGES_REQUESTED = 'content.changes_requested',
  CONTENT_PUBLISHED = 'content.published',
  SUBSCRIPTION_EXPIRING = 'subscription.expiring',
  CREDIT_LOW = 'credit.low',
  DISCOVERY_VIRAL_ALERT = 'discovery.viral_alert',
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'notification_configs' })
export class NotificationConfig extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, index: true })
  orgId: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: String, enum: NotificationChannel, index: true })
  channel: NotificationChannel

  @Prop({ type: [String], enum: NotificationEvent, default: [] })
  events: NotificationEvent[]

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  config: Record<string, any>

  @Prop({ type: Boolean, default: true, index: true })
  isActive: boolean
}

export const NotificationConfigSchema = SchemaFactory.createForClass(NotificationConfig)
NotificationConfigSchema.index({ orgId: 1, channel: 1, isActive: 1, createdAt: -1 })
NotificationConfigSchema.index({ orgId: 1, events: 1 })
