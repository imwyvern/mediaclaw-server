import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Schema as MongooseSchema } from 'mongoose'
import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

export enum ViralContentRemixStatus {
  PENDING = 'pending',
  REMIXED = 'remixed',
  REJECTED = 'rejected',
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'viral_contents' })
export class ViralContent extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: String, index: true })
  platform: string

  @Prop({ required: true, type: String })
  videoId: string

  @Prop({ type: String, default: '' })
  title: string

  @Prop({ type: String, default: '' })
  author: string

  @Prop({ type: Number, default: 0, index: true })
  viralScore: number

  @Prop({ type: Number, default: 0 })
  views: number

  @Prop({ type: Number, default: 0 })
  likes: number

  @Prop({ type: Number, default: 0 })
  comments: number

  @Prop({ type: Number, default: 0 })
  shares: number

  @Prop({ type: String, default: '', index: true })
  industry: string

  @Prop({ type: [String], default: [] })
  keywords: string[]

  @Prop({ type: Date, default: Date.now, index: true })
  discoveredAt: Date

  @Prop({ type: String, default: '' })
  contentUrl: string

  @Prop({ type: String, default: '' })
  thumbnailUrl: string

  @Prop({
    type: String,
    enum: ViralContentRemixStatus,
    default: ViralContentRemixStatus.PENDING,
    index: true,
  })
  remixStatus: ViralContentRemixStatus

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null, index: true })
  remixTaskId: MongooseSchema.Types.ObjectId | null
}

export const ViralContentSchema = SchemaFactory.createForClass(ViralContent)
ViralContentSchema.index({ platform: 1, videoId: 1 }, { unique: true })
ViralContentSchema.index({ industry: 1, viralScore: -1, discoveredAt: -1 })
