import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Schema as MongooseSchema } from 'mongoose'

import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

export enum UsageHistoryType {
  VIDEO_CHARGE = 'video_charge',
  VIDEO_REFUND = 'video_refund',
  TOKEN_USAGE = 'token_usage',
  COPY_GENERATION = 'copy_generation',
  VIRAL_ANALYSIS = 'viral_analysis',
  REMIX_BRIEF = 'remix_brief',
}

@Schema({ _id: false })
export class TokenUsageSnapshot {
  @Prop({ type: Number, default: 0 })
  inputTokens: number

  @Prop({ type: Number, default: 0 })
  outputTokens: number

  @Prop({ type: Number, default: 0 })
  totalTokens: number

  @Prop({ type: String, default: '' })
  model: string

  @Prop({ type: String, default: '' })
  provider: string

  @Prop({ type: Number, default: 0 })
  cost: number

  @Prop({ type: Boolean, default: false })
  estimated: boolean
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'usage_histories' })
export class UsageHistory extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'MediaClawUser',
    required: true,
    index: true,
  })
  userId: MongooseSchema.Types.ObjectId

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Organization',
    default: null,
    index: true,
  })
  orgId: MongooseSchema.Types.ObjectId | null

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'VideoTask',
    default: null,
    index: true,
  })
  videoTaskId: MongooseSchema.Types.ObjectId | null

  @Prop({ type: String, enum: UsageHistoryType, required: true, index: true })
  type: UsageHistoryType

  @Prop({ type: Number, default: 0 })
  creditsConsumed: number

  @Prop({ type: TokenUsageSnapshot, default: () => ({}) })
  tokenUsage: TokenUsageSnapshot

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'VideoPack',
    default: null,
    index: true,
  })
  packId: MongooseSchema.Types.ObjectId | null

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  metadata: Record<string, any>
}

export const UsageHistorySchema = SchemaFactory.createForClass(UsageHistory)
UsageHistorySchema.index({ userId: 1, createdAt: -1 })
UsageHistorySchema.index({ orgId: 1, createdAt: -1 })
UsageHistorySchema.index({ videoTaskId: 1, createdAt: -1 })
UsageHistorySchema.index({ packId: 1, type: 1, createdAt: -1 })
