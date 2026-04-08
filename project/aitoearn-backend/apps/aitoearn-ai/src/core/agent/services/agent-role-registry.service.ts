import { Injectable } from '@nestjs/common'
import {
  AGENT_ROLE_ORDER,
  AgentRoleDefinition,
  AgentRoleKey,
  AgentWorkflowType,
} from '../agent-orchestration.types'
import { McpServerName } from '../agent.constants'

const WORKFLOW_ROLE_MAP: Record<AgentWorkflowType, AgentRoleKey[]> = {
  planning: ['planner'],
  production: ['planner', 'producer'],
  distribution: ['planner', 'distributor'],
  analytics: ['planner', 'analyst'],
  full_funnel: ['planner', 'producer', 'distributor', 'analyst'],
}

@Injectable()
export class AgentRoleRegistryService {
  private readonly roles: Record<AgentRoleKey, AgentRoleDefinition> = {
    planner: {
      key: 'planner',
      name: '策划 Agent',
      description: '负责选题、竞品洞察、品牌表达和执行顺序规划。',
      responsibilities: [
        '拆解目标与约束条件',
        '判断目标平台、品牌语气与内容方向',
        '为后续生产、分发、分析阶段生成交接说明',
      ],
      defaultServers: [
        McpServerName.Util,
        McpServerName.Content,
        McpServerName.Statistics,
        McpServerName.Account,
      ],
      supportedWorkflows: ['planning', 'production', 'distribution', 'analytics', 'full_funnel'],
      subagentType: 'planner',
      model: 'haiku',
      prompt: `You are the MediaClaw planning agent.
Focus on topic planning, competitor insight, platform selection, brand constraints, and execution sequencing.
Prefer account/content/statistics tools.
Return a concise plan, explicit assumptions, and handoff notes for downstream agents.
Avoid heavy media generation unless it is required to clarify feasibility.`,
    },
    producer: {
      key: 'producer',
      name: '生产 Agent',
      description: '负责视频、图片、文案和素材改写的生成与适配。',
      responsibilities: [
        '执行素材生成、改写、风格迁移与草稿落库',
        '确保输出符合品牌风格和目标平台',
        '沉淀可供分发与分析复用的元信息',
      ],
      defaultServers: [
        McpServerName.Util,
        McpServerName.MediaGeneration,
        McpServerName.Aideo,
        McpServerName.VideoEdit,
        McpServerName.DramaRecap,
        McpServerName.VideoUtils,
        McpServerName.StyleTransfer,
        McpServerName.ImageEdit,
        McpServerName.Subtitle,
        McpServerName.Content,
      ],
      supportedWorkflows: ['production', 'full_funnel'],
      subagentType: 'producer',
      model: 'haiku',
      prompt: `You are the MediaClaw production agent.
Produce or adapt copy, images, videos, and draft assets based on the plan.
Prefer media generation, video edit, image edit, subtitle, and content tools.
Return deliverables, saved draft/media references, and a short handoff note for distribution or analytics.`,
    },
    distributor: {
      key: 'distributor',
      name: '分发 Agent',
      description: '负责账号检查、草稿交付、发布路由和状态跟踪。',
      responsibilities: [
        '检查账号可用性与平台限制',
        '执行交付、草稿流转和发布动作',
        '输出发布状态、失败原因和后续动作',
      ],
      defaultServers: [
        McpServerName.Util,
        McpServerName.Account,
        McpServerName.Content,
        McpServerName.Publish,
      ],
      supportedWorkflows: ['distribution', 'full_funnel'],
      subagentType: 'distributor',
      model: 'haiku',
      prompt: `You are the MediaClaw distribution agent.
Handle account checks, draft delivery, publish preparation, and publish execution.
Prefer publish, account, content, and util tools.
Do not invent unsupported publish capabilities. Always explain required manual steps when automation is unavailable.`,
    },
    analyst: {
      key: 'analyst',
      name: '分析 Agent',
      description: '负责效果复盘、趋势洞察和下一轮优化建议。',
      responsibilities: [
        '整理效果数据、趋势和异常',
        '给出品牌、平台和内容层的优化建议',
        '输出可回流到策划与生产的下一步建议',
      ],
      defaultServers: [
        McpServerName.Util,
        McpServerName.Statistics,
        McpServerName.Content,
        McpServerName.Account,
      ],
      supportedWorkflows: ['analytics', 'full_funnel'],
      subagentType: 'analyst',
      model: 'haiku',
      prompt: `You are the MediaClaw analytics agent.
Summarize performance, explain trends, and recommend concrete next actions.
Prefer statistics, content, account, and util tools.
Keep outputs decision-oriented so planning and production teams can execute them directly.`,
    },
  }

  public listRoles(): AgentRoleDefinition[] {
    return AGENT_ROLE_ORDER.map(role => this.roles[role])
  }

  public getRole(role: AgentRoleKey): AgentRoleDefinition {
    return this.roles[role]
  }

  public getWorkflowDefaultRoles(workflowType: AgentWorkflowType): AgentRoleKey[] {
    return [...WORKFLOW_ROLE_MAP[workflowType]]
  }

  public inferWorkflowType(prompt: string): AgentWorkflowType {
    const text = prompt.toLowerCase()

    if (this.containsAny(text, ['全链路', 'full funnel', '端到端', '一条龙', '从选题到复盘'])) {
      return 'full_funnel'
    }

    const scores: Record<Exclude<AgentWorkflowType, 'full_funnel'>, number> = {
      planning: this.countMatches(text, ['策划', 'plan', 'strategy', '选题', '脚本', '竞品', '爆款', '方向', '建议']),
      production: this.countMatches(text, ['生成', 'produce', 'create', 'video', 'image', 'draft', 'copy', '文案', '制作', '素材', '改写', '适配', '视频', '图片']),
      distribution: this.countMatches(text, ['发布', 'publish', 'distribution', 'deliver', '推送', '分发', '交付', '账号', '渠道', 'schedule']),
      analytics: this.countMatches(text, ['分析', 'analytics', 'analysis', 'report', 'performance', 'trend', 'data', '复盘', '效果', '报表', '趋势', '指标']),
    }

    const activeCategories = Object.entries(scores)
      .filter(([, score]) => score > 0)
      .map(([workflowType]) => workflowType as Exclude<AgentWorkflowType, 'full_funnel'>)

    if (
      activeCategories.includes('production')
      && activeCategories.includes('distribution')
      && activeCategories.includes('analytics')
    ) {
      return 'full_funnel'
    }

    if (activeCategories.length === 0) {
      return 'production'
    }

    const bestMatch = Object.entries(scores)
      .sort((left, right) => right[1] - left[1])[0]?.[0]

    return (bestMatch as Exclude<AgentWorkflowType, 'full_funnel'> | undefined) ?? 'production'
  }

  public resolveRoles(params: {
    prompt: string
    workflowType: AgentWorkflowType
    preferredRoles?: AgentRoleKey[]
  }): AgentRoleKey[] {
    const { prompt, workflowType, preferredRoles = [] } = params
    const detectedRoles = new Set<AgentRoleKey>(this.detectRoles(prompt))

    for (const role of this.getWorkflowDefaultRoles(workflowType)) {
      detectedRoles.add(role)
    }

    for (const role of preferredRoles) {
      detectedRoles.add(role)
    }

    if (detectedRoles.size > 0 && !detectedRoles.has('planner')) {
      detectedRoles.add('planner')
    }

    if (detectedRoles.size === 0) {
      detectedRoles.add('planner')
      detectedRoles.add('producer')
    }

    return this.orderRoles(Array.from(detectedRoles))
  }

  public orderRoles(roles: AgentRoleKey[]): AgentRoleKey[] {
    const roleSet = new Set(roles)
    return AGENT_ROLE_ORDER.filter(role => roleSet.has(role))
  }

  private detectRoles(prompt: string): AgentRoleKey[] {
    const text = prompt.toLowerCase()
    const roles = new Set<AgentRoleKey>()

    if (this.containsAny(text, ['策划', 'plan', 'strategy', '选题', '脚本', '竞品', '爆款', '建议'])) {
      roles.add('planner')
    }
    if (this.containsAny(text, ['生成', 'produce', 'create', 'video', 'image', 'copy', '文案', '制作', '素材', '改写', '适配', '视频', '图片'])) {
      roles.add('producer')
    }
    if (this.containsAny(text, ['发布', 'publish', 'distribution', 'deliver', '推送', '分发', '交付', '渠道', '账号'])) {
      roles.add('distributor')
    }
    if (this.containsAny(text, ['分析', 'analytics', 'analysis', 'report', 'performance', 'trend', 'data', '复盘', '效果', '报表', '趋势', '指标'])) {
      roles.add('analyst')
    }

    return this.orderRoles(Array.from(roles))
  }

  private containsAny(text: string, keywords: string[]): boolean {
    return keywords.some(keyword => text.includes(keyword))
  }

  private countMatches(text: string, keywords: string[]): number {
    return keywords.reduce((count, keyword) => count + (text.includes(keyword) ? 1 : 0), 0)
  }
}
