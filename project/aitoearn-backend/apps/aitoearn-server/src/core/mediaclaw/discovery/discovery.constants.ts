import { TikHubPlatform } from '../acquisition/tikhub.service'

export const MEDIACLAW_DISCOVERY_QUEUE = 'mediaclaw_discovery'
export const MEDIACLAW_DISCOVERY_JOB = 'ingest-industry-pool'
export const MEDIACLAW_DISCOVERY_SCHEDULER = 'discovery-every-6-hours'
export const MEDIACLAW_DISCOVERY_CRON = '0 */6 * * *'

export const DEFAULT_DISCOVERY_INDUSTRIES = [
  '美妆',
  '食品饮料',
  '3C数码',
  '服装',
] as const

export const DEFAULT_DISCOVERY_PLATFORMS: TikHubPlatform[] = [
  'douyin',
  'xhs',
  'kuaishou',
  'bilibili',
]

export type DiscoveryTrigger = 'scheduled' | 'bootstrap' | 'manual'

export interface DiscoveryIngestionJobData {
  trigger: DiscoveryTrigger
  industries?: string[]
  platforms?: TikHubPlatform[]
  requestedAt?: string
  source?: string
}
