import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Schema as MongooseSchema } from 'mongoose'

import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { DeliveryChannel } from './delivery-record.schema'
import { WithTimestampSchema } from './timestamp.schema'

export enum ImSessionState {
  CREATED = 'created',
  REVIEWING = 'reviewing',
  VOTING = 'voting',
  CONFIRMED = 'confirmed',
  PUBLISHED = 'published',
  REJECTED = 'rejected',
  EXPIRED = 'expired',
}

export enum ImSessionRole {
  ADMIN = 'admin',
  EDITOR = 'editor',
  REVIEWER = 'reviewer',
  READONLY = 'readonly',
}

export enum ImSessionMessageType {
  CARD = 'card',
  APPROVAL = 'approval',
  REPORT = 'report',
  TEXT = 'text',
  SYSTEM = 'system',
}

export enum ImSessionVoteDecision {
  APPROVE = 'approve',
  REJECT = 'reject',
}

@Schema({ _id: false })
export class ImSessionParticipant {
  @Prop({ type: String, required: true })
  memberId: string

  @Prop({ type: String, default: '' })
  displayName?: string

  @Prop({
    type: String,
    enum: Object.values(ImSessionRole),
    default: ImSessionRole.READONLY,
  })
  role: ImSessionRole

  @Prop({ type: String, default: '' })
  channelUserId?: string

  @Prop({ type: Date, default: Date.now })
  joinedAt?: Date

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  metadata?: Record<string, unknown> | null
}

@Schema({ _id: false })
export class ImSessionMessage {
  @Prop({ type: String, required: true })
  messageId: string

  @Prop({ type: String, default: '' })
  authorId?: string

  @Prop({
    type: String,
    enum: Object.values(ImSessionRole),
    default: ImSessionRole.READONLY,
  })
  authorRole?: ImSessionRole

  @Prop({
    type: String,
    enum: Object.values(ImSessionMessageType),
    default: ImSessionMessageType.TEXT,
  })
  type: ImSessionMessageType

  @Prop({ type: String, default: '' })
  content: string

  @Prop({ type: Date, default: Date.now })
  createdAt?: Date

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  metadata?: Record<string, unknown> | null
}

@Schema({ _id: false })
export class ImSessionVote {
  @Prop({ type: String, required: true })
  memberId: string

  @Prop({
    type: String,
    enum: Object.values(ImSessionVoteDecision),
    required: true,
  })
  decision: ImSessionVoteDecision

  @Prop({ type: String, default: '' })
  reason?: string

  @Prop({ type: Date, default: Date.now })
  createdAt?: Date
}

@Schema({ _id: false })
export class ImSessionApproval {
  @Prop({ type: Number, default: 1 })
  requiredVotes: number

  @Prop({ type: [ImSessionVote], default: [] })
  votes: ImSessionVote[]

  @Prop({ type: String, default: 'pending' })
  status: 'pending' | 'approved' | 'rejected'

  @Prop({ type: Date, default: null })
  startedAt?: Date | null

  @Prop({ type: Date, default: null })
  expiresAt?: Date | null

  @Prop({ type: Date, default: null })
  decidedAt?: Date | null

  @Prop({ type: String, default: '' })
  initiatedBy?: string
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'im_sessions' })
export class ImSession extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId

  @Prop({ type: String, required: true, index: true })
  orgId: string

  @Prop({ type: String, required: true, index: true })
  videoTaskId: string

  @Prop({ type: String, required: true, index: true })
  deliveryRecordId: string

  @Prop({ type: String, default: '' })
  employeeAssignmentId?: string

  @Prop({
    type: String,
    enum: Object.values(DeliveryChannel),
    default: DeliveryChannel.MANUAL,
    index: true,
  })
  channel: DeliveryChannel

  @Prop({ type: String, default: '', index: true })
  conversationId?: string

  @Prop({
    type: String,
    enum: Object.values(ImSessionState),
    default: ImSessionState.CREATED,
    index: true,
  })
  state: ImSessionState

  @Prop({ type: [ImSessionParticipant], default: [] })
  participants: ImSessionParticipant[]

  @Prop({ type: [ImSessionMessage], default: [] })
  messages: ImSessionMessage[]

  @Prop({ type: ImSessionApproval, default: () => ({}) })
  approval: ImSessionApproval

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  deliverySnapshot?: Record<string, unknown> | null

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  collaboration?: Record<string, unknown> | null
}

export const ImSessionSchema = SchemaFactory.createForClass(ImSession)

ImSessionSchema.index({ orgId: 1, state: 1, updatedAt: -1 })
ImSessionSchema.index({ orgId: 1, videoTaskId: 1 }, { unique: true })
ImSessionSchema.index({ orgId: 1, deliveryRecordId: 1 })
