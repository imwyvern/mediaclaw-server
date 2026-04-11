import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Schema as MongooseSchema } from 'mongoose'
import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

export const AGENT_DEFINITION_STATUSES = ['draft', 'active', 'archived'] as const
export type AgentDefinitionStatus = typeof AGENT_DEFINITION_STATUSES[number]

export const AGENT_ROLLOUT_STRATEGIES = ['stable', 'canary', 'ab_test'] as const
export type AgentRolloutStrategy = typeof AGENT_ROLLOUT_STRATEGIES[number]

export const AGENT_STAGE_MODES = ['serial', 'parallel', 'conditional'] as const
export type AgentStageMode = typeof AGENT_STAGE_MODES[number]

export const AGENT_CONDITION_OPERATORS = ['exists', 'equals', 'includes'] as const
export type AgentConditionOperator = typeof AGENT_CONDITION_OPERATORS[number]

@Schema({ _id: false })
export class AgentSchemaPayload {
  @Prop({ type: Object, default: {} })
  input: Record<string, unknown>

  @Prop({ type: Object, default: {} })
  output: Record<string, unknown>
}

@Schema({ _id: false })
export class AgentExecutionConfig {
  @Prop({ type: String, default: 'claude-opus-4-6' })
  model: string

  @Prop({ type: Number, default: 0 })
  maxBudgetUsd: number

  @Prop({ type: Number, default: 120_000 })
  timeoutMs: number
}

@Schema({ _id: false })
export class AgentRolloutTarget {
  @Prop({ type: String, required: true })
  version: string

  @Prop({ type: Number, default: 100, min: 0, max: 100 })
  weight: number

  @Prop({ type: String, default: '' })
  label: string
}

@Schema({ _id: false })
export class AgentWorkflowCondition {
  @Prop({ type: String, default: 'input' })
  source: string

  @Prop({ type: String, required: true })
  path: string

  @Prop({
    type: String,
    enum: AGENT_CONDITION_OPERATORS,
    default: 'exists',
  })
  operator: AgentConditionOperator

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  value: unknown
}

@Schema({ _id: false })
export class AgentWorkflowStep {
  @Prop({ type: String, required: true })
  id: string

  @Prop({ type: String, required: true })
  name: string

  @Prop({ type: String, required: true })
  role: string

  @Prop({ type: String, default: '' })
  promptTemplate: string

  @Prop({ type: String, default: '' })
  outputKey: string

  @Prop({ type: [String], default: [] })
  serverNames: string[]
}

@Schema({ _id: false })
export class AgentWorkflowStage {
  @Prop({ type: String, required: true })
  id: string

  @Prop({ type: String, required: true })
  name: string

  @Prop({
    type: String,
    enum: AGENT_STAGE_MODES,
    default: 'serial',
  })
  mode: AgentStageMode

  @Prop({ type: AgentWorkflowCondition, default: null })
  condition: AgentWorkflowCondition | null

  @Prop({ type: [AgentWorkflowStep], default: [] })
  steps: AgentWorkflowStep[]
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'agent_definitions' })
export class AgentDefinition extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId

  @Prop({ type: String, required: true, index: true })
  agentId: string

  @Prop({ type: String, required: true })
  version: string

  @Prop({ type: String, required: true })
  name: string

  @Prop({ type: String, default: '' })
  description: string

  @Prop({ type: String, default: 'general', index: true })
  category: string

  @Prop({ type: [String], default: [] })
  tags: string[]

  @Prop({ type: [String], default: [] })
  capabilities: string[]

  @Prop({
    type: String,
    enum: AGENT_DEFINITION_STATUSES,
    default: 'active',
    index: true,
  })
  status: AgentDefinitionStatus

  @Prop({ type: Boolean, default: false, index: true })
  isDefault: boolean

  @Prop({ type: AgentSchemaPayload, default: () => ({}) })
  schema: AgentSchemaPayload

  @Prop({
    type: String,
    enum: AGENT_ROLLOUT_STRATEGIES,
    default: 'stable',
  })
  rolloutStrategy: AgentRolloutStrategy

  @Prop({ type: [AgentRolloutTarget], default: [] })
  rolloutTargets: AgentRolloutTarget[]

  @Prop({ type: [AgentWorkflowStage], default: [] })
  stages: AgentWorkflowStage[]

  @Prop({ type: AgentExecutionConfig, default: () => ({}) })
  execution: AgentExecutionConfig

  @Prop({ type: Object, default: {} })
  metadata: Record<string, unknown>
}

export const AgentDefinitionSchema = SchemaFactory.createForClass(AgentDefinition)

AgentDefinitionSchema.index({ agentId: 1, version: 1 }, { unique: true })
AgentDefinitionSchema.index({ agentId: 1, status: 1, isDefault: -1, createdAt: -1 })
