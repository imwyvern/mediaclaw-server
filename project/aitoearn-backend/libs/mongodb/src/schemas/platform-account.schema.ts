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

@Schema({ _id: false })
class PlatformAccountHealthPostFrequency {
  @Prop({ type: Number, default: 0 })
  postsLast7Days: number

  @Prop({ type: Number, default: 0 })
  postsLast30Days: number

  @Prop({ type: Number, default: 0 })
  postsLast90Days: number

  @Prop({ type: Number, default: 0 })
  avgPostsPerWeek: number

  @Prop({ type: Number, default: 0 })
  avgGapDays: number
}

@Schema({ _id: false })
class PlatformAccountHealthEngagement {
  @Prop({ type: Number, default: 0 })
  current7Days: number

  @Prop({ type: Number, default: 0 })
  previous7Days: number

  @Prop({ type: Number, default: 0 })
  current30Days: number

  @Prop({ type: Number, default: 0 })
  deltaPct: number
}

@Schema({ _id: false })
class PlatformAccountHealthLowPlay {
  @Prop({ type: Number, default: 0 })
  ratio: number

  @Prop({ type: Number, default: 0 })
  lowPlayCount: number

  @Prop({ type: Number, default: 0 })
  totalSamples: number

  @Prop({ type: Number, default: 0 })
  thresholdViews: number
}

@Schema({ _id: false })
class PlatformAccountHealthAnomaly {
  @Prop({ type: String, default: '' })
  type: string

  @Prop({ type: String, default: '' })
  severity: string

  @Prop({ type: String, default: '' })
  message: string

  @Prop({ type: Number, default: 0 })
  currentValue: number

  @Prop({ type: Number, default: 0 })
  threshold: number

  @Prop({ type: Date, default: null })
  detectedAt: Date | null
}

@Schema({ _id: false })
class PlatformAccountHealthSnapshot {
  @Prop({ type: Number, default: 0 })
  healthScore: number

  @Prop({ type: String, default: 'unknown' })
  status: string

  @Prop({ type: PlatformAccountHealthPostFrequency, default: () => ({}) })
  postFrequency: PlatformAccountHealthPostFrequency

  @Prop({ type: PlatformAccountHealthEngagement, default: () => ({}) })
  engagementRate: PlatformAccountHealthEngagement

  @Prop({ type: PlatformAccountHealthLowPlay, default: () => ({}) })
  lowPlayRatio: PlatformAccountHealthLowPlay

  @Prop({ type: [PlatformAccountHealthAnomaly], default: [] })
  anomalies: PlatformAccountHealthAnomaly[]

  @Prop({ type: Date, default: null })
  lastCheckedAt: Date | null

  @Prop({ type: Date, default: null })
  lastAlertedAt: Date | null

  @Prop({ type: Date, default: null })
  lastPublishedAt: Date | null
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

  @Prop({ type: PlatformAccountHealthSnapshot, default: () => ({}) })
  healthSnapshot: PlatformAccountHealthSnapshot

  @Prop({ type: Date, default: null })
  lastSyncedAt: Date | null
}

export const PlatformAccountSchema = SchemaFactory.createForClass(PlatformAccount)
PlatformAccountSchema.index({ orgId: 1, platform: 1, accountId: 1 }, { unique: true })
PlatformAccountSchema.index({ orgId: 1, status: 1, createdAt: -1 })
