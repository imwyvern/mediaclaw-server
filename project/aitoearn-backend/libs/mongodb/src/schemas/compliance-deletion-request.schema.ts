import { randomBytes } from 'node:crypto'
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Schema as MongooseSchema } from 'mongoose'

import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

export enum ComplianceDeletionRequestStatus {
  PENDING = 'pending',
  REVIEWING = 'reviewing',
  APPROVED = 'approved',
  EXECUTED = 'executed',
  REJECTED = 'rejected',
}

function generateComplianceDeletionRequestId() {
  return `CDR${Date.now().toString(36).toUpperCase()}${randomBytes(3).toString('hex').toUpperCase()}`
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'compliance_deletion_requests' })
export class ComplianceDeletionRequest extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: String, unique: true, index: true, default: generateComplianceDeletionRequestId })
  requestId: string

  @Prop({ type: String, enum: ComplianceDeletionRequestStatus, default: ComplianceDeletionRequestStatus.PENDING, index: true })
  status: ComplianceDeletionRequestStatus

  @Prop({ type: String, default: '' })
  contentUrl: string

  @Prop({ type: String, default: '' })
  platformPostUrl: string

  @Prop({ required: true, type: String, trim: true })
  reason: string

  @Prop({ type: String, default: '' })
  description: string

  @Prop({ required: true, type: String, trim: true })
  requesterName: string

  @Prop({ type: String, default: '' })
  requesterEmail: string

  @Prop({ type: String, default: '' })
  requesterPhone: string

  @Prop({ type: [String], default: [] })
  evidenceUrls: string[]

  @Prop({ type: String, default: 'public_api' })
  source: string

  @Prop({ type: String, default: '' })
  publicTrackingTokenHash: string

  @Prop({ type: String, default: '' })
  publicTrackingTokenPreview: string

  @Prop({ type: [MongooseSchema.Types.ObjectId], default: [] })
  matchedVideoTaskIds: MongooseSchema.Types.ObjectId[]

  @Prop({ type: Date, default: Date.now })
  submittedAt: Date

  @Prop({ type: String, default: null })
  reviewedBy: string | null

  @Prop({ type: Date, default: null })
  reviewedAt: Date | null

  @Prop({ type: String, default: '' })
  reviewComment: string

  @Prop({ type: String, default: null })
  executedBy: string | null

  @Prop({ type: Date, default: null })
  executedAt: Date | null

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  executionResult: Record<string, unknown> | null

  @Prop({ type: String, default: '' })
  executionError: string

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  metadata: Record<string, unknown>
}

export const ComplianceDeletionRequestSchema = SchemaFactory.createForClass(ComplianceDeletionRequest)
ComplianceDeletionRequestSchema.index({ status: 1, createdAt: -1 })
ComplianceDeletionRequestSchema.index({ requesterEmail: 1, createdAt: -1 })
ComplianceDeletionRequestSchema.index({ contentUrl: 1, status: 1, createdAt: -1 })
ComplianceDeletionRequestSchema.index({ platformPostUrl: 1, status: 1, createdAt: -1 })
ComplianceDeletionRequestSchema.index({ requestId: 1, publicTrackingTokenHash: 1 })
