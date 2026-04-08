import { PipelineType } from '@yikart/mongodb'

export interface TemplateRunParams {
  accountId: string
  brandAssets: Record<string, unknown>
  firstFrameUrl?: string
  referenceVideoUrl?: string
  styleRewrite?: boolean
  extra?: Record<string, unknown>
}

export interface TemplateRunResult {
  status: 'success' | 'failed'
  videoUrl: string
  coverUrl: string
  title: string
  copy: Record<string, unknown>
  cost: number
  durationSec: number
  error?: string | null
}

export interface TemplateRuntimeConfig {
  templateId: string
  name: string
  description: string
  version: string
  category: string
  type: PipelineType
  estimatedTimeSec: number
  estimatedCost: number
  qualityStars: number
  categories: string[]
  styles: string[]
  defaultParams: {
    duration: number
    aspectRatio: string
    subtitleStyle: Record<string, unknown>
    musicStyle: string
    extra: Record<string, unknown>
  }
  requiredInputs: string[]
  optionalInputs: string[]
  limitations: string[]
  verifiedClients: string[]
  runtime: {
    entrypoint: string
    configPath: string
    readmePath: string
  }
}
