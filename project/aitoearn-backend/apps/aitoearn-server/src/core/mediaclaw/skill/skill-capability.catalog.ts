export interface SkillCapabilityLayer {
  layer: 'L1' | 'L2' | 'L3' | 'L4'
  capability: string
  title: string
  description: string
  tags: string[]
  commands: string[]
  routes: string[]
}

export const DEFAULT_AGENT_CAPABILITIES = [
  'delivery',
  'review',
  'analytics',
  'scheduling',
  'brand',
  'pipeline',
  'campaign',
]

export const SKILL_CAPABILITY_LAYERS: SkillCapabilityLayer[] = [
  {
    layer: 'L1',
    capability: 'content.delivery',
    title: '内容交付',
    description: '列出我的视频、查看交付待办、预览下载成片和查询任务进度。',
    tags: ['delivery', 'preview', 'download', 'task'],
    commands: [
      'discover',
      'register',
      'config',
      'heartbeat',
      'list',
      'pending',
      'preview',
      'download',
      'deliveries',
      'confirm-delivery',
      'task-list',
      'task-status',
    ],
    routes: [
      '/api/v1/skill/register',
      '/api/v1/skill/config',
      '/api/v1/skill/capabilities',
      '/api/v1/content',
      '/api/v1/content/:id',
      '/api/v1/content/:id/download',
      '/api/v1/tasks',
      '/api/v1/tasks/:id',
      '/api/v1/heartbeat',
    ],
  },
  {
    layer: 'L2',
    capability: 'content.management',
    title: '内容管理',
    description: '审核发布、修改标题字幕、提交反馈并管理品牌素材。',
    tags: ['review', 'copy', 'brand', 'feedback'],
    commands: [
      'approve',
      'review',
      'edit-copy',
      'published',
      'feedback',
      'brand-list',
      'brand-get',
      'brand-update',
      'brand-assets',
      'account',
      'balance',
    ],
    routes: [
      '/api/v1/content/pending',
      '/api/v1/content/:id/approve',
      '/api/v1/content/:id/review',
      '/api/v1/content/:id/copy',
      '/api/v1/content/:id/published',
      '/api/v1/skill/feedback',
      '/api/v1/brand',
      '/api/v1/brand/:id',
      '/api/v1/brand/assets',
      '/api/v1/account/info',
      '/api/v1/usage/summary',
    ],
  },
  {
    layer: 'L3',
    capability: 'analytics.insight',
    title: '数据查询',
    description: '查询我的统计、内容报告、SEO、竞品趋势和行业热门内容。',
    tags: ['analytics', 'report', 'competitor'],
    commands: [
      'stats',
      'analytics-overview',
      'analytics-content',
      'analytics-top',
      'analytics-seo',
      'analytics-report',
      'competitors-trending',
      'audit-log',
    ],
    routes: [
      '/api/v1/analytics/overview',
      '/api/v1/analytics/content/:id',
      '/api/v1/analytics/trends',
      '/api/v1/analytics/top',
      '/api/v1/analytics/seo',
      '/api/v1/analytics/report',
      '/api/v1/discovery/pool',
      '/api/v1/audit-logs',
    ],
  },
  {
    layer: 'L4',
    capability: 'production.orchestration',
    title: '生产调度',
    description: '创建任务、调整风格偏好、配置管线、绑定群组和管理 Campaign。',
    tags: ['scheduling', 'pipeline', 'campaign'],
    commands: [
      'create-task',
      'task-update',
      'task-cancel',
      'task-retry',
      'task-timeline',
      'style-preferences',
      'pipeline-list',
      'pipeline-get',
      'pipeline-create',
      'pipeline-update',
      'pipeline-preferences',
      'pipeline-bind-group',
      'campaign-list',
      'campaign-create',
      'campaign-get',
      'campaign-videos',
      'campaign-update',
      'campaign-delete',
    ],
    routes: [
      '/api/v1/tasks',
      '/api/v1/tasks/:id',
      '/api/v1/tasks/timeline/:id',
      '/api/v1/content/style-preferences',
      '/api/v1/pipelines',
      '/api/v1/pipelines/:id',
      '/api/v1/pipelines/:id/preferences',
      '/api/v1/pipelines/:id/bind-group',
      '/api/v1/campaigns',
      '/api/v1/campaigns/:id',
      '/api/v1/campaigns/:id/videos',
    ],
  },
]

export function normalizeAgentCapabilities(capabilities: string[]) {
  const normalized = [...new Set(
    (capabilities || [])
      .map(item => item.trim())
      .filter(Boolean),
  )]

  return normalized.length > 0 ? normalized : [...DEFAULT_AGENT_CAPABILITIES]
}

export function buildCapabilityDiscovery(capabilities: string[]) {
  const normalized = normalizeAgentCapabilities(capabilities)
  const matchedTags = new Set(normalized)

  return SKILL_CAPABILITY_LAYERS.map(layer => ({
    ...layer,
    enabled: matchedTags.has(layer.capability)
      || matchedTags.has(layer.layer.toLowerCase())
      || layer.tags.some(tag => matchedTags.has(tag)),
  }))
}
