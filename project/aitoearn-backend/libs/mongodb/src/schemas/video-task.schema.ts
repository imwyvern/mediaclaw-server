import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Schema as MongooseSchema } from 'mongoose'

import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

export enum VideoTaskStatus {
  PENDING = 'pending',
  ANALYZING = 'analyzing',
  EDITING = 'editing',
  RENDERING = 'rendering',
  QUALITY_CHECK = 'quality_check',
  GENERATING_COPY = 'generating_copy',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export enum VideoTaskType {
  BRAND_REPLACE = 'brand_replace',
  REMIX = 'remix',
  NEW_CONTENT = 'new_content',
}

@Schema({ _id: false })
class VideoQuality {
  @Prop({ type: Number, default: 0 })
  width: number

  @Prop({ type: Number, default: 0 })
  height: number

  @Prop({ type: Number, default: 0 })
  duration: number

  @Prop({ type: Number, default: 0 })
  fileSize: number

  @Prop({ type: Boolean, default: false })
  hasSubtitles: boolean
}

@Schema({ _id: false })
class CopyContent {
  @Prop({ type: String, default: '' })
  title: string

  @Prop({ type: String, default: '' })
  subtitle: string

  @Prop({ type: [String], default: [] })
  hashtags: string[]

  @Prop({ type: String, default: '' })
  commentGuide: string
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'video_tasks' })
export class VideoTask extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: String, index: true })
  userId: string

  @Prop({ type: MongooseSchema.Types.ObjectId, index: true, default: null })
  orgId: MongooseSchema.Types.ObjectId | null

  @Prop({ type: MongooseSchema.Types.ObjectId, index: true, default: null })
  brandId: MongooseSchema.Types.ObjectId | null

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  pipelineId: MongooseSchema.Types.ObjectId | null

  @Prop({ required: true, type: String, enum: VideoTaskType })
  taskType: VideoTaskType

  @Prop({ type: String, enum: VideoTaskStatus, default: VideoTaskStatus.PENDING, index: true })
  status: VideoTaskStatus

  @Prop({ type: String, default: '' })
  sourceVideoUrl: string

  @Prop({ type: String, default: '' })
  outputVideoUrl: string

  @Prop({ type: VideoQuality, default: () => ({}) })
  quality: VideoQuality

  @Prop({ type: CopyContent, default: () => ({}) })
  copy: CopyContent

  @Prop({ type: Number, default: 1 })
  creditsConsumed: number

  @Prop({ type: Boolean, default: false })
  creditCharged: boolean

  @Prop({ type: Number, default: 0 })
  retryCount: number

  @Prop({ type: Number, default: 3 })
  maxRetries: number

  @Prop({ type: String, default: '' })
  errorMessage: string

  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>

  @Prop({ type: Date, default: null })
  startedAt: Date | null

  @Prop({ type: Date, default: null })
  completedAt: Date | null
}

export const VideoTaskSchema = SchemaFactory.createForClass(VideoTask)
VideoTaskSchema.index({ orgId: 1, status: 1, createdAt: -1 })
VideoTaskSchema.index({ pipelineId: 1, status: 1 })
