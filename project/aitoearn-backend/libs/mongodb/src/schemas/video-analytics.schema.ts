import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Schema as MongooseSchema } from 'mongoose'

import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

export enum VideoAnalyticsDataSource {
  TIKHUB = 'tikhub',
  MEDIACRAWLER = 'mediacrawler',
  MANUAL = 'manual',
  OCR = 'ocr',
}

@Schema({ _id: false })
class VideoAnalyticsMetrics {
  @Prop({ type: Number, default: 0 })
  views: number

  @Prop({ type: Number, default: 0 })
  likes: number

  @Prop({ type: Number, default: 0 })
  comments: number

  @Prop({ type: Number, default: 0 })
  shares: number

  @Prop({ type: Number, default: 0 })
  saves: number

  @Prop({ type: Number, default: 0 })
  followers: number
}

@Schema({ _id: false })
class VideoAnalyticsDelta {
  @Prop({ type: Number, default: 0 })
  views: number

  @Prop({ type: Number, default: 0 })
  likes: number

  @Prop({ type: Number, default: 0 })
  comments: number

  @Prop({ type: Number, default: 0 })
  shares: number

  @Prop({ type: Number, default: 0 })
  saves: number
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'video_analytics' })
export class VideoAnalytics extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: MongooseSchema.Types.Mixed, index: true })
  videoTaskId: string | MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: MongooseSchema.Types.Mixed, index: true })
  orgId: string | MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: String, index: true, trim: true })
  platform: string

  @Prop({ type: String, default: '', index: true })
  publishPostId?: string

  @Prop({ required: true, type: Date, index: true })
  recordedAt: Date

  @Prop({ required: true, type: Number, default: 0 })
  daysSincePublish: number

  @Prop({ type: VideoAnalyticsMetrics, required: true, default: () => ({}) })
  metrics: VideoAnalyticsMetrics

  @Prop({ type: VideoAnalyticsDelta, default: null })
  deltaFromPrevious?: VideoAnalyticsDelta | null

  @Prop({
    type: String,
    enum: Object.values(VideoAnalyticsDataSource),
    default: VideoAnalyticsDataSource.TIKHUB,
    index: true,
  })
  dataSource: VideoAnalyticsDataSource

  @Prop({ type: Object, default: {} })
  raw?: Record<string, unknown>

  // Legacy compatibility fields for existing readers.
  @Prop({ type: Number, default: 0 })
  views: number

  @Prop({ type: Number, default: 0 })
  likes: number

  @Prop({ type: Number, default: 0 })
  comments: number

  @Prop({ type: Number, default: 0 })
  shares: number

  @Prop({ type: Number, default: 0 })
  saves: number

  @Prop({ type: Number, default: 0 })
  followers: number

  @Prop({ type: Number, default: 0 })
  engagementRate: number

  @Prop({ type: String, default: '', index: true })
  platformPostId: string

  @Prop({ type: String, default: '' })
  platformPostUrl: string

  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>
}

export const VideoAnalyticsSchema = SchemaFactory.createForClass(VideoAnalytics)
VideoAnalyticsSchema.index({ videoTaskId: 1, recordedAt: -1 })
VideoAnalyticsSchema.index({ videoTaskId: 1, platform: 1, recordedAt: -1 })
VideoAnalyticsSchema.index({ orgId: 1, platform: 1, recordedAt: -1 })
VideoAnalyticsSchema.index({ recordedAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 })
