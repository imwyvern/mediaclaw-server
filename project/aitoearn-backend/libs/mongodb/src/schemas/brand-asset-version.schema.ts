import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Schema as MongooseSchema } from 'mongoose'
import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

export enum BrandAssetType {
  LOGO = 'logo',
  FONT = 'font',
  COLOR_PALETTE = 'color-palette',
  SLOGAN = 'slogan',
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'brand_asset_versions' })
export class BrandAssetVersion extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, index: true })
  brandId: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: String, enum: BrandAssetType, index: true })
  assetType: BrandAssetType

  @Prop({ required: true, type: Number })
  version: number

  @Prop({ required: true, type: String })
  fileUrl: string

  @Prop({ type: String, default: '' })
  fileName: string

  @Prop({ type: Number, default: 0 })
  fileSize: number

  @Prop({ type: String, default: '' })
  mimeType: string

  @Prop({ type: String, default: '' })
  uploadedBy: string

  @Prop({ type: Boolean, default: true, index: true })
  isActive: boolean

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  metadata: Record<string, any>

  @Prop({ type: Date, default: null })
  deletedAt: Date | null
}

export const BrandAssetVersionSchema = SchemaFactory.createForClass(BrandAssetVersion)
BrandAssetVersionSchema.index({ brandId: 1, assetType: 1, version: -1 }, { unique: true })
BrandAssetVersionSchema.index({ brandId: 1, assetType: 1, isActive: 1 })
