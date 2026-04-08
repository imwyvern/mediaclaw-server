import { McpServerConfig } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'
import { McpServerName } from '../agent.constants'
import { AgentMemoryService } from './agent-memory.service'
import { AgentOrchestrationService } from './agent-orchestration.service'
import { AgentRoleRegistryService } from './agent-role-registry.service'
import { AgentToolLayerService } from './agent-tool-layer.service'

function createService() {
  const roleRegistry = new AgentRoleRegistryService()
  const memoryService = new AgentMemoryService()
  const toolLayerService = new AgentToolLayerService(roleRegistry)
  const orchestrationService = new AgentOrchestrationService(
    roleRegistry,
    memoryService,
    toolLayerService,
  )

  return {
    orchestrationService,
    roleRegistry,
  }
}

describe('agentOrchestrationService', () => {
  it('should infer a full funnel workflow with role handoff, memory, and tool focus', () => {
    const { orchestrationService } = createService()

    const plan = orchestrationService.planWorkflow({
      prompt: '请先策划一条 618 短视频，生成后发布到小红书，并在一周后复盘效果。品牌: 猫王音响',
      memoryPolicy: 'task',
      historicalMessages: [
        { type: 'user', content: '我们这次主推复古蓝牙音箱' },
        { type: 'assistant', message: { content: '可以强化复古客厅和怀旧音乐场景。' } },
      ],
      availableServers: [
        McpServerName.Util,
        McpServerName.Content,
        McpServerName.Statistics,
        McpServerName.Account,
        McpServerName.Publish,
        McpServerName.MediaGeneration,
      ],
    })

    expect(plan.workflowType).toBe('full_funnel')
    expect(plan.mode).toBe('sequential_handoff')
    expect(plan.roles).toEqual(['planner', 'producer', 'distributor', 'analyst'])
    expect(plan.memory.preferredPlatforms).toContain('XHS')
    expect(plan.memory.brandKeywords).toContain('猫王音响')
    expect(plan.memory.pendingActions).toEqual(
      expect.arrayContaining(['内容策划', '内容生产', '发布交付', '效果分析']),
    )
    expect(plan.toolSelection.selectedServers).toEqual(
      expect.arrayContaining([
        McpServerName.MediaGeneration,
        McpServerName.Publish,
        McpServerName.Statistics,
      ]),
    )
    expect(plan.stages).toHaveLength(4)
    expect(plan.systemPromptAppendix).toContain('MediaClaw Agent Orchestration')
    expect(plan.handoffNotes).toHaveLength(3)
  })

  it('should create role-scoped subagent definitions', () => {
    const { orchestrationService } = createService()

    const plan = orchestrationService.planWorkflow({
      prompt: '生成品牌视频并安排发布',
      workflowType: 'full_funnel',
      preferredRoles: ['producer', 'distributor'],
      memoryPolicy: 'stateless',
      availableServers: [
        McpServerName.Util,
        McpServerName.MediaGeneration,
        McpServerName.Content,
        McpServerName.Account,
        McpServerName.Publish,
      ],
    })

    const mcpServers: Record<string, McpServerConfig> = {
      [McpServerName.Util]: { type: 'stdio', command: 'echo' },
      [McpServerName.MediaGeneration]: { type: 'stdio', command: 'echo' },
      [McpServerName.Content]: { type: 'stdio', command: 'echo' },
      [McpServerName.Account]: { type: 'stdio', command: 'echo' },
      [McpServerName.Publish]: { type: 'stdio', command: 'echo' },
    }
    const agents = orchestrationService.createRoleAgents(plan, mcpServers)

    expect(agents.planner).toBeDefined()
    expect(agents.producer.mcpServers[0]).toMatchObject({
      [McpServerName.MediaGeneration]: mcpServers[McpServerName.MediaGeneration],
      [McpServerName.Content]: mcpServers[McpServerName.Content],
    })
    expect(agents.distributor.mcpServers[0]).toMatchObject({
      [McpServerName.Account]: mcpServers[McpServerName.Account],
      [McpServerName.Publish]: mcpServers[McpServerName.Publish],
    })
    expect(agents.analyst.prompt).toContain('analytics agent')
  })
})
