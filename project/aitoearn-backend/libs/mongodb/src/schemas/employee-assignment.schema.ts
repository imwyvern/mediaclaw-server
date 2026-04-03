import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Schema as MongooseSchema } from 'mongoose'

import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

export enum EmployeeAssignmentStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  REMOVED = 'removed',
  PAUSED = 'inactive',
  DISABLED = 'removed',
}

@Schema({ _id: false })
class EmployeeImChannelBinding {
  @Prop({ type: String, default: '' })
  openId?: string

  @Prop({ type: String, default: '' })
  userId?: string

  @Prop({ type: String, default: '' })
  chatId?: string
}

@Schema({ _id: false })
class EmployeeImBinding {
  @Prop({ type: EmployeeImChannelBinding, default: undefined })
  feishu?: EmployeeImChannelBinding

  @Prop({ type: EmployeeImChannelBinding, default: undefined })
  wecom?: EmployeeImChannelBinding
}

@Schema({ _id: false })
class EmployeeDistributionRules {
  @Prop({ type: Number, default: 0 })
  maxDailyVideos?: number

  @Prop({ type: [String], default: [] })
  preferredPlatforms?: string[]

  @Prop({ type: [String], default: [] })
  preferredCategories?: string[]
}

@Schema({ _id: false })
class EmployeeAssignmentStats {
  @Prop({ type: Number, default: 0 })
  totalAssigned: number

  @Prop({ type: Number, default: 0 })
  totalPublished: number

  @Prop({ type: Number, default: 0 })
  totalPending: number

  @Prop({ type: Date, default: null })
  lastAssignedAt?: Date | null

  @Prop({ type: Date, default: null })
  lastPublishedAt?: Date | null
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'employee_assignments' })
export class EmployeeAssignment extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: String, index: true })
  orgId: string

  @Prop({ required: true, type: String, trim: true })
  employeeName: string

  @Prop({ required: true, type: String, trim: true })
  employeePhone: string

  @Prop({ type: String, default: '' })
  employeeUserId?: string

  @Prop({ type: [String], default: [] })
  platformAccountIds: string[]

  @Prop({ type: EmployeeImBinding, default: () => ({}) })
  imBinding: EmployeeImBinding

  @Prop({ type: String, default: '' })
  webhookUrl?: string

  @Prop({
    type: String,
    enum: Object.values(EmployeeAssignmentStatus),
    default: EmployeeAssignmentStatus.ACTIVE,
    index: true,
  })
  status: EmployeeAssignmentStatus

  @Prop({ type: EmployeeDistributionRules, default: () => ({}) })
  distributionRules: EmployeeDistributionRules

  @Prop({ type: EmployeeAssignmentStats, default: () => ({}) })
  stats: EmployeeAssignmentStats

  // Legacy compatibility fields kept to avoid breaking older modules during migration.
  @Prop({ type: String, default: '' })
  employeeId?: string

  @Prop({ type: String, default: '' })
  platformAccountId?: string

  @Prop({ type: [String], default: [] })
  platforms?: string[]

  @Prop({ type: Boolean, default: true, index: true })
  isActive?: boolean

  @Prop({ type: [String], default: [] })
  contentTags?: string[]

  @Prop({ type: Number, default: 0 })
  dailyQuota?: number

  @Prop({ type: Number, default: 0 })
  dailyAssignedCount?: number

  @Prop({ type: Number, default: 0 })
  totalConfirmedPublished?: number

  @Prop({ type: Boolean, default: true })
  requirePublishConfirmation?: boolean

  @Prop({ type: Date, default: Date.now })
  assignedAt?: Date

  @Prop({ type: Date, default: null })
  lastDispatchedAt?: Date | null

  @Prop({ type: Date, default: null })
  lastConfirmedAt?: Date | null

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  metadata?: Record<string, any>
}

export const EmployeeAssignmentSchema = SchemaFactory.createForClass(EmployeeAssignment)

EmployeeAssignmentSchema.index({ orgId: 1, status: 1, createdAt: -1 })
EmployeeAssignmentSchema.index({ orgId: 1, employeePhone: 1 }, { unique: true })
EmployeeAssignmentSchema.index({ orgId: 1, employeeUserId: 1 })
