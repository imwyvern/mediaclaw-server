import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Schema as MongooseSchema } from 'mongoose'

import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

export enum OrgType {
  INDIVIDUAL = 'individual',
  TEAM = 'team',
  PROFESSIONAL = 'professional',
  ENTERPRISE = 'enterprise',
}

export enum BillingMode {
  QUOTA = 'quota',
  POSTPAID = 'postpaid',
  BYOK = 'byok',
}

export enum OrgStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  TRIAL = 'trial',
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'organizations' })
export class Organization extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: String, index: true })
  name: string

  @Prop({ type: String, enum: OrgType, default: OrgType.INDIVIDUAL, index: true })
  type: OrgType

  @Prop({ type: String, enum: BillingMode, default: BillingMode.QUOTA })
  billingMode: BillingMode

  @Prop({ type: String, enum: OrgStatus, default: OrgStatus.TRIAL })
  status: OrgStatus

  @Prop({ type: String, default: '' })
  contactName: string

  @Prop({ type: String, default: '' })
  contactPhone: string

  @Prop({ type: String, default: '' })
  contactEmail: string

  @Prop({ type: Number, default: 0 })
  monthlyQuota: number

  @Prop({ type: Number, default: 0 })
  monthlyUsed: number

  @Prop({ type: Date, default: null })
  subscriptionExpiresAt: Date | null

  @Prop({ type: Object, default: {} })
  settings: Record<string, any>
}

export const OrganizationSchema = SchemaFactory.createForClass(Organization)
