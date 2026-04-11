import { McpServerConfig } from '@anthropic-ai/claude-agent-sdk'
import { ContentBlockParam } from '@anthropic-ai/sdk/resources'

export const PRODUCT_AGENT_STAGE_MODES = ['serial', 'parallel', 'conditional'] as const
export type ProductAgentStageMode = typeof PRODUCT_AGENT_STAGE_MODES[number]

export const PRODUCT_AGENT_CONDITION_OPERATORS = ['exists', 'equals', 'includes'] as const
export type ProductAgentConditionOperator = typeof PRODUCT_AGENT_CONDITION_OPERATORS[number]

export interface ProductAgentCondition {
  source: 'input' | 'context'
  path: string
  operator: ProductAgentConditionOperator
  value?: unknown
}

export interface ProductAgentStep {
  id: string
  name: string
  role: string
  promptTemplate: string
  outputKey?: string
  serverNames: string[]
}

export interface ProductAgentStage {
  id: string
  name: string
  mode: ProductAgentStageMode
  condition?: ProductAgentCondition | null
  steps: ProductAgentStep[]
}

export interface ProductAgentDefinition {
  id: string
  agentId: string
  version: string
  name: string
  description: string
  category: string
  capabilities: string[]
  tags: string[]
  isDefault: boolean
  rolloutStrategy: string
  rolloutTargets: Array<{
    version: string
    weight: number
    label: string
  }>
  stages: ProductAgentStage[]
  execution: {
    model: string
    maxBudgetUsd: number
    timeoutMs: number
  }
  schema: {
    input: Record<string, unknown>
    output: Record<string, unknown>
  }
  metadata: Record<string, unknown>
}

export interface ProductAgentInvocationInput {
  prompt: string
  payload: Record<string, unknown>
  targetVersion?: string
}

export interface ProductAgentResolvedVersion {
  definition: ProductAgentDefinition
  selectedVersion: string
  bucket: number
  variantLabel: string
}

export interface ProductAgentRuntimeResources {
  mcpServers: Record<string, McpServerConfig>
  maxBudgetUsd?: number
}

export interface ProductAgentTokenUsage {
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens: number
  cacheReadInputTokens: number
  totalTokens: number
}

export interface ProductAgentStepResult {
  stageId: string
  stepId: string
  role: string
  status: 'success' | 'failed' | 'skipped'
  latencyMs: number
  conditionMatched: boolean
  skipped?: boolean
  input: Record<string, unknown>
  output: Record<string, unknown>
  errorMessage?: string
  tokenUsage: ProductAgentTokenUsage
  costUsd: number
}

export interface ProductAgentInvocationResult {
  invocationId: string
  agentId: string
  version: string
  variantLabel: string
  latencyMs: number
  costUsd: number
  tokenUsage: ProductAgentTokenUsage
  output: Record<string, unknown>
  trace: ProductAgentStepResult[]
}

export interface ProductAgentExecutionInput {
  definition: ProductAgentDefinition
  variantLabel: string
  userId: string
  orgId?: string
  prompt: string
  payload: Record<string, unknown>
  runtimeResources: ProductAgentRuntimeResources
}

export interface ProductAgentStepRunContext {
  prompt: string
  payload: Record<string, unknown>
  priorOutputs: Record<string, unknown>
  definition: ProductAgentDefinition
  step: ProductAgentStep
  runtimeResources: ProductAgentRuntimeResources
}

export interface ProductAgentStepRunResponse {
  output: Record<string, unknown>
  tokenUsage: ProductAgentTokenUsage
  costUsd: number
  latencyMs: number
  transcript: ContentBlockParam[]
}
