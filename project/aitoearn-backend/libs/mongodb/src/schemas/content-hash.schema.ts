import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Schema as MongooseSchema } from 'mongoose'

import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'content_hashes' })
export class ContentHash extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, index: true })
  orgId: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: String, index: true })
  hash: string

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  videoTaskId: MongooseSchema.Types.ObjectId | null

  @Prop({ type: String, default: 'video_task' })
  contentType: string
}

export const ContentHashSchema = SchemaFactory.createForClass(ContentHash)
ContentHashSchema.index({ orgId: 1, hash: 1 }, { unique: true })
