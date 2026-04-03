import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Schema as MongooseSchema } from 'mongoose'

import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

export enum ClawHostInstanceStatus {
  CREATING = 'creating',
  PENDING_MANUAL_SETUP = 'pending_manual_setup',
  RUNNING = 'running',
  STOPPED = 'stopped',
  ERROR = 'error',
  UPGRADING = 'upgrading',
}

@Schema({ _id: false })
export class ClawHostInstanceConfig {
  @Prop({ type: String, required: true })
  cpu: string

  @Prop({ type: String, required: true })
  memory: string

  @Prop({ type: String, required: true })
  storage: string
}

@Schema({ _id: false })
export class ClawHostInstalledSkill {
  @Prop({ type: String, required: true })
  skillId: string

  @Prop({ type: String, required: true })
  version: string

  @Prop({ type: Date, default: Date.now })
  installedAt: Date
}

@Schema({ _id: false })
export class ClawHostHealthStatus {
  @Prop({ type: Date, default: null })
  lastCheck: Date | null

  @Prop({ type: Boolean, default: false })
  isHealthy: boolean

  @Prop({ type: Number, default: 0 })
  latency: number
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'clawhost_instances' })
export class ClawHostInstance extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId

  @Prop({ type: String, required: true, unique: true, index: true })
  instanceId: string

  @Prop({ type: String, required: true, index: true })
  orgId: string

  @Prop({ type: String, required: true, index: true })
  clientName: string

  @Prop({
    type: String,
    enum: ClawHostInstanceStatus,
    default: ClawHostInstanceStatus.CREATING,
    index: true,
  })
  status: ClawHostInstanceStatus

  @Prop({ type: ClawHostInstanceConfig, default: () => ({}) })
  config: ClawHostInstanceConfig

  @Prop({ type: [ClawHostInstalledSkill], default: [] })
  skills: ClawHostInstalledSkill[]

  @Prop({ type: ClawHostHealthStatus, default: () => ({}) })
  healthStatus: ClawHostHealthStatus

  @Prop({ type: String, default: '' })
  k8sNamespace: string

  @Prop({ type: String, default: '' })
  k8sPodName: string
}

export const ClawHostInstanceSchema = SchemaFactory.createForClass(ClawHostInstance)

ClawHostInstanceSchema.index({ orgId: 1, status: 1, createdAt: -1 })
ClawHostInstanceSchema.index({ clientName: 1, createdAt: -1 })
