const { spawnSync } = require('node:child_process')
const path = require('node:path')

type CapabilityLayerId = 'L1' | 'L2' | 'L3' | 'L4'

interface CapabilityLayer {
  id: CapabilityLayerId
  title: string
  summary: string
  commands: string[]
  aliases: string[]
}

const CAPABILITY_LAYERS: CapabilityLayer[] = [
  {
    id: 'L1',
    title: '内容交付',
    summary: '列出我的视频、预览下载成片、查看交付待办。',
    commands: ['list', 'pending', 'preview', 'download', 'deliveries', 'confirm-delivery', 'task-list', 'task-status'],
    aliases: ['my-videos'],
  },
  {
    id: 'L2',
    title: '内容管理',
    summary: '编辑文案、标记已发布、提交反馈和管理品牌资产。',
    commands: ['approve', 'review', 'edit-copy', 'published', 'feedback', 'brand-list', 'brand-get', 'brand-update', 'brand-assets'],
    aliases: ['caption-update', 'mark-published'],
  },
  {
    id: 'L3',
    title: '数据查询',
    summary: '查看我的统计、竞品趋势和内容报表。',
    commands: ['stats', 'analytics-overview', 'analytics-content', 'analytics-top', 'analytics-seo', 'analytics-report', 'competitors-trending', 'audit-log'],
    aliases: ['my-stats', 'competitor-report'],
  },
  {
    id: 'L4',
    title: '生产控制',
    summary: '创建任务、调整风格、配置管线和 Campaign。',
    commands: ['create-task', 'task-update', 'task-cancel', 'task-retry', 'task-timeline', 'style-preferences', 'pipeline-list', 'pipeline-get', 'pipeline-create', 'pipeline-update', 'pipeline-preferences', 'pipeline-bind-group', 'campaign-list', 'campaign-create', 'campaign-get', 'campaign-videos', 'campaign-update', 'campaign-delete'],
    aliases: ['task-create', 'adjust-style'],
  },
]

const COMMAND_ALIASES: Record<string, string> = {
  'my-videos': 'list',
  'caption-update': 'edit-copy',
  'mark-published': 'published',
  'my-stats': 'stats',
  'competitor-report': 'competitors-trending',
  'task-create': 'create-task',
  'adjust-style': 'style-preferences',
}

function printHelp(layerId?: string) {
  const normalizedLayerId = layerId ? normalizeLayerId(layerId) : null
  const layers = normalizedLayerId
    ? CAPABILITY_LAYERS.filter(layer => layer.id === normalizedLayerId)
    : CAPABILITY_LAYERS

  if (normalizedLayerId && layers.length === 0) {
    throw new Error(`Unknown capability layer: ${layerId}`)
  }

  console.log('MediaClaw Client')
  console.log('')
  console.log('主入口: ./scripts/mediaclaw-client <command>')
  console.log('源码入口: ./scripts/mediaclaw-client.ts')
  console.log('底层传输: ./scripts/mc-api.sh <command>')
  console.log('')
  console.log('常用命令:')
  console.log('  help [L1|L2|L3|L4]')
  console.log('  capabilities')
  console.log('')

  for (const layer of layers) {
    console.log(`${layer.id} ${layer.title}`)
    console.log(`  ${layer.summary}`)
    console.log(`  commands: ${layer.commands.join(', ')}`)
    if (layer.aliases.length > 0) {
      console.log(`  aliases: ${layer.aliases.join(', ')}`)
    }
    console.log('')
  }
}

function printCapabilities(asJson: boolean) {
  if (asJson) {
    console.log(JSON.stringify(CAPABILITY_LAYERS, null, 2))
    return
  }

  printHelp()
}

function normalizeLayerId(value: string): CapabilityLayerId | null {
  const normalized = value.trim().toUpperCase()
  if (normalized === 'L1' || normalized === 'L2' || normalized === 'L3' || normalized === 'L4') {
    return normalized
  }

  return null
}

function resolveCommand(command: string) {
  return COMMAND_ALIASES[command] || command
}

function runTransport(command: string, args: string[]) {
  const helperPath = path.resolve(__dirname, 'mc-api.sh')
  const result = spawnSync('bash', [helperPath, command, ...args], {
    stdio: 'inherit',
    env: process.env,
  })

  if (result.error) {
    throw result.error
  }

  process.exit(result.status === null ? 1 : result.status)
}

function main() {
  const [command = 'help', ...args] = process.argv.slice(2)

  if (command === 'help' || command === '-h' || command === '--help') {
    printHelp(args[0])
    return
  }

  if (command === 'capabilities') {
    printCapabilities(args.includes('--json'))
    return
  }

  const maybeLayer = normalizeLayerId(command)
  if (maybeLayer) {
    printHelp(maybeLayer)
    return
  }

  runTransport(resolveCommand(command), args)
}

main()
