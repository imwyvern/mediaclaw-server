import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Schema as MongooseSchema } from 'mongoose'

import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'
import { USER_ROLE_STORAGE_VALUES, UserRole } from './mediaclaw-user.schema'

export enum EnterpriseInviteStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  EXPIRED = 'expired',
  REVOKED = 'revoked',
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'enterprise_invites' })
export class EnterpriseInvite extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, index: true })
  orgId: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: String, index: true })
  phone: string

  @Prop({ required: true, type: String, enum: USER_ROLE_STORAGE_VALUES })
  role: UserRole

  @Prop({ required: true, type: String, unique: true, index: true })
  tokenHash: string

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  invitedByUserId: MongooseSchema.Types.ObjectId | null

  @Prop({ type: Date, default: Date.now })
  invitedAt: Date

  @Prop({ required: true, type: Date, index: true })
  expiresAt: Date

  @Prop({
    type: String,
    enum: Object.values(EnterpriseInviteStatus),
    default: EnterpriseInviteStatus.PENDING,
    index: true,
  })
  status: EnterpriseInviteStatus

  @Prop({ type: Date, default: null })
  acceptedAt: Date | null
}

export const EnterpriseInviteSchema = SchemaFactory.createForClass(EnterpriseInvite)

EnterpriseInviteSchema.index({ orgId: 1, phone: 1, status: 1, createdAt: -1 })
EnterpriseInviteSchema.index({ status: 1, expiresAt: 1 })
