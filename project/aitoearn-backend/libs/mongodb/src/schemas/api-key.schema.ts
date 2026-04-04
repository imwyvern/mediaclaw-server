import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Schema as MongooseSchema } from 'mongoose'
import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { USER_ROLE_STORAGE_VALUES, UserRole } from './mediaclaw-user.schema'
import { WithTimestampSchema } from './timestamp.schema'

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'apiKey' })
export class ApiKey extends WithTimestampSchema {
  id: string

  @Prop({ required: true, index: true })
  userId: string

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null, index: true })
  orgId: MongooseSchema.Types.ObjectId | null

  @Prop({ required: true })
  name: string

  @Prop({ required: true, unique: true, index: true })
  key: string

  @Prop({ default: '', index: true })
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

  @Prop({ default: '' })
  keyHash: string
}

export const ApiKeySchema = SchemaFactory.createForClass(ApiKey)
