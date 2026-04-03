import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Schema as MongooseSchema } from 'mongoose'

import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'
import { PipelineType } from './pipeline.schema'

export enum PipelineTemplateStatus {
  ACTIVE = 'active',
  DRAFT = 'draft',
  DEPRECATED = 'deprecated',
}

@Schema({ _id: false })
class PipelineTemplateStep {
  @Prop({ required: true, type: String })
  name: string

  @Prop({ type: Object, default: {} })
  config: Record<string, any>

  @Prop({ type: Number, default: 0 })
  order: number
}

@Schema({ _id: false })
class PipelineTemplateDefaultParams {
  @Prop({ type: Number, default: 15 })
  duration: number

  @Prop({ type: String, default: '9:16' })
  aspectRatio: string

  @Prop({ type: Object, default: {} })
  subtitleStyle: Record<string, any>

  @Prop({ type: String, default: '' })
  musicStyle: string

  @Prop({ type: Object, default: {} })
  extra: Record<string, any>
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'pipeline_templates' })
export class PipelineTemplate extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: String, trim: true })
  name: string

  @Prop({ type: String, trim: true, sparse: true, unique: true, index: true })
  templateId?: string

  @Prop({ type: String, default: '' })
  description?: string

  @Prop({ type: [String], default: [] })
  categories: string[]

  @Prop({ type: [String], default: [] })
  styles: string[]

  @Prop({ type: [Number], default: undefined })
  durationRange?: [number, number]

  @Prop({ type: Number, default: 0 })
  costPerVideo?: number

  @Prop({ type: Number, default: 0 })
  qualityStars?: number

  @Prop({ type: [String], default: [] })
  limitations: string[]

  @Prop({ type: [String], default: [] })
  verifiedClients: string[]

  @Prop({ required: true, type: String, enum: PipelineType, index: true })
  type: PipelineType

  @Prop({ type: [PipelineTemplateStep], default: [] })
  steps: PipelineTemplateStep[]

  @Prop({ type: PipelineTemplateDefaultParams, default: () => ({}) })
  defaultParams: PipelineTemplateDefaultParams

  @Prop({ type: Boolean, default: false, index: true })
  isPublic: boolean

  @Prop({ required: true, type: String, index: true })
  createdBy: string

  @Prop({
    type: String,
    enum: Object.values(PipelineTemplateStatus),
    default: PipelineTemplateStatus.ACTIVE,
    index: true,
  })
  status: PipelineTemplateStatus

  @Prop({ type: Number, default: 0 })
  usageCount: number
}

export const PipelineTemplateSchema = SchemaFactory.createForClass(PipelineTemplate)
PipelineTemplateSchema.index({ type: 1, isPublic: 1, usageCount: -1 })
PipelineTemplateSchema.index({ templateId: 1 }, { unique: true, sparse: true })
PipelineTemplateSchema.index({ status: 1, categories: 1, styles: 1 })
