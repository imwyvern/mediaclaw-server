import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Schema as MongooseSchema } from 'mongoose'

import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'
import { PipelineType } from './pipeline.schema'

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
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'pipeline_templates' })
export class PipelineTemplate extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: String, trim: true })
  name: string

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

  @Prop({ type: Number, default: 0 })
  usageCount: number
}

export const PipelineTemplateSchema = SchemaFactory.createForClass(PipelineTemplate)
PipelineTemplateSchema.index({ type: 1, isPublic: 1, usageCount: -1 })
