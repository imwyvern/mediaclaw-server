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

export enum OrgApiKeyProvider {
  KLING = 'kling',
  GEMINI = 'gemini',
  DEEPSEEK = 'deepseek',
  OPENAI = 'openai',
  TIKHUB = 'tikhub',
  VCE = 'vce',
}

export interface OrganizationApiKeyEntry {
  encryptedKey: string
  addedAt: Date
  lastUsedAt?: Date | null
  isValid?: boolean
  lastValidatedAt?: Date | null
}

export type OrganizationApiKeyMap = Partial<Record<OrgApiKeyProvider, OrganizationApiKeyEntry>>

@Schema({ _id: false })
class OrganizationVideoCredits {
  @Prop({ type: Number, default: 0 })
  quota: number

  @Prop({ type: Number, default: 0 })
  purchased: number

  @Prop({ type: Number, default: 0 })
  used: number

  @Prop({ type: Number, default: 0 })
  remaining: number

  @Prop({ type: Number, default: 0 })
  monthlyUsage: number

  @Prop({ type: Number, default: 0 })
  unitPrice: number

  @Prop({ type: Number, default: 0 })
  overagePrice: number
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

  @Prop({ type: String, default: '' })
  planId: string

  @Prop({ type: OrganizationVideoCredits, default: () => ({}) })
  videoCredits: OrganizationVideoCredits

  @Prop({ type: [String], default: [] })
  defaultPlatforms: string[]

  @Prop({ type: String, default: 'Asia/Shanghai' })
  timezone: string

  @Prop({ type: Object, default: {} })
  apiKeys: OrganizationApiKeyMap

  @Prop({ type: Object, default: {} })
  settings: Record<string, any>
}

export const OrganizationSchema = SchemaFactory.createForClass(Organization)
