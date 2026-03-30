import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Schema as MongooseSchema } from 'mongoose'
import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

@Schema({ _id: false })
class CompetitorMetrics {
  @Prop({ type: Number, default: 0 })
  followers: number

  @Prop({ type: Number, default: 0 })
  avgViews: number

  @Prop({ type: Number, default: 0 })
  avgLikes: number

  @Prop({ type: Number, default: 0 })
  postFrequency: number
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'competitors' })
export class Competitor extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, index: true })
  orgId: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: String, index: true })
  platform: string

  @Prop({ type: String, default: '' })
  accountId: string

  @Prop({ type: String, default: '' })
  accountName: string

  @Prop({ required: true, type: String })
  accountUrl: string

  @Prop({ type: CompetitorMetrics, default: () => ({}) })
  metrics: CompetitorMetrics

  @Prop({ type: Date, default: Date.now })
  lastSyncedAt: Date

  @Prop({ type: Boolean, default: true, index: true })
  isActive: boolean
}

export const CompetitorSchema = SchemaFactory.createForClass(Competitor)
CompetitorSchema.index(
  { orgId: 1, platform: 1, accountUrl: 1 },
  { unique: true },
)
