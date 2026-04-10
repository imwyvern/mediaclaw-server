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

export enum ClawHostDeploymentMode {
  MANAGED = 'managed',
  BYOC = 'byoc',
}

export enum ClawHostRuntimeKind {
  DOCKER = 'docker',
  K8S = 'k8s',
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

@Schema({ _id: false })
export class ClawHostGatewayConfig {
  @Prop({ type: Boolean, default: false })
  enabled: boolean

  @Prop({ type: String, default: '' })
  url: string

  @Prop({ type: String, default: 'mediaclaw.sync' })
  toolName: string

  @Prop({ type: Date, default: null })
  lastPushAt: Date | null

  @Prop({ type: String, default: '' })
  lastPushStatus: string

  @Prop({ type: String, default: '' })
  lastPushMessage: string
}

@Schema({ _id: false })
export class ClawHostSharedExperienceChannel {
  @Prop({ type: String, required: true })
  channel: string

  @Prop({ type: String, default: '' })
  groupName: string

  @Prop({ type: String, default: '' })
  inviteUrl: string

  @Prop({ type: String, default: '' })
  chatId: string

  @Prop({ type: String, default: '' })
  entryKeyword: string
}

@Schema({ _id: false })
export class ClawHostSharedExperienceConfig {
  @Prop({ type: Boolean, default: false })
  enabled: boolean

  @Prop({ type: String, default: '' })
  displayName: string

  @Prop({ type: String, default: '' })
  welcomeMessage: string

  @Prop({ type: String, default: '' })
  supportContact: string

  @Prop({ type: String, default: '' })
  defaultChannel: string

  @Prop({ type: [ClawHostSharedExperienceChannel], default: [] })
  channels: ClawHostSharedExperienceChannel[]

  @Prop({ type: Date, default: null })
  lastActivatedAt: Date | null
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

  @Prop({ type: String, default: 'starter', index: true })
  plan: string

  @Prop({
    type: String,
    enum: ClawHostInstanceStatus,
    default: ClawHostInstanceStatus.CREATING,
    index: true,
  })
  status: ClawHostInstanceStatus

  @Prop({
    type: String,
    enum: Object.values(ClawHostDeploymentMode),
    default: ClawHostDeploymentMode.BYOC,
    index: true,
  })
  deploymentMode: ClawHostDeploymentMode

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

  @Prop({
    type: String,
    enum: Object.values(ClawHostRuntimeKind),
    default: ClawHostRuntimeKind.DOCKER,
    index: true,
  })
  runtimeKind: ClawHostRuntimeKind

  @Prop({ type: String, default: '', index: true })
  containerId: string

  @Prop({ type: String, default: '', index: true })
  containerName: string

  @Prop({ type: String, default: '' })
  runtimeImage: string

  @Prop({ type: Number, default: 0 })
  hostPort: number

  @Prop({ type: String, default: '' })
  healthUrl: string

  @Prop({ type: String, default: '' })
  lastHealthMessage: string

  @Prop({ type: ClawHostGatewayConfig, default: () => ({}) })
  gatewayConfig: ClawHostGatewayConfig

  @Prop({ type: ClawHostSharedExperienceConfig, default: () => ({}) })
  sharedExperienceConfig: ClawHostSharedExperienceConfig

  @Prop({ type: String, default: '' })
  requestedImChannel: string

  @Prop({ type: String, default: '' })
  accessUrl: string

  @Prop({ type: String, default: '' })
  installCommand: string

  @Prop({ type: String, default: '' })
  connectionCodePreview: string

  @Prop({ type: String, default: '' })
  connectionCodeHash: string

  @Prop({ type: Date, default: null })
  connectionCodeIssuedAt: Date | null

  @Prop({ type: Date, default: null })
  connectionCodeExpiresAt: Date | null

  @Prop({ type: String, default: '' })
  boundApiKeyId: string

  @Prop({ type: String, default: '' })
  boundApiKeyPrefix: string

  @Prop({ type: Date, default: null })
  boundAt: Date | null

  @Prop({ type: Date, default: null, index: true })
  lastHeartbeatAt: Date | null

  @Prop({ type: String, default: '' })
  lastClientVersion: string

  @Prop({ type: String, default: '' })
  lastAgentId: string

  @Prop({ type: [String], default: [] })
  heartbeatCapabilities: string[]
}

export const ClawHostInstanceSchema = SchemaFactory.createForClass(ClawHostInstance)

ClawHostInstanceSchema.index({ orgId: 1, status: 1, createdAt: -1 })
ClawHostInstanceSchema.index({ clientName: 1, createdAt: -1 })
ClawHostInstanceSchema.index({ orgId: 1, deploymentMode: 1, createdAt: -1 })
ClawHostInstanceSchema.index({ orgId: 1, plan: 1, createdAt: -1 })
ClawHostInstanceSchema.index({ 'sharedExperienceConfig.enabled': 1, status: 1, createdAt: -1 })
ClawHostInstanceSchema.index({ containerId: 1 }, { sparse: true })
ClawHostInstanceSchema.index({ boundApiKeyId: 1 }, { sparse: true })
