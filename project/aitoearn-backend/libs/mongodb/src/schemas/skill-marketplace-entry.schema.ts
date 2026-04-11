import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Schema as MongooseSchema } from 'mongoose'

import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import {
  LayerBillingPolicy,
  LayerPermissionPolicy,
  LayerQuotaPolicy,
} from './layer-policy.schema'
import { WithTimestampSchema } from './timestamp.schema'

export enum SkillMarketplaceEntryStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  ARCHIVED = 'archived',
}

export enum SkillMarketplaceVisibility {
  PRIVATE = 'private',
  ORGANIZATION = 'organization',
  PUBLIC = 'public',
}

@Schema({ _id: false })
class SkillMarketplaceCapabilityDeclaration {
  @Prop({ type: [String], default: [] })
  capabilities: string[]

  @Prop({ type: Object, default: {} })
  schema: Record<string, unknown>
}

@Schema({ _id: false })
class SkillMarketplaceCompatibility {
  @Prop({ type: [String], default: [] })
  runtimeKinds: string[]

  @Prop({ type: [String], default: [] })
  deploymentModes: string[]

  @Prop({ type: String, default: '' })
  minPlan: string
}

@Schema({ _id: false })
class SkillMarketplaceLayer {
  @Prop({ type: LayerQuotaPolicy, default: () => ({}) })
  quotaPolicy: LayerQuotaPolicy

  @Prop({ type: LayerBillingPolicy, default: () => ({}) })
  billingPolicy: LayerBillingPolicy

  @Prop({ type: LayerPermissionPolicy, default: () => ({}) })
  permissionPolicy: LayerPermissionPolicy
}

@Schema({ _id: false })
class SkillMarketplaceReview {
  @Prop({ required: true, type: MongooseSchema.Types.ObjectId })
  orgId: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: Number, min: 1, max: 5 })
  rating: number

  @Prop({ type: String, default: '' })
  review: string

  @Prop({ type: Date, default: Date.now })
  createdAt: Date

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date
}

@Schema({ _id: false })
class SkillMarketplaceInstall {
  @Prop({ required: true, type: MongooseSchema.Types.ObjectId })
  orgId: MongooseSchema.Types.ObjectId

  @Prop({ type: String, required: true })
  instanceId: string

  @Prop({ type: Date, default: Date.now })
  installedAt: Date

  @Prop({ type: Date, default: null })
  uninstalledAt: Date | null
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'skill_marketplace_entries' })
export class SkillMarketplaceEntry extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, index: true })
  ownerOrgId: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: String, trim: true, index: true })
  skillId: string

  @Prop({ required: true, type: String, trim: true, default: 'latest', index: true })
  version: string

  @Prop({ required: true, type: String, trim: true })
  name: string

  @Prop({ type: String, default: '' })
  summary: string

  @Prop({ type: String, default: '' })
  description: string

  @Prop({ type: String, default: 'general', index: true })
  category: string

  @Prop({ type: [String], default: [] })
  tags: string[]

  @Prop({ type: String, default: '' })
  iconUrl: string

  @Prop({
    type: String,
    enum: Object.values(SkillMarketplaceEntryStatus),
    default: SkillMarketplaceEntryStatus.DRAFT,
    index: true,
  })
  status: SkillMarketplaceEntryStatus

  @Prop({
    type: String,
    enum: Object.values(SkillMarketplaceVisibility),
    default: SkillMarketplaceVisibility.PUBLIC,
    index: true,
  })
  visibility: SkillMarketplaceVisibility

  @Prop({ type: SkillMarketplaceCapabilityDeclaration, default: () => ({}) })
  capabilityDeclaration: SkillMarketplaceCapabilityDeclaration

  @Prop({ type: SkillMarketplaceCompatibility, default: () => ({}) })
  compatibility: SkillMarketplaceCompatibility

  @Prop({ type: SkillMarketplaceLayer, default: () => ({}) })
  skillLayer: SkillMarketplaceLayer

  @Prop({ type: Number, default: 0 })
  installs: number

  @Prop({ type: Number, default: 0 })
  rating: number

  @Prop({ type: Number, default: 0 })
  reviewCount: number

  @Prop({ type: Boolean, default: false, index: true })
  isFeatured: boolean

  @Prop({ type: [SkillMarketplaceReview], default: [] })
  reviews: SkillMarketplaceReview[]

  @Prop({ type: [SkillMarketplaceInstall], default: [] })
  installHistory: SkillMarketplaceInstall[]
}

export const SkillMarketplaceEntrySchema = SchemaFactory.createForClass(SkillMarketplaceEntry)

SkillMarketplaceEntrySchema.index({ ownerOrgId: 1, skillId: 1, version: 1 }, { unique: true })
SkillMarketplaceEntrySchema.index({ status: 1, visibility: 1, category: 1, installs: -1 })
SkillMarketplaceEntrySchema.index({ skillId: 1, version: -1, updatedAt: -1 })
