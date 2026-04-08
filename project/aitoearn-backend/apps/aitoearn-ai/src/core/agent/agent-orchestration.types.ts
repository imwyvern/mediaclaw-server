import { McpServerName } from './agent.constants'

export const AGENT_ROLE_KEYS = ['planner', 'producer', 'distributor', 'analyst'] as const
export type AgentRoleKey = typeof AGENT_ROLE_KEYS[number]

export const AGENT_WORKFLOW_TYPES = ['planning', 'production', 'distribution', 'analytics', 'full_funnel'] as const
export type AgentWorkflowType = typeof AGENT_WORKFLOW_TYPES[number]

export const AGENT_MEMORY_POLICIES = ['stateless', 'task', 'session'] as const
export type AgentMemoryPolicy = typeof AGENT_MEMORY_POLICIES[number]

export const AGENT_EXECUTION_MODES = ['single_role', 'sequential_handoff'] as const
export type AgentExecutionMode = typeof AGENT_EXECUTION_MODES[number]

export const AGENT_ROLE_ORDER: AgentRoleKey[] = ['planner', 'producer', 'distributor', 'analyst']

export const DEFAULT_AGENT_WORKFLOW_SERVER_CATALOG: McpServerName[] = [
  McpServerName.Util,
  McpServerName.MediaGeneration,
  McpServerName.Aideo,
  McpServerName.VideoEdit,
  McpServerName.DramaRecap,
  McpServerName.VideoUtils,
  McpServerName.StyleTransfer,
  McpServerName.ImageEdit,
  McpServerName.Subtitle,
  McpServerName.Account,
  McpServerName.Content,
  McpServerName.Statistics,
  McpServerName.Publish,
]

export interface AgentRoleDefinition {
  key: AgentRoleKey
  name: string
  description: string
  responsibilities: string[]
  defaultServers: McpServerName[]
  supportedWorkflows: AgentWorkflowType[]
  subagentType: string
  model: string
  prompt: string
}

export interface AgentMemorySummary {
  policy: AgentMemoryPolicy
  latestUserIntent: string
  preferredPlatforms: string[]
  brandKeywords: string[]
  pendingActions: string[]
  recentContext: string[]
}

export interface AgentWorkflowStage {
  id: string
  role: AgentRoleKey
  name: string
  objective: string
  serverNames: McpServerName[]
  instructions: string[]
}

export interface AgentToolSelection {
  selectedServers: McpServerName[]
  roleServerMap: Partial<Record<AgentRoleKey, McpServerName[]>>
  toolFocus: string[]
}

export interface AgentWorkflowPlan {
  workflowType: AgentWorkflowType
  mode: AgentExecutionMode
  roles: AgentRoleKey[]
  memory: AgentMemorySummary
  toolSelection: AgentToolSelection
  stages: AgentWorkflowStage[]
  handoffNotes: string[]
  systemPromptAppendix: string
}

export interface PlanAgentWorkflowInput {
  prompt: unknown
  workflowType?: AgentWorkflowType
  preferredRoles?: AgentRoleKey[]
  memoryPolicy?: AgentMemoryPolicy
  historicalMessages?: Array<Record<string, unknown>>
  availableServers?: McpServerName[]
}
