import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import mongoose, { Schema as MongooseSchema } from 'mongoose'
import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

export enum DistributionRuleType {
  BY_EMPLOYEE = 'by-employee',
  BY_PLATFORM = 'by-platform',
  BY_DIMENSION = 'by-dimension',
}

@Schema({ _id: false })
class DistributionActionRule {
  @Prop({ type: mongoose.Schema.Types.Mixed, default: null })
  condition: Record<string, unknown> | null

  @Prop({ type: String, required: true, trim: true })
  action: string

  @Prop({ type: String, required: true, trim: true })
  target: string
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'distribution_rules' })
export class DistributionRule extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, index: true })
  orgId: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: String, trim: true })
  name: string

  @Prop({ required: true, type: String, enum: DistributionRuleType, index: true })
  type: DistributionRuleType

  @Prop({ type: [DistributionActionRule], default: [] })
  rules: DistributionActionRule[]

  @Prop({ type: Boolean, default: true, index: true })
  isActive: boolean

  @Prop({ type: Number, default: 0, index: true })
  priority: number
}

export const DistributionRuleSchema = SchemaFactory.createForClass(DistributionRule)

DistributionRuleSchema.index({ orgId: 1, isActive: 1, priority: -1 })
