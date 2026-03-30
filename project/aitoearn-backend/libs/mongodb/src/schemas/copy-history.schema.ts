import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Schema as MongooseSchema } from 'mongoose'
import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

@Schema({ _id: false })
class CopyHistoryPerformance {
  @Prop({ type: Number, default: 0 })
  views: number

  @Prop({ type: Number, default: 0 })
  clicks: number

  @Prop({ type: Number, default: 0 })
  ctr: number
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'copy_histories' })
export class CopyHistory extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, index: true })
  orgId: MongooseSchema.Types.ObjectId

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null, index: true })
  taskId: MongooseSchema.Types.ObjectId | null

  @Prop({ type: String, default: '' })
  title: string

  @Prop({ type: String, default: '' })
  subtitle: string

  @Prop({ type: [String], default: [] })
  hashtags: string[]

  @Prop({ type: [String], default: [] })
  blueWords: string[]

  @Prop({ type: String, default: '' })
  commentGuide: string

  @Prop({ type: CopyHistoryPerformance, default: () => ({}) })
  performance: CopyHistoryPerformance
}

export const CopyHistorySchema = SchemaFactory.createForClass(CopyHistory)
CopyHistorySchema.index({ orgId: 1, title: 'text' })
CopyHistorySchema.index({ orgId: 1, createdAt: -1 })
