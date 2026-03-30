import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Schema as MongooseSchema } from 'mongoose'

import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'webhooks' })
export class Webhook extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, index: true })
  orgId: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: String })
  name: string

  @Prop({ required: true, type: String })
  url: string

  @Prop({ required: true, type: String })
  secret: string

  @Prop({ type: [String], default: [] })
  events: string[]

  @Prop({ type: Boolean, default: true, index: true })
  isActive: boolean

  @Prop({ type: Date, default: null })
  lastTriggeredAt: Date | null

  @Prop({ type: Number, default: 0 })
  failCount: number
}

export const WebhookSchema = SchemaFactory.createForClass(Webhook)
WebhookSchema.index({ orgId: 1, isActive: 1, createdAt: -1 })
WebhookSchema.index({ orgId: 1, events: 1 })
