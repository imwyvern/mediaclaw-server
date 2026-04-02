import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Schema as MongooseSchema } from 'mongoose'

import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'audit_logs' })
export class AuditLog extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, index: true })
  orgId: MongooseSchema.Types.ObjectId

  @Prop({ type: String, default: '' })
  userId: string

  @Prop({ type: String, default: '' })
  userName: string

  @Prop({ required: true, type: String, index: true })
  action: string

  @Prop({ required: true, type: String, index: true })
  resource: string

  @Prop({ type: String, default: '' })
  target: string

  @Prop({ type: String, default: '' })
  resourceId: string

  @Prop({ type: Object, default: {} })
  details: Record<string, any>

  @Prop({ type: Object, default: {} })
  meta: Record<string, any>

  @Prop({ type: String, default: '' })
  ip: string

  @Prop({ type: String, default: '' })
  ipAddress: string

  @Prop({ type: String, default: '' })
  userAgent: string
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog)
AuditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 })
AuditLogSchema.index({ orgId: 1, createdAt: -1 })
AuditLogSchema.index({ orgId: 1, action: 1, resource: 1, createdAt: -1 })
