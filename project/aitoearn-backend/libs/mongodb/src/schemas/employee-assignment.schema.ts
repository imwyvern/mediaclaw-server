import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Schema as MongooseSchema } from 'mongoose'

import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

export enum EmployeeAssignmentStatus {
  ACTIVE = 'active',
  PAUSED = 'paused',
  DISABLED = 'disabled',
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'employee_assignments' })
export class EmployeeAssignment extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, index: true })
  orgId: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, index: true })
  employeeId: MongooseSchema.Types.ObjectId

  @Prop({ type: String, default: '' })
  employeeName: string

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, index: true })
  platformAccountId: MongooseSchema.Types.ObjectId

  @Prop({ type: [String], default: [] })
  platforms: string[]

  @Prop({ type: Boolean, default: true, index: true })
  isActive: boolean

  @Prop({ type: [String], default: [] })
  contentTags: string[]

  @Prop({ type: Number, default: 0 })
  dailyQuota: number

  @Prop({ type: Number, default: 0 })
  dailyAssignedCount: number

  @Prop({ type: Number, default: 0 })
  totalConfirmedPublished: number

  @Prop({ type: Boolean, default: true })
  requirePublishConfirmation: boolean

  @Prop({ type: String, enum: EmployeeAssignmentStatus, default: EmployeeAssignmentStatus.ACTIVE, index: true })
  status: EmployeeAssignmentStatus

  @Prop({ type: Date, default: Date.now })
  assignedAt: Date

  @Prop({ type: Date, default: null })
  lastDispatchedAt: Date | null

  @Prop({ type: Date, default: null })
  lastConfirmedAt: Date | null

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  metadata: Record<string, any>
}

export const EmployeeAssignmentSchema = SchemaFactory.createForClass(EmployeeAssignment)
EmployeeAssignmentSchema.index({ orgId: 1, employeeId: 1, platformAccountId: 1 }, { unique: true })
EmployeeAssignmentSchema.index({ orgId: 1, employeeId: 1, assignedAt: -1 })
EmployeeAssignmentSchema.index({ orgId: 1, isActive: 1, assignedAt: -1 })
EmployeeAssignmentSchema.index({ orgId: 1, status: 1, assignedAt: -1 })
