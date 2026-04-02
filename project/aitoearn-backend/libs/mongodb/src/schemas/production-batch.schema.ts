import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Schema as MongooseSchema } from 'mongoose'

import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'
import { VideoTaskStatus } from './video-task.schema'

export enum ProductionBatchStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  PAUSED = 'paused',
  PARTIAL = 'partial',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

@Schema({ _id: false })
export class ProductionBatchTask {
  @Prop({ required: true, type: MongooseSchema.Types.ObjectId })
  taskId: MongooseSchema.Types.ObjectId

  @Prop({ type: String, enum: VideoTaskStatus, default: VideoTaskStatus.PENDING })
  status: VideoTaskStatus

  @Prop({ type: String, default: '' })
  sourceVideoUrl: string

  @Prop({ type: String, default: '' })
  errorMessage: string
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'production_batches' })
export class ProductionBatch extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, index: true })
  orgId: MongooseSchema.Types.ObjectId

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null, index: true })
  brandId: MongooseSchema.Types.ObjectId | null

  @Prop({ required: true, type: String, trim: true })
  batchName: string

  @Prop({ type: String, default: '' })
  userId: string

  @Prop({ type: String, enum: ProductionBatchStatus, default: ProductionBatchStatus.PENDING, index: true })
  status: ProductionBatchStatus

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

  @Prop({ type: Date, default: null })
  startedAt: Date | null

  @Prop({ type: Date, default: null })
  completedAt: Date | null

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  summary: Record<string, any>
}

export const ProductionBatchSchema = SchemaFactory.createForClass(ProductionBatch)
ProductionBatchSchema.index({ orgId: 1, createdAt: -1 })
ProductionBatchSchema.index({ orgId: 1, status: 1, createdAt: -1 })
ProductionBatchSchema.index({ brandId: 1, createdAt: -1 })
