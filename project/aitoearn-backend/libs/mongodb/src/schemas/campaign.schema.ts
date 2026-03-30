import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Schema as MongooseSchema } from 'mongoose'

import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

export enum CampaignStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  PAUSED = 'paused',
  COMPLETED = 'completed',
}

@Schema({ _id: false })
class CampaignSchedule {
  @Prop({ type: String, default: '0 9 * * 1-5' })
  cron: string

  @Prop({ type: Number, default: 1 })
  videosPerRun: number

  @Prop({ type: String, default: 'Asia/Shanghai' })
  timezone: string
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'campaigns' })
export class Campaign extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, index: true })
  orgId: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: String })
  name: string

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  brandId: MongooseSchema.Types.ObjectId | null

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  pipelineId: MongooseSchema.Types.ObjectId | null

  @Prop({ type: String, enum: CampaignStatus, default: CampaignStatus.DRAFT, index: true })
  status: CampaignStatus

  @Prop({ type: CampaignSchedule, default: () => ({}) })
  schedule: CampaignSchedule

  @Prop({ type: [String], default: [] })
  targetPlatforms: string[]

  @Prop({ type: Number, default: 0 })
  totalPlanned: number

  @Prop({ type: Number, default: 0 })
  totalProduced: number

  @Prop({ type: Number, default: 0 })
  totalPublished: number

  @Prop({ type: Date, default: null })
  startDate: Date | null

  @Prop({ type: Date, default: null })
  endDate: Date | null

  @Prop({ type: Object, default: {} })
  metadata: Record<string, any>
}

export const CampaignSchema = SchemaFactory.createForClass(Campaign)
CampaignSchema.index({ orgId: 1, status: 1, createdAt: -1 })
