import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Schema as MongooseSchema } from 'mongoose'

import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

export enum MarketplaceCurrency {
  CNY = 'CNY',
}

@Schema({ _id: false })
class MarketplaceTemplateReview {
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
class MarketplaceTemplatePurchase {
  @Prop({ required: true, type: MongooseSchema.Types.ObjectId })
  orgId: MongooseSchema.Types.ObjectId

  @Prop({ type: Date, default: Date.now })
  purchasedAt: Date
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'marketplace_templates' })
export class MarketplaceTemplate extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, ref: 'PipelineTemplate', index: true })
  pipelineTemplateId: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, index: true })
  authorOrgId: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: String, trim: true })
  title: string

  @Prop({ type: String, default: '' })
  description: string

  @Prop({ type: String, default: '' })
  thumbnailUrl: string

  @Prop({ type: [String], default: [] })
  tags: string[]

  @Prop({ type: Number, default: 0, min: 0 })
  price: number

  @Prop({ type: String, enum: MarketplaceCurrency, default: MarketplaceCurrency.CNY })
  currency: MarketplaceCurrency

  @Prop({ type: Number, default: 0 })
  downloads: number

  @Prop({ type: Number, default: 0 })
  rating: number

  @Prop({ type: Number, default: 0 })
  reviewCount: number

  @Prop({ type: Boolean, default: false, index: true })
  isApproved: boolean

  @Prop({ type: Boolean, default: false, index: true })
  isFeatured: boolean

  @Prop({ type: [MarketplaceTemplateReview], default: [] })
  reviews: MarketplaceTemplateReview[]

  @Prop({ type: [MarketplaceTemplatePurchase], default: [] })
  purchaseHistory: MarketplaceTemplatePurchase[]
}

export const MarketplaceTemplateSchema = SchemaFactory.createForClass(MarketplaceTemplate)
MarketplaceTemplateSchema.index({ isApproved: 1, isFeatured: 1, downloads: -1 })
MarketplaceTemplateSchema.index({ title: 1, tags: 1 })
