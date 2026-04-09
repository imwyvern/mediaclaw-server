import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { UserType } from '@yikart/common'
import { AiLogStatus } from '../enums'
import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'qrCodeArtImages' })
export class QrCodeArtImage extends WithTimestampSchema {
  id: string

  @Prop({ type: String, required: true, index: true })
  userId: string

  @Prop({ type: String, required: true, enum: UserType })
  userType: UserType

  @Prop({ type: String, required: true, index: true })
  relId: string

  @Prop({ type: String, required: true })
  relType: string

  @Prop({ type: String, required: true, index: true })
  logId: string

  @Prop({ type: String, required: true })
  content: string

  @Prop({ type: String, required: false })
  referenceImageUrl?: string

  @Prop({ type: String, required: true })
  prompt: string

  @Prop({ type: String, required: true })
  model: string

  @Prop({ type: String, required: false })
  size?: string

  @Prop({ type: String, required: true, enum: AiLogStatus, default: AiLogStatus.Generating })
  status: AiLogStatus

  @Prop({ type: String, required: false })
  imageUrl?: string
}

export const QrCodeArtImageSchema = SchemaFactory.createForClass(QrCodeArtImage)

QrCodeArtImageSchema.index({ userId: 1, relId: 1, relType: 1 })
QrCodeArtImageSchema.index({ relId: 1, relType: 1, createdAt: -1 })
