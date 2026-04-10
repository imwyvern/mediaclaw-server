import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Schema as MongooseSchema } from 'mongoose'

import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

export enum SlaScopeType {
  ORG = 'org',
  USER = 'user',
}

@Schema({ _id: false })
export class SlaBreachRecord {
  @Prop({ type: String, required: true })
  code: string

  @Prop({ type: String, required: true })
  description: string

  @Prop({ type: String, required: true })
  severity: string

  @Prop({ type: String, required: true })
  targetValue: string

  @Prop({ type: String, required: true })
  actualValue: string

  @Prop({ type: Number, default: 0 })
  compensationPercent: number
}

@Schema({ _id: false })
export class SlaSnapshotMetrics {
  @Prop({ type: Number, default: 0 })
  uptimeRatio: number

  @Prop({ type: Number, default: 0 })
  httpErrorRate: number

  @Prop({ type: Number, default: 0 })
  videoFailureRate: number

  @Prop({ type: Number, default: 0 })
  queueDepth: number

  @Prop({ type: Number, default: 0 })
  queueLatency: number
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'sla_reports' })
export class SlaReport extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId

  @Prop({ type: String, required: true, enum: SlaScopeType, index: true })
  scopeType: SlaScopeType

  @Prop({ type: String, required: true, index: true })
  scopeId: string

  @Prop({ type: String, required: true, index: true })
  plan: string

  @Prop({ type: String, required: true })
  tier: string

  @Prop({ type: Date, required: true })
  windowStart: Date

  @Prop({ type: Date, required: true })
  windowEnd: Date

  @Prop({ type: Number, default: 0 })
  monthlyFeeCents: number

  @Prop({ type: String, default: 'http_availability_proxy' })
  measurementMethod: string

  @Prop({ type: SlaSnapshotMetrics, default: () => ({}) })
  metrics: SlaSnapshotMetrics

  @Prop({ type: [SlaBreachRecord], default: [] })
  breaches: SlaBreachRecord[]

  @Prop({ type: Number, default: 0 })
  totalCompensationPercent: number

  @Prop({ type: Number, default: 0 })
  totalCompensationAmountCents: number
}

export const SlaReportSchema = SchemaFactory.createForClass(SlaReport)

SlaReportSchema.index({ scopeType: 1, scopeId: 1, createdAt: -1 })
SlaReportSchema.index({ plan: 1, createdAt: -1 })
