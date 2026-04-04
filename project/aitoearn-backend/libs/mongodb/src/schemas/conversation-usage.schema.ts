import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Schema as MongooseSchema } from 'mongoose'

import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

export enum ConversationIntent {
  CHAT = 'chat',
  ORDER = 'order',
  QUERY = 'query',
  REVIEW = 'review',
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'conversation_usages' })
export class ConversationUsage extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, index: true })
  orgId: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, index: true })
  userId: MongooseSchema.Types.ObjectId

  @Prop({ type: String, default: '', trim: true, index: true })
  sessionId: string

  @Prop({ type: String, required: true, trim: true, index: true })
  model: string

  @Prop({ type: Number, default: 0 })
  inputTokens: number

  @Prop({ type: Number, default: 0 })
  outputTokens: number

  @Prop({ type: Number, default: 0, index: true })
  totalTokens: number

  @Prop({ type: Number, default: 0 })
  estimatedCost: number

  @Prop({ type: String, enum: ConversationIntent, default: ConversationIntent.CHAT, index: true })
  intent: ConversationIntent
}

export const ConversationUsageSchema = SchemaFactory.createForClass(ConversationUsage)
ConversationUsageSchema.index({ orgId: 1, createdAt: -1 })
ConversationUsageSchema.index({ orgId: 1, model: 1, createdAt: -1 })
ConversationUsageSchema.index({ orgId: 1, sessionId: 1, createdAt: -1 })
