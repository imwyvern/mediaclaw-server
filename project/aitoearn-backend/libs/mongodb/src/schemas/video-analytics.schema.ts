import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Schema as MongooseSchema } from 'mongoose'

import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'video_analytics' })
export class VideoAnalytics extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, index: true })
  videoTaskId: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: String, index: true })
  platform: string

  @Prop({ required: true, type: Date, index: true })
  recordedAt: Date

  @Prop({ type: Number, default: 0 })
  views: number

  @Prop({ type: Number, default: 0 })
  likes: number

  @Prop({ type: Number, default: 0 })
  comments: number

  @Prop({ type: Number, default: 0 })
  shares: number

  @Prop({ type: Number, default: 0 })
  engagementRate: number

  @Prop({ type: String, default: '', index: true })
  platformPostId: string

  @Prop({ type: String, default: '' })
  platformPostUrl: string

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  metadata: Record<string, any>
}

export const VideoAnalyticsSchema = SchemaFactory.createForClass(VideoAnalytics)
VideoAnalyticsSchema.index({ videoTaskId: 1, recordedAt: -1 })
VideoAnalyticsSchema.index({ videoTaskId: 1, platform: 1, recordedAt: -1 })
VideoAnalyticsSchema.index({ recordedAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 })
