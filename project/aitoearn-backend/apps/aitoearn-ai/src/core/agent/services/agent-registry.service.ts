import { Injectable, OnModuleInit } from '@nestjs/common'
import { AgentDefinitionRepository } from '@yikart/mongodb'
import { ProductAgentDefinition } from '../agent-product.types'
import { McpServerName } from '../agent.constants'

const DEFAULT_AGENT_DEFINITIONS = [
  {
    agentId: 'video-generator',
    version: '1.0.0',
    name: '视频生成 Agent',
    description: '负责从选题、脚本到视频素材生成的多 Agent 编排。',
    category: 'content-production',
    tags: ['video', 'generation', 'planning'],
    capabilities: ['video.generate', 'script.plan', 'asset.adapt'],
    isDefault: true,
    rolloutStrategy: 'stable',
    rolloutTargets: [{ version: '1.0.0', weight: 100, label: 'stable' }],
    schema: {
      input: {
        type: 'object',
        properties: {
          topic: { type: 'string' },
          platform: { type: 'string' },
          duration: { type: 'number' },
          brandVoice: { type: 'string' },
        },
        required: ['topic'],
      },
      output: {
        type: 'object',
        properties: {
          strategy: { type: 'object' },
          deliverable: { type: 'object' },
        },
      },
    },
    execution: {
      model: 'claude-opus-4-6',
      maxBudgetUsd: 8,
      timeoutMs: 180_000,
    },
    stages: [
      {
        id: 'planning',
        name: '规划拆解',
        mode: 'serial',
        steps: [
          {
            id: 'planner-brief',
            name: '选题与脚本规划',
            role: 'planner',
            promptTemplate: '将用户目标拆成可执行的视频 brief、镜头结构、平台适配策略和风险清单。',
            outputKey: 'strategy',
            serverNames: [McpServerName.Util, McpServerName.Content, McpServerName.Statistics],
          },
        ],
      },
      {
        id: 'production',
        name: '内容生产',
        mode: 'serial',
        steps: [
          {
            id: 'producer-generate',
            name: '视频与文案生产',
            role: 'producer',
            promptTemplate: '基于 strategy 生成视频生产方案、草稿文案、素材建议和交付结构。',
            outputKey: 'deliverable',
            serverNames: [McpServerName.Util, McpServerName.Content, McpServerName.MediaGeneration, McpServerName.VideoEdit, McpServerName.ImageEdit],
          },
        ],
      },
    ],
  },
  {
    agentId: 'copy-generator',
    version: '1.0.0',
    name: '文案生成 Agent',
    description: '负责品牌内容、平台文案和投放话术的结构化生成。',
    category: 'copywriting',
    tags: ['copy', 'headline', 'script'],
    capabilities: ['copy.generate', 'headline.optimize', 'cta.compose'],
    isDefault: true,
    rolloutStrategy: 'stable',
    rolloutTargets: [{ version: '1.0.0', weight: 100, label: 'stable' }],
    schema: {
      input: {
        type: 'object',
        properties: {
          topic: { type: 'string' },
          platform: { type: 'string' },
          tone: { type: 'string' },
          goal: { type: 'string' },
        },
        required: ['topic'],
      },
      output: {
        type: 'object',
        properties: {
          brief: { type: 'object' },
          copy: { type: 'object' },
        },
      },
    },
    execution: {
      model: 'claude-opus-4-6',
      maxBudgetUsd: 4,
      timeoutMs: 120_000,
    },
    stages: [
      {
        id: 'plan-copy',
        name: '文案规划',
        mode: 'serial',
        steps: [
          {
            id: 'copy-plan',
            name: '策略拆解',
            role: 'planner',
            promptTemplate: '输出目标用户、卖点优先级、平台语气和文案结构建议。',
            outputKey: 'brief',
            serverNames: [McpServerName.Util, McpServerName.Content, McpServerName.Statistics],
          },
          {
            id: 'copy-produce',
            name: '正文生成',
            role: 'producer',
            promptTemplate: '基于 brief 生成标题、正文、标签、CTA 和备用版本。',
            outputKey: 'copy',
            serverNames: [McpServerName.Util, McpServerName.Content],
          },
        ],
      },
    ],
  },
  {
    agentId: 'competitor-monitor',
    version: '1.0.0',
    name: '竞品监控 Agent',
    description: '负责竞品内容监控、趋势提炼与商业动作建议。',
    category: 'analytics',
    tags: ['competitor', 'trend', 'monitoring'],
    capabilities: ['competitor.track', 'trend.analyze', 'insight.report'],
    isDefault: true,
    rolloutStrategy: 'ab_test',
    rolloutTargets: [{ version: '1.0.0', weight: 100, label: 'baseline' }],
    schema: {
      input: {
        type: 'object',
        properties: {
          competitors: { type: 'array', items: { type: 'string' } },
          platform: { type: 'string' },
          window: { type: 'string' },
        },
        required: ['competitors'],
      },
      output: {
        type: 'object',
        properties: {
          signalScan: { type: 'object' },
          planningImpact: { type: 'object' },
          report: { type: 'object' },
        },
      },
    },
    execution: {
      model: 'claude-opus-4-6',
      maxBudgetUsd: 6,
      timeoutMs: 150_000,
    },
    stages: [
      {
        id: 'parallel-scan',
        name: '并行扫描',
        mode: 'parallel',
        steps: [
          {
            id: 'trend-analyze',
            name: '趋势分析',
            role: 'analyst',
            promptTemplate: '识别竞品表现、爆款信号、异常波动和可量化机会。',
            outputKey: 'signalScan',
            serverNames: [McpServerName.Util, McpServerName.Statistics, McpServerName.Content],
          },
          {
            id: 'planning-impact',
            name: '策略影响评估',
            role: 'planner',
            promptTemplate: '从品牌策略视角评估竞品动作对本轮选题与分发的影响。',
            outputKey: 'planningImpact',
            serverNames: [McpServerName.Util, McpServerName.Content, McpServerName.Statistics],
          },
        ],
      },
      {
        id: 'synthesis',
        name: '汇总报告',
        mode: 'serial',
        steps: [
          {
            id: 'final-report',
            name: '洞察结论',
            role: 'analyst',
            promptTemplate: '整合 signalScan 和 planningImpact，输出竞品监控简报和下一步行动建议。',
            outputKey: 'report',
            serverNames: [McpServerName.Util, McpServerName.Statistics, McpServerName.Content],
          },
        ],
      },
    ],
  },
  {
    agentId: 'content-delivery',
    version: '1.0.0',
    name: '内容交付 Agent',
    description: '负责交付准备、账号检查、条件化分发与交付闭环。',
    category: 'distribution',
    tags: ['delivery', 'publish', 'routing'],
    capabilities: ['delivery.prepare', 'account.verify', 'publish.route'],
    isDefault: true,
    rolloutStrategy: 'canary',
    rolloutTargets: [{ version: '1.0.0', weight: 100, label: 'canary' }],
    schema: {
      input: {
        type: 'object',
        properties: {
          contentId: { type: 'string' },
          accountGroupId: { type: 'string' },
          deliveryChannels: { type: 'array', items: { type: 'string' } },
        },
        required: ['contentId'],
      },
      output: {
        type: 'object',
        properties: {
          preparation: { type: 'object' },
          delivery: { type: 'object' },
        },
      },
    },
    execution: {
      model: 'claude-opus-4-6',
      maxBudgetUsd: 4,
      timeoutMs: 120_000,
    },
    stages: [
      {
        id: 'prepare-delivery',
        name: '交付准备',
        mode: 'serial',
        steps: [
          {
            id: 'delivery-plan',
            name: '交付检查',
            role: 'producer',
            promptTemplate: '校验素材齐备性、交付说明、品牌约束和草稿状态。',
            outputKey: 'preparation',
            serverNames: [McpServerName.Util, McpServerName.Content],
          },
        ],
      },
      {
        id: 'conditional-distribution',
        name: '条件化分发',
        mode: 'conditional',
        condition: {
          source: 'input',
          path: 'deliveryChannels',
          operator: 'exists',
        },
        steps: [
          {
            id: 'distribution-run',
            name: '账号校验与交付',
            role: 'distributor',
            promptTemplate: '如果 deliveryChannels 存在，则执行账号核验、发布路由和交付说明生成。',
            outputKey: 'delivery',
            serverNames: [McpServerName.Util, McpServerName.Account, McpServerName.Publish, McpServerName.Content],
          },
        ],
      },
    ],
  },
  {
    agentId: 'performance-analyst',
    version: '1.0.0',
    name: '数据分析 Agent',
    description: '负责表现复盘、异常解释与下一轮优化动作。',
    category: 'analytics',
    tags: ['analytics', 'performance', 'report'],
    capabilities: ['performance.review', 'funnel.analyze', 'optimization.recommend'],
    isDefault: true,
    rolloutStrategy: 'stable',
    rolloutTargets: [{ version: '1.0.0', weight: 100, label: 'stable' }],
    schema: {
      input: {
        type: 'object',
        properties: {
          reportRange: { type: 'string' },
          metricFocus: { type: 'array', items: { type: 'string' } },
          platform: { type: 'string' },
        },
      },
      output: {
        type: 'object',
        properties: {
          analysis: { type: 'object' },
        },
      },
    },
    execution: {
      model: 'claude-opus-4-6',
      maxBudgetUsd: 4,
      timeoutMs: 120_000,
    },
    stages: [
      {
        id: 'analyze-performance',
        name: '效果分析',
        mode: 'serial',
        steps: [
          {
            id: 'analytics-review',
            name: '效果复盘',
            role: 'analyst',
            promptTemplate: '结合指标重点输出异常原因、增长机会和下一轮执行建议。',
            outputKey: 'analysis',
            serverNames: [McpServerName.Util, McpServerName.Statistics, McpServerName.Content, McpServerName.Account],
          },
        ],
      },
    ],
  },
] as const

@Injectable()
export class AgentRegistryService implements OnModuleInit {
  private seedReady = false

  constructor(
    private readonly agentDefinitionRepository: AgentDefinitionRepository,
  ) {}

  async onModuleInit() {
    await this.ensureSeeded()
  }

  async listAgents(): Promise<ProductAgentDefinition[]> {
    await this.ensureSeeded()
    const definitions = await this.agentDefinitionRepository.listActive()
    const grouped = new Map<string, ProductAgentDefinition[]>()

    for (const definition of definitions) {
      const productDefinition = this.toProductDefinition(definition)
      const current = grouped.get(productDefinition.agentId) || []
      current.push(productDefinition)
      grouped.set(productDefinition.agentId, current)
    }

    return Array.from(grouped.values())
      .map(versions => versions.sort((left, right) => Number(right.isDefault) - Number(left.isDefault))[0]!)
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
  }

  async listAgentVersions(agentId: string): Promise<ProductAgentDefinition[]> {
    await this.ensureSeeded()
    const definitions = await this.agentDefinitionRepository.listActiveByAgentId(agentId)
    return definitions.map(definition => this.toProductDefinition(definition))
  }

  async getAgentVersion(agentId: string, version: string): Promise<ProductAgentDefinition | null> {
    await this.ensureSeeded()
    const definition = await this.agentDefinitionRepository.getByAgentIdAndVersion(agentId, version)
    return definition ? this.toProductDefinition(definition) : null
  }

  private async ensureSeeded() {
    if (this.seedReady) {
      return
    }

    for (const definition of DEFAULT_AGENT_DEFINITIONS) {
      const seedPayload = JSON.parse(JSON.stringify(definition)) as Record<string, unknown>
      await this.agentDefinitionRepository.upsertByAgentVersion(
        definition.agentId,
        definition.version,
        {
          ...seedPayload,
          status: 'active',
          metadata: {
            lifecycle: 'builtin',
          },
        },
      )
    }

    this.seedReady = true
  }

  private toProductDefinition(definition: Record<string, unknown>): ProductAgentDefinition {
    const rolloutTargets = this.asRecordArray(definition['rolloutTargets'])
    const stages = this.asRecordArray(definition['stages'])
    const execution = this.asRecord(definition['execution'])
    const schema = this.asRecord(definition['schema'])

    return {
      id: String(definition['id'] || definition['_id']),
      agentId: String(definition['agentId'] || ''),
      version: String(definition['version'] || ''),
      name: String(definition['name'] || ''),
      description: String(definition['description'] || ''),
      category: String(definition['category'] || 'general'),
      capabilities: this.asStringArray(definition['capabilities']),
      tags: this.asStringArray(definition['tags']),
      isDefault: Boolean(definition['isDefault']),
      rolloutStrategy: String(definition['rolloutStrategy'] || 'stable'),
      rolloutTargets: rolloutTargets.map(target => ({
        version: String(target['version'] || ''),
        weight: Number(target['weight'] || 0),
        label: String(target['label'] || ''),
      })),
      stages: stages.map(stage => ({
        id: String(stage['id'] || ''),
        name: String(stage['name'] || ''),
        mode: String(stage['mode'] || 'serial') as ProductAgentDefinition['stages'][number]['mode'],
        condition: stage['condition']
          ? {
              source: String(this.asRecord(stage['condition'])?.['source'] || 'input') as 'input' | 'context',
              path: String(this.asRecord(stage['condition'])?.['path'] || ''),
              operator: String(this.asRecord(stage['condition'])?.['operator'] || 'exists') as 'exists' | 'equals' | 'includes',
              value: this.asRecord(stage['condition'])?.['value'],
            }
          : null,
        steps: this.asRecordArray(stage['steps']).map(step => ({
          id: String(step['id'] || ''),
          name: String(step['name'] || ''),
          role: String(step['role'] || ''),
          promptTemplate: String(step['promptTemplate'] || ''),
          outputKey: String(step['outputKey'] || ''),
          serverNames: this.asStringArray(step['serverNames']),
        })),
      })),
      execution: {
        model: String(execution?.['model'] || 'claude-opus-4-6'),
        maxBudgetUsd: Number(execution?.['maxBudgetUsd'] || 0),
        timeoutMs: Number(execution?.['timeoutMs'] || 120_000),
      },
      schema: {
        input: this.asRecord(schema?.['input']) || {},
        output: this.asRecord(schema?.['output']) || {},
      },
      metadata: this.asRecord(definition['metadata']) || {},
    }
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' ? value as Record<string, unknown> : undefined
  }

  private asRecordArray(value: unknown) {
    if (!Array.isArray(value)) {
      return []
    }

    return value
      .map(item => this.asRecord(item))
      .filter((item): item is Record<string, unknown> => Boolean(item))
  }

  private asStringArray(value: unknown) {
    if (!Array.isArray(value)) {
      return []
    }

    return value.map(item => String(item))
  }
}
