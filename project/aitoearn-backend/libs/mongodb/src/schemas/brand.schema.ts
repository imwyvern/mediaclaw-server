import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Schema as MongooseSchema } from 'mongoose'

import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

@Schema({ _id: false })
class BrandAssets {
  @Prop({ type: String, default: '' })
  logoUrl: string

  @Prop({ type: [String], default: [] })
  colors: string[]

  @Prop({ type: [String], default: [] })
  fonts: string[]

  @Prop({ type: [String], default: [] })
  slogans: string[]

  @Prop({ type: [String], default: [] })
  keywords: string[]

  @Prop({ type: [String], default: [] })
  prohibitedWords: string[]

  @Prop({ type: [String], default: [] })
  referenceImages: string[]
}

@Schema({ _id: false })
class VideoStyle {
  @Prop({ type: Number, default: 15 })
  preferredDuration: number

  @Prop({ type: String, default: '9:16' })
  aspectRatio: string

  @Prop({ type: Object, default: {} })
  subtitleStyle: Record<string, any>

  @Prop({ type: String, default: '' })
  referenceVideoUrl: string
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'brands' })
export class Brand extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, index: true })
  orgId: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: String })
  name: string

  @Prop({ type: String, default: '' })
  industry: string

  @Prop({ type: BrandAssets, default: () => ({}) })
  assets: BrandAssets

  @Prop({ type: VideoStyle, default: () => ({}) })
  videoStyle: VideoStyle

  @Prop({ type: Boolean, default: true })
  isActive: boolean
}

export const BrandSchema = SchemaFactory.createForClass(Brand)
BrandSchema.index({ orgId: 1, name: 1 }, { unique: true })
