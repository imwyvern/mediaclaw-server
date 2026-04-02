import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Schema as MongooseSchema } from 'mongoose'

import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

export enum VideoTaskStatus {
  DRAFT = 'draft',
  PENDING = 'pending',
  ANALYZING = 'analyzing',
  EDITING = 'editing',
  RENDERING = 'rendering',
  QUALITY_CHECK = 'quality_check',
  GENERATING_COPY = 'generating_copy',
  COMPLETED = 'completed',
  PENDING_REVIEW = 'pending_review',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  PUBLISHED = 'published',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export enum VideoTaskType {
  BRAND_REPLACE = 'brand_replace',
  REMIX = 'remix',
  NEW_CONTENT = 'new_content',
}

export enum VideoTaskApprovalAction {
  SUBMITTED = 'submitted',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  CHANGES_REQUESTED = 'changes_requested',
  PUBLISHED = 'published',
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

  @Prop({ type: String, default: '' })
  description: string

  @Prop({ type: [String], default: [] })
  hashtags: string[]

  @Prop({ type: [String], default: [] })
  blueWords: string[]

  @Prop({ type: String, default: '' })
  commentGuide: string

  @Prop({ type: [String], default: [] })
  commentGuides: string[]
}

@Schema({ _id: false })
class VideoTaskSource {
  @Prop({ type: String, default: 'url' })
  type: string

  @Prop({ type: String, default: '' })
  url: string

  @Prop({ type: String, default: '' })
  videoId: string

  @Prop({ type: String, default: '' })
  materialId: string

  @Prop({ type: Number, default: 0 })
  duration: number

  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>
}

@Schema({ _id: false })
class VideoTaskOutput {
  @Prop({ type: String, default: '' })
  url: string

  @Prop({ type: Number, default: 0 })
  duration: number

  @Prop({ type: String, default: '' })
  resolution: string

  @Prop({ type: Number, default: 0 })
  fileSize: number

  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>
}

@Schema({ _id: false })
class VideoTaskDedup {
  @Prop({ type: String, default: '' })
  hash: string

  @Prop({ type: String, default: '' })
  status: string

  @Prop({ type: Number, default: 0 })
  score: number

  @Prop({ type: [String], default: [] })
  matchedTaskIds: string[]

  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>
}

@Schema({ _id: false })
class VideoTaskErrorLogEntry {
  @Prop({ type: String, default: '' })
  step: string

  @Prop({ type: String, default: '' })
  code: string

  @Prop({ type: String, default: '' })
  message: string

  @Prop({ type: Object, default: {} })
  detail: Record<string, any>

  @Prop({ type: Date, default: Date.now })
  recordedAt: Date
}

@Schema({ _id: false })
class VideoTaskPromptFix {
  @Prop({ type: String, default: '' })
  originalPrompt: string

  @Prop({ type: String, default: '' })
  optimizedPrompt: string

  @Prop({ type: String, default: '' })
  failureReason: string

  @Prop({ type: Date, default: null })
  retriedAt: Date | null

  @Prop({ type: String, default: '' })
  result: string

  @Prop({ type: Object, default: {} })
  analysis: Record<string, any>
}

@Schema({ _id: false })
class VideoTaskIterationTimestamps {
  @Prop({ type: Date, default: null })
  startedAt: Date | null

  @Prop({ type: Date, default: null })
  completedAt: Date | null
}

@Schema({ _id: false })
class VideoTaskIterationLogEntry {
  @Prop({ type: String, default: '' })
  step: string

  @Prop({ type: String, default: '' })
  status: string

  @Prop({ type: Object, default: {} })
  input: Record<string, any>

  @Prop({ type: Object, default: {} })
  output: Record<string, any>

  @Prop({ type: String, default: '' })
  error: string

  @Prop({ type: Number, default: 0 })
  duration: number

  @Prop({ type: Number, default: 1 })
  attempt: number

  @Prop({ type: VideoTaskIterationTimestamps, default: () => ({}) })
  timestamps: VideoTaskIterationTimestamps
}

@Schema({ _id: false })
class VideoTaskAnalyticsSnapshot {
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
}

@Schema({ _id: false })
class ApprovalHistoryEntry {
  @Prop({ type: Number, default: 1 })
  level: number

  @Prop({ type: String, default: '' })
  reviewerId: string

  @Prop({ type: String, default: '' })
  reviewerName: string

  @Prop({ type: String, default: '' })
  reviewerRole: string

  @Prop({ type: String, enum: VideoTaskApprovalAction, default: VideoTaskApprovalAction.SUBMITTED })
  action: VideoTaskApprovalAction

  @Prop({ type: String, default: '' })
  comment: string

  @Prop({ type: Date, default: Date.now })
  at: Date
}

@Schema({ _id: false })
class ApprovalState {
  @Prop({ type: Number, default: 0 })
  currentLevel: number

  @Prop({ type: Number, default: 0 })
  maxLevel: number

  @Prop({ type: [String], default: [] })
  pendingRoles: string[]

  @Prop({ type: String, enum: VideoTaskApprovalAction, default: VideoTaskApprovalAction.SUBMITTED })
  lastAction: VideoTaskApprovalAction

  @Prop({ type: String, default: '' })
  lastComment: string

  @Prop({ type: Date, default: null })
  submittedAt: Date | null

  @Prop({ type: Date, default: null })
  reviewedAt: Date | null

  @Prop({ type: [ApprovalHistoryEntry], default: [] })
  history: ApprovalHistoryEntry[]
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

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null, index: true })
  batchId: MongooseSchema.Types.ObjectId | null

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null, index: true })
  campaignId: MongooseSchema.Types.ObjectId | null

  @Prop({ required: true, type: String, enum: VideoTaskType })
  taskType: VideoTaskType

  @Prop({ type: String, enum: VideoTaskStatus, default: VideoTaskStatus.PENDING, index: true })
  status: VideoTaskStatus

  @Prop({ type: String, default: '' })
  sourceVideoUrl: string

  @Prop({ type: VideoTaskSource, default: () => ({}) })
  source: VideoTaskSource

  @Prop({ type: String, default: '' })
  outputVideoUrl: string

  @Prop({ type: VideoTaskOutput, default: () => ({}) })
  output: VideoTaskOutput

  @Prop({ type: VideoQuality, default: () => ({}) })
  quality: VideoQuality

  @Prop({ type: CopyContent, default: () => ({}) })
  copy: CopyContent

  @Prop({ type: VideoTaskDedup, default: () => ({}) })
  dedup: VideoTaskDedup

  @Prop({ type: ApprovalState, default: null })
  approval: ApprovalState | null

  @Prop({ type: Number, default: 1 })
  creditsConsumed: number

  @Prop({ type: Number, default: 1 })
  quotaUnits: number

  @Prop({ type: Boolean, default: false })
  creditCharged: boolean

  @Prop({ type: Number, default: 0 })
  retryCount: number

  @Prop({ type: Number, default: 3 })
  maxRetries: number

  @Prop({ type: String, default: '' })
  errorMessage: string

  @Prop({ type: [VideoTaskErrorLogEntry], default: [] })
  errorLog: VideoTaskErrorLogEntry[]

  @Prop({ type: [VideoTaskPromptFix], default: [] })
  promptFixes: VideoTaskPromptFix[]

  @Prop({ type: [VideoTaskIterationLogEntry], default: [] })
  iterationLog: VideoTaskIterationLogEntry[]

  @Prop({ type: VideoTaskAnalyticsSnapshot, default: () => ({}) })
  analyticsSnapshot: VideoTaskAnalyticsSnapshot

  @Prop({ type: String, default: '' })
  platformPostId: string

  @Prop({ type: String, default: '' })
  platformPostUrl: string

  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>

  @Prop({ type: Date, default: null })
  startedAt: Date | null

  @Prop({ type: Date, default: null })
  completedAt: Date | null

  @Prop({ type: Date, default: null })
  publishedAt: Date | null
}

export const VideoTaskSchema = SchemaFactory.createForClass(VideoTask)
VideoTaskSchema.index({ orgId: 1, status: 1, createdAt: -1 })
VideoTaskSchema.index({ pipelineId: 1, status: 1 })
VideoTaskSchema.index({ batchId: 1, status: 1, createdAt: -1 })
VideoTaskSchema.index({ campaignId: 1, status: 1, createdAt: -1 })
