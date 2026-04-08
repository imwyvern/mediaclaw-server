import { McpServerConfig } from '@anthropic-ai/claude-agent-sdk'
import { Injectable } from '@nestjs/common'
import {
  AGENT_EXECUTION_MODES,
  AgentRoleKey,
  AgentWorkflowPlan,
  AgentWorkflowStage,
  PlanAgentWorkflowInput,
} from '../agent-orchestration.types'
import { McpServerName } from '../agent.constants'
import { AgentMemoryService } from './agent-memory.service'
import { AgentRoleRegistryService } from './agent-role-registry.service'
import { AgentToolLayerService } from './agent-tool-layer.service'

@Injectable()
export class AgentOrchestrationService {
  constructor(
    private readonly agentRoleRegistryService: AgentRoleRegistryService,
    private readonly agentMemoryService: AgentMemoryService,
    private readonly agentToolLayerService: AgentToolLayerService,
  ) {}

  public listRoles() {
    return this.agentRoleRegistryService.listRoles()
  }

  public planWorkflow(input: PlanAgentWorkflowInput): AgentWorkflowPlan {
    const promptText = this.agentMemoryService.toPlainText(input.prompt)
    const workflowType = input.workflowType ?? this.agentRoleRegistryService.inferWorkflowType(promptText)
    const roles = this.agentRoleRegistryService.resolveRoles({
      prompt: promptText,
      workflowType,
      preferredRoles: input.preferredRoles,
    })
    const memory = this.agentMemoryService.summarize({
      prompt: input.prompt,
      memoryPolicy: input.memoryPolicy ?? 'task',
      historicalMessages: input.historicalMessages,
    })
    const toolSelection = this.agentToolLayerService.selectTools({
      roles,
      availableServers: input.availableServers ?? [],
    })

    const stages = roles.map((role, index) => this.createStage(role, index, toolSelection.roleServerMap[role] ?? [], memory.latestUserIntent))
    const mode = roles.length > 1 ? AGENT_EXECUTION_MODES[1] : AGENT_EXECUTION_MODES[0]
    const handoffNotes = this.buildHandoffNotes(roles, memory.pendingActions)

    const plan: AgentWorkflowPlan = {
      workflowType,
      mode,
      roles,
      memory,
      toolSelection,
      stages,
      handoffNotes,
      systemPromptAppendix: '',
    }

    plan.systemPromptAppendix = this.buildSystemPromptAppendix(plan)
    return plan
  }

  public createRoleAgents(
    plan: AgentWorkflowPlan,
    mcpServers: Record<string, McpServerConfig>,
  ): Record<string, {
    description: string
    model: string
    mcpServers: Array<Record<string, McpServerConfig>>
    tools: string[]
    prompt: string
    skills: string[]
  }> {
    const agents: Record<string, {
      description: string
      model: string
      mcpServers: Array<Record<string, McpServerConfig>>
      tools: string[]
      prompt: string
      skills: string[]
    }> = {}

    for (const role of plan.roles) {
      const roleDefinition = this.agentRoleRegistryService.getRole(role)
      const scopedServers = (plan.toolSelection.roleServerMap[role] ?? []).reduce<Record<string, McpServerConfig>>((accumulator, serverName) => {
        const server = mcpServers[serverName]
        if (server) {
          accumulator[serverName] = server
        }
        return accumulator
      }, {})

      agents[roleDefinition.subagentType] = {
        description: roleDefinition.description,
        model: roleDefinition.model,
        mcpServers: [scopedServers],
        tools: [
          'Task',
          'TaskOutput',
          'Read',
          'WebFetch',
          'TodoWrite',
          'TaskStop',
          'Skill',
          'ListMcpResourcesTool',
          'ReadMcpResourceTool',
        ],
        prompt: roleDefinition.prompt,
        skills: [],
      }
    }

    return agents
  }

  private createStage(
    role: AgentRoleKey,
    index: number,
    serverNames: McpServerName[],
    latestIntent: string,
  ): AgentWorkflowStage {
    const roleDefinition = this.agentRoleRegistryService.getRole(role)

    return {
      id: `stage-${index + 1}`,
      role,
      name: `${index + 1}. ${roleDefinition.name}`,
      objective: `${roleDefinition.description}${latestIntent ? ` 当前目标：${latestIntent}` : ''}`,
      serverNames,
      instructions: [
        `优先调用 ${serverNames.join(', ') || McpServerName.Util} 对应工具。`,
        '输出可直接交接给下一阶段的结论、素材引用和风险提示。',
      ],
    }
  }

  private buildHandoffNotes(roles: AgentRoleKey[], pendingActions: string[]): string[] {
    if (roles.length <= 1) {
      return pendingActions.length ? [`当前重点动作：${pendingActions.join('、')}`] : ['当前流程为单角色执行，无需额外交接。']
    }

    return roles.slice(0, -1).map((role, index) => {
      const currentRole = this.agentRoleRegistryService.getRole(role)
      const nextRole = this.agentRoleRegistryService.getRole(roles[index + 1]!)
      return `${currentRole.name} 完成后，将结论和素材引用交给 ${nextRole.name}；重点动作：${pendingActions.join('、') || '按阶段目标推进'}。`
    })
  }

  private buildSystemPromptAppendix(plan: AgentWorkflowPlan): string {
    const roleSummary = plan.roles
      .map((role) => {
        const definition = this.agentRoleRegistryService.getRole(role)
        return `- ${definition.subagentType}: ${definition.description}`
      })
      .join('\n')

    const stageSummary = plan.stages
      .map(stage => `- ${stage.name}: ${stage.objective}（工具域: ${stage.serverNames.join(', ') || McpServerName.Util}）`)
      .join('\n')

    const memorySummary = [
      `- latestUserIntent: ${plan.memory.latestUserIntent || 'N/A'}`,
      `- preferredPlatforms: ${plan.memory.preferredPlatforms.join(', ') || 'N/A'}`,
      `- brandKeywords: ${plan.memory.brandKeywords.join(', ') || 'N/A'}`,
      `- pendingActions: ${plan.memory.pendingActions.join(', ') || 'N/A'}`,
      ...(plan.memory.recentContext.length
        ? plan.memory.recentContext.map(context => `- recentContext: ${context}`)
        : ['- recentContext: N/A']),
    ].join('\n')

    return `## MediaClaw Agent Orchestration
Workflow type: ${plan.workflowType}
Execution mode: ${plan.mode}

### Registered role agents
${roleSummary}

### Workflow stages
${stageSummary}

### Tool focus
${plan.toolSelection.toolFocus.map(item => `- ${item}`).join('\n')}

### Memory summary
${memorySummary}

### Handoff notes
${plan.handoffNotes.map(note => `- ${note}`).join('\n')}

When role agents are registered, delegate stage work with the Task tool in stage order.
Use the matching subagent_type for each role and keep final synthesis in the coordinator response.`
  }
}
