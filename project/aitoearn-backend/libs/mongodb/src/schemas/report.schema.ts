import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Schema as MongooseSchema } from 'mongoose'

import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

export enum ReportType {
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
  CAMPAIGN = 'campaign',
  BRAND = 'brand',
}

export enum ReportStatus {
  GENERATING = 'generating',
  READY = 'ready',
  FAILED = 'failed',
}

@Schema({ _id: false })
class ReportPeriod {
  @Prop({ required: true, type: Date })
  start: Date

  @Prop({ required: true, type: Date })
  end: Date
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'reports' })
export class Report extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, index: true })
  orgId: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: String, enum: ReportType, index: true })
  type: ReportType

  @Prop({ type: ReportPeriod, required: true })
  period: ReportPeriod

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  metrics: Record<string, any>

  @Prop({ type: String, default: '' })
  fileUrl: string

  @Prop({ type: String, enum: ReportStatus, default: ReportStatus.GENERATING, index: true })
  status: ReportStatus

  @Prop({ type: Date, default: null })
  generatedAt: Date | null
}

export const ReportSchema = SchemaFactory.createForClass(Report)
ReportSchema.index({ orgId: 1, type: 1, generatedAt: -1 })
ReportSchema.index({ orgId: 1, status: 1, createdAt: -1 })
