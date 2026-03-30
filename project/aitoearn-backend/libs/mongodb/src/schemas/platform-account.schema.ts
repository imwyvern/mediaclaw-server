import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Schema as MongooseSchema } from 'mongoose'

import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

export enum PlatformAccountPlatform {
  DOUYIN = 'douyin',
  KUAISHOU = 'kuaishou',
  XIAOHONGSHU = 'xiaohongshu',
  BILIBILI = 'bilibili',
  WECHAT_VIDEO = 'wechat-video',
}

export enum PlatformAccountStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  SUSPENDED = 'suspended',
}

@Schema({ _id: false })
class PlatformAccountMetrics {
  @Prop({ type: Number, default: 0 })
  followers: number

  @Prop({ type: Number, default: 0 })
  totalViews: number

  @Prop({ type: Number, default: 0 })
  avgEngagement: number
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'platform_accounts' })
export class PlatformAccount extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, index: true })
  orgId: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: String, enum: PlatformAccountPlatform, index: true })
  platform: PlatformAccountPlatform

  @Prop({ required: true, type: String, trim: true })
  accountId: string

  @Prop({ required: true, type: String, trim: true })
  accountName: string

  @Prop({ type: String, default: '' })
  avatarUrl: string

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  credentials: Record<string, any>

  @Prop({ type: String, enum: PlatformAccountStatus, default: PlatformAccountStatus.ACTIVE, index: true })
  status: PlatformAccountStatus

  @Prop({ type: PlatformAccountMetrics, default: () => ({}) })
  metrics: PlatformAccountMetrics

  @Prop({ type: Date, default: null })
  lastSyncedAt: Date | null
}

export const PlatformAccountSchema = SchemaFactory.createForClass(PlatformAccount)
PlatformAccountSchema.index({ orgId: 1, platform: 1, accountId: 1 }, { unique: true })
PlatformAccountSchema.index({ orgId: 1, status: 1, createdAt: -1 })
