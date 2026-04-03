import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Schema as MongooseSchema } from 'mongoose'

import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

export const COPY_EMOTIONAL_TONES = [
  'neutral',
  'exciting',
  'curious',
  'urgent',
] as const

export type CopyEmotionalTone = (typeof COPY_EMOTIONAL_TONES)[number]

@Schema({ _id: false })
class CopyPerformanceMetrics {
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
  ctr: number
}

@Schema({ _id: false })
class CopyFeatureSnapshot {
  @Prop({ type: Number, default: 0 })
  titleLength: number

  @Prop({ type: Boolean, default: false })
  hasBlueWords: boolean

  @Prop({ type: Number, default: 0 })
  blueWordCount: number

  @Prop({ type: Boolean, default: false })
  hasCommentGuide: boolean

  @Prop({ type: Number, default: 0 })
  hashtagCount: number

  @Prop({ type: String, enum: COPY_EMOTIONAL_TONES, default: 'neutral' })
  emotionalTone: CopyEmotionalTone
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'copy_performance' })
export class CopyPerformance extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: String, index: true })
  copyHistoryId: string

  @Prop({ required: true, type: String, index: true })
  videoTaskId: string

  @Prop({ required: true, type: String, index: true })
  orgId: string

  @Prop({ required: true, type: String, index: true })
  platform: string

  @Prop({ type: CopyPerformanceMetrics, default: () => ({}) })
  metrics: CopyPerformanceMetrics

  @Prop({ type: CopyFeatureSnapshot, default: () => ({}) })
  copyFeatures: CopyFeatureSnapshot

  @Prop({ type: Number, default: 0, index: true })
  performanceScore: number

  @Prop({ type: Date, default: Date.now, index: true })
  recordedAt: Date
}

export const CopyPerformanceSchema = SchemaFactory.createForClass(CopyPerformance)

CopyPerformanceSchema.index({ orgId: 1, platform: 1, recordedAt: -1 })
CopyPerformanceSchema.index({ orgId: 1, performanceScore: -1, recordedAt: -1 })
CopyPerformanceSchema.index({ copyHistoryId: 1, videoTaskId: 1 }, { unique: true })
