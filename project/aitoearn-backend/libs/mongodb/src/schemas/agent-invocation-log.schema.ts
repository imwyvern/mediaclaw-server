import { randomBytes } from 'node:crypto'
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Schema as MongooseSchema } from 'mongoose'
import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

export const AGENT_INVOCATION_STATUSES = ['running', 'success', 'failed'] as const
export type AgentInvocationStatus = typeof AGENT_INVOCATION_STATUSES[number]

function generateInvocationId() {
  return `AIL${Date.now().toString(36).toUpperCase()}${randomBytes(3).toString('hex').toUpperCase()}`
}

@Schema({ _id: false })
export class AgentInvocationTokenUsage {
  @Prop({ type: Number, default: 0 })
  inputTokens: number

  @Prop({ type: Number, default: 0 })
  outputTokens: number

  @Prop({ type: Number, default: 0 })
  cacheCreationInputTokens: number

  @Prop({ type: Number, default: 0 })
  cacheReadInputTokens: number

  @Prop({ type: Number, default: 0 })
  totalTokens: number
}

@Schema({ _id: false })
export class AgentInvocationStepLog {
  @Prop({ type: String, required: true })
  stageId: string

  @Prop({ type: String, required: true })
  stepId: string

  @Prop({ type: String, required: true })
  role: string

  @Prop({ type: String, required: true })
  status: string

  @Prop({ type: Boolean, default: false })
  skipped: boolean

  @Prop({ type: Boolean, default: true })
  conditionMatched: boolean

  @Prop({ type: Number, default: 0 })
  latencyMs: number

  @Prop({ type: AgentInvocationTokenUsage, default: () => ({}) })
  tokenUsage: AgentInvocationTokenUsage

  @Prop({ type: Number, default: 0 })
  costUsd: number

  @Prop({ type: Object, default: {} })
  input: Record<string, unknown>

  @Prop({ type: Object, default: {} })
  output: Record<string, unknown>

  @Prop({ type: String, default: '' })
  errorMessage: string

  @Prop({ type: Date, default: Date.now })
  startedAt: Date

  @Prop({ type: Date, default: null })
  completedAt: Date | null
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'agent_invocation_logs' })
export class AgentInvocationLog extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId

  @Prop({ type: String, required: true, unique: true, index: true, default: generateInvocationId })
  invocationId: string

  @Prop({ type: String, required: true, index: true })
  agentId: string

  @Prop({ type: String, required: true })
  version: string

  @Prop({ type: String, default: '' })
  orgId: string

  @Prop({ type: String, required: true, index: true })
  userId: string

  @Prop({
    type: String,
    enum: AGENT_INVOCATION_STATUSES,
    default: 'running',
    index: true,
  })
  status: AgentInvocationStatus

  @Prop({ type: Object, default: {} })
  input: Record<string, unknown>

  @Prop({ type: Object, default: {} })
  output: Record<string, unknown>

  @Prop({ type: String, default: '' })
  errorMessage: string

  @Prop({ type: Number, default: 0 })
  latencyMs: number

  @Prop({ type: AgentInvocationTokenUsage, default: () => ({}) })
  tokenUsage: AgentInvocationTokenUsage

  @Prop({ type: Number, default: 0 })
  costUsd: number

  @Prop({ type: [AgentInvocationStepLog], default: [] })
  trace: AgentInvocationStepLog[]

  @Prop({ type: Object, default: {} })
  metadata: Record<string, unknown>
}

export const AgentInvocationLogSchema = SchemaFactory.createForClass(AgentInvocationLog)

AgentInvocationLogSchema.index({ agentId: 1, createdAt: -1 })
AgentInvocationLogSchema.index({ userId: 1, createdAt: -1 })
AgentInvocationLogSchema.index({ agentId: 1, version: 1, createdAt: -1 })
