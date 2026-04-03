import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Schema as MongooseSchema } from 'mongoose'

import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'
import { VideoTaskStatus } from './video-task.schema'

export enum ProductionBatchStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  PROCESSING = 'running',
  PARTIAL = 'partial',
}

@Schema({ _id: false })
export class ProductionBatchTask {
  @Prop({ required: true, type: MongooseSchema.Types.Mixed })
  taskId: string | MongooseSchema.Types.ObjectId

  @Prop({ type: String, enum: VideoTaskStatus, default: VideoTaskStatus.PENDING })
  status: VideoTaskStatus

  @Prop({ type: String, default: '' })
  sourceVideoUrl: string

  @Prop({ type: String, default: '' })
  errorMessage: string
}

@Schema({ _id: false })
class ProductionBatchSummary {
  @Prop({ type: Number, default: 0 })
  avgCostPerVideo: number

  @Prop({ type: Number, default: 0 })
  totalCost: number

  @Prop({ type: Number, default: 0 })
  avgDurationSec: number

  @Prop({ type: Number, default: 0 })
  successRate: number

  @Prop({ type: Date, default: null })
  startedAt?: Date | null

  @Prop({ type: Date, default: null })
  completedAt?: Date | null

  @Prop({ type: Number, default: 0 })
  elapsedMs: number
}

@Schema({ _id: false })
class ProductionBatchResumeState {
  @Prop({ type: Number, default: -1 })
  lastProcessedIndex: number

  @Prop({ type: Date, default: null })
  resumedAt?: Date | null

  @Prop({ type: Number, default: 0 })
  resumeCount: number
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'production_batches' })
export class ProductionBatch extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: String, unique: true, index: true, trim: true })
  batchId: string

  @Prop({ required: true, type: MongooseSchema.Types.Mixed, index: true })
  orgId: string | MongooseSchema.Types.ObjectId

  @Prop({ type: MongooseSchema.Types.Mixed, default: null, index: true })
  pipelineId?: string | MongooseSchema.Types.ObjectId | null

  @Prop({ type: String, default: '' })
  templateId?: string

  @Prop({ required: true, type: Number, default: 0 })
  totalCount: number

  @Prop({ type: Number, default: 0 })
  completedCount: number

  @Prop({ type: Number, default: 0 })
  failedCount: number

  @Prop({ type: Number, default: 0 })
  skippedCount: number

  @Prop({
    type: String,
    enum: Object.values(ProductionBatchStatus),
    default: ProductionBatchStatus.PENDING,
    index: true,
  })
  status: ProductionBatchStatus

  @Prop({ type: [String], default: [] })
  videoTaskIds: string[]

  @Prop({ type: [String], default: [] })
  completedTaskIds: string[]

  @Prop({ type: [String], default: [] })
  failedTaskIds: string[]

  @Prop({ type: Object, default: {} })
  params: Record<string, unknown>

  @Prop({ type: ProductionBatchSummary, default: () => ({}) })
  summary?: ProductionBatchSummary

  @Prop({ type: ProductionBatchResumeState, default: () => ({}) })
  resumeState?: ProductionBatchResumeState

  @Prop({ type: Date, default: null })
  startedAt?: Date | null

  @Prop({ type: Date, default: null })
  completedAt?: Date | null

  @Prop({ type: Date, default: null })
  cancelledAt?: Date | null

  @Prop({ type: String, default: '' })
  errorMessage?: string

  // Legacy compatibility fields used by existing video/task management services.
  @Prop({ type: MongooseSchema.Types.ObjectId, default: null, index: true })
  brandId: MongooseSchema.Types.ObjectId | null

  @Prop({ type: String, default: '' })
  batchName: string

  @Prop({ type: String, default: '' })
  userId: string

  @Prop({ type: [ProductionBatchTask], default: [] })
  tasks: ProductionBatchTask[]

  @Prop({ type: Number, default: 0 })
  totalTasks: number

  @Prop({ type: Number, default: 0 })
  completedTasks: number

  @Prop({ type: Number, default: 0 })
  failedTasks: number

  @Prop({ type: String, default: '' })
  createdBy: string
}

export const ProductionBatchSchema = SchemaFactory.createForClass(ProductionBatch)

ProductionBatchSchema.index({ batchId: 1 }, { unique: true })
ProductionBatchSchema.index({ orgId: 1, status: 1, createdAt: -1 })
ProductionBatchSchema.index({ pipelineId: 1, createdAt: -1 })
ProductionBatchSchema.index({ brandId: 1, createdAt: -1 })
