import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

export enum EngagementTaskStatus {
  CREATED = 'CREATED',
  DISTRIBUTED = 'DISTRIBUTED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  PAUSED = 'PAUSED',
  CANCELED = 'CANCELED',
  FAILED = 'FAILED',
  PARTIALLY_COMPLETED = 'PARTIALLY_COMPLETED',
}
export enum EngagementTaskType {
  LIKE = 'LIKE',
  FAVORITE = 'FAVORITE',
  COMMENT = 'COMMENT', // comment on post
  REPLY = 'REPLY', // reply to comment
}

export enum EngagementTargetScope {
  ALL = 'ALL',
  PARTIAL = 'PARTIAL',
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'engagementTask' })
export class EngagementTask extends WithTimestampSchema {
  id: string
  @Prop({
    type: String,
    required: true,
  })
  accountId: string

  @Prop({
    type: String,
    required: true,
  })
  userId: string

  @Prop({
    type: String,
    required: true,
  })
  postId: string

  @Prop({
    type: String,
    required: true,
  })
  platform: string

  @Prop({
    type: String,
    required: true,
    default: '',
  })
  model: string

  @Prop({
    type: String,
    required: false,
    default: '',
  })
  prompt: string

  @Prop({
    type: String,
    required: true,
    enum: EngagementTaskType,
    default: EngagementTaskType.REPLY,
  })
  taskType: EngagementTaskType

  @Prop({
    type: String,
    required: true,
    enum: EngagementTargetScope,
    default: EngagementTargetScope.ALL,
  })
  targetScope: EngagementTargetScope

  @Prop({
    required: false,
    type: [String],
  })
  targetIds: string[]

  @Prop({
    type: String,
    required: true,
    enum: EngagementTaskStatus,
    default: EngagementTaskStatus.CREATED,
  })
  status: EngagementTaskStatus

  @Prop({
    type: Number,
    required: true,
    default: 0,
  })
  subTaskCount: number

  @Prop({
    type: Number,
    required: true,
    default: 0,
  })
  completedSubTaskCount: number

  @Prop({
    type: Number,
    required: true,
    default: 0,
  })
  failedSubTaskCount: number
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'engagementSubTask' })
export class EngagementSubTask extends WithTimestampSchema {
  id: string

  @Prop({
    required: true,
    index: true,
    type: String,
  })
  taskId: string

  @Prop({
    type: String,
    required: true,
  })
  accountId: string

  @Prop({
    type: String,
    required: true,
  })
  userId: string

  @Prop({
    type: String,
    required: true,
  })
  postId: string

  @Prop({
    type: String,
    required: true,
  })
  commentId: string

  @Prop({
    type: String,
    required: true,
    default: '',
  })
  commentContent: string

  @Prop({
    type: String,
    required: false,
    default: '',
  })
  replyContent: string

  @Prop({
    type: String,
    required: true,
  })
  platform: string

  @Prop({
    type: String,
    required: true,
    enum: EngagementTaskStatus,
    default: EngagementTaskStatus.CREATED,
  })
  status: EngagementTaskStatus
}
export const EngagementTaskSchema = SchemaFactory.createForClass(EngagementTask)
export const EngagementSubTaskSchema = SchemaFactory.createForClass(EngagementSubTask)
