import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Schema as MongooseSchema } from 'mongoose'

import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'api_usage' })
export class ApiUsage extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, index: true })
  orgId: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: String, index: true })
  apiKey: string

  @Prop({ required: true, type: String, index: true })
  endpoint: string

  @Prop({ required: true, type: String, index: true })
  method: string

  @Prop({ type: Number, default: 1 })
  requestCount: number

  @Prop({ required: true, type: String, index: true })
  date: string

  @Prop({ type: Number, default: 0 })
  responseTimeMs: number
}

export const ApiUsageSchema = SchemaFactory.createForClass(ApiUsage)
ApiUsageSchema.index({ orgId: 1, apiKey: 1, endpoint: 1, method: 1, date: 1 }, { unique: true })
ApiUsageSchema.index({ orgId: 1, date: 1, endpoint: 1 })
