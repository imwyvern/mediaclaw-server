import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { UserType } from '@yikart/common'
import { AiLogChannel, AiLogStatus, AiLogType } from '../enums'
import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'aiLogs' })
export class AiLog extends WithTimestampSchema {
  id: string

  @Prop({
    type: String,
    required: true,
    index: true,
  })
  userId: string

  @Prop({
    type: String,
    required: true,
    enum: UserType,
  })
  userType: UserType

  @Prop({
    type: String,
    required: false,
    index: true,
  })
  libraryId?: string

  @Prop({
    type: String,
    required: false,
    index: true,
  })
  taskId?: string

  @Prop({
    type: String,
    required: true,
    enum: AiLogType,
  })
  type: AiLogType

  @Prop({
    type: String,
    required: true,
  })
  model: string

  @Prop({
    type: String,
    required: true,
    enum: AiLogChannel,
  })
  channel: AiLogChannel

  @Prop({
    type: String,
    required: false,
  })
  action?: string

  @Prop({
    type: String,
    required: true,
    enum: AiLogStatus,
  })
  status: AiLogStatus

  @Prop({
    required: true,
    type: Date,
  })
  startedAt: Date

  @Prop({
    type: Number,
    required: false,
  })
  duration?: number

  @Prop({
    required: true,
    type: Object,
  })
  request: Record<string, any>

  @Prop({
    required: false,
    type: Object,
  })
  response?: Record<string, any>

  @Prop({
    required: false,
    type: String,
  })
  errorMessage?: string

  @Prop({
    type: Number,
    required: true,
  })
  points: number
}

export const AiLogSchema = SchemaFactory.createForClass(AiLog)
AiLogSchema.index({ type: 1, status: 1, channel: 1, createdAt: -1 })
AiLogSchema.index({ userId: 1, type: 1, userType: 1, createdAt: -1 })
AiLogSchema.index({ status: 1, createdAt: -1 })
