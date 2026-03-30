import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Schema as MongooseSchema } from 'mongoose'

import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

export enum SubscriptionPlan {
  TEAM = 'team',
  PRO = 'pro',
  FLAGSHIP = 'flagship',
}

export enum SubscriptionStatus {
  ACTIVE = 'active',
  PAST_DUE = 'past_due',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
}

// BillingMode is exported from organization.schema.ts
import { BillingMode } from './organization.schema'
export { BillingMode as SubBillingMode } from './organization.schema'

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'subscriptions' })
export class Subscription extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, index: true })
  orgId: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: String, enum: SubscriptionPlan })
  plan: SubscriptionPlan

  @Prop({ type: String, enum: SubscriptionStatus, default: SubscriptionStatus.ACTIVE })
  status: SubscriptionStatus

  @Prop({ type: String, enum: BillingMode, default: BillingMode.QUOTA })
  billingMode: BillingMode

  @Prop({ required: true, type: Number })
  monthlyFeeCents: number

  @Prop({ required: true, type: Number })
  perVideoCents: number

  @Prop({ type: Number, default: 0 })
  monthlyQuota: number

  @Prop({ type: Number, default: 0 })
  monthlyUsed: number

  @Prop({ required: true, type: Date })
  currentPeriodStart: Date

  @Prop({ required: true, type: Date })
  currentPeriodEnd: Date

  @Prop({ type: Boolean, default: true })
  autoRenew: boolean

  @Prop({ type: String, default: '' })
  encryptedApiKey: string // BYOK: AES-256 encrypted client API key
}

export const SubscriptionSchema = SchemaFactory.createForClass(Subscription)
SubscriptionSchema.index({ orgId: 1, status: 1 })
