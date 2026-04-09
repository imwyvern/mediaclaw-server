import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Schema as MongooseSchema } from 'mongoose'
import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { USER_ROLE_STORAGE_VALUES, UserRole } from './mediaclaw-user.schema'
import { WithTimestampSchema } from './timestamp.schema'

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'apiKey' })
export class ApiKey extends WithTimestampSchema {
  id: string

  @Prop({ type: String, required: true, index: true })
  userId: string

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null, index: true })
  orgId: MongooseSchema.Types.ObjectId | null

  @Prop({ type: String, required: true })
  name: string

  @Prop({ type: String, required: true, unique: true, index: true })
  key: string

  @Prop({ type: String, default: '', index: true })
  prefix: string

  @Prop({ type: [String], default: [] })
  permissions: string[]

  @Prop({ type: String, enum: USER_ROLE_STORAGE_VALUES, default: UserRole.EMPLOYEE })
  role: UserRole

  @Prop({ type: Date, required: false, default: null })
  lastUsedAt: Date | null

  @Prop({ type: Date, default: null })
  expiresAt: Date | null

  @Prop({ type: Boolean, default: true, index: true })
  isActive: boolean

  @Prop({ type: String, default: '' })
  keyHash: string
}

export const ApiKeySchema = SchemaFactory.createForClass(ApiKey)
