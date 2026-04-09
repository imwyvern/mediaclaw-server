import { BadRequestException } from '@nestjs/common'
import { PipelineType } from '@yikart/mongodb'

export interface TemplateBrandContext {
  id: string
  name: string
  logo: string
  colors: string[]
  fonts: string[]
  slogans: string[]
  keywords: string[]
  referenceVideoUrl: string
  preferredDuration: number
  aspectRatio: string
}

export interface TemplateRunParams {
  brand: TemplateBrandContext
  params?: Record<string, unknown>
  pipelineName?: string
  description?: string
}

export interface TemplateRuntimeStage {
  name: string
  engine: string
  output: string
}

export interface TemplateRuntimeProfile {
  version: string
  estimatedCost: number
  estimatedDurationSec: number
  costMode: 'ai_video' | 'render_only'
  requiredInputs: string[]
  optionalInputs: string[]
  stages: TemplateRuntimeStage[]
  paramsSnapshot: Record<string, unknown>
}

export interface TemplateResult {
  templateId: string
  name: string
  description: string
  type: PipelineType
  styleConfig: Record<string, unknown>
  distributionRules: Record<string, unknown>
  preferences: Record<string, unknown>
  schedule?: Record<string, unknown>
  modelOverrides?: Record<string, unknown>
  runtime: TemplateRuntimeProfile
}

export abstract class BasePipelineTemplate {
  abstract readonly templateId: string
  abstract readonly type: PipelineType

  abstract run(params: TemplateRunParams): Promise<TemplateResult>

  protected asRecord(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {}
  }

  protected normalizeOptionalString(value: unknown) {
    return typeof value === 'string' && value.trim()
      ? value.trim()
      : ''
  }

  protected normalizeStringList(value: unknown) {
    return Array.from(new Set(
      (Array.isArray(value) ? value : [])
        .map(item => this.normalizeOptionalString(item))
        .filter(Boolean),
    ))
  }

  protected normalizePositiveNumber(value: unknown, fallback: number) {
    const normalized = Number(value)
    return Number.isFinite(normalized) && normalized > 0
      ? normalized
      : fallback
  }

  protected clampNumber(value: unknown, min: number, max: number, fallback: number) {
    const normalized = this.normalizePositiveNumber(value, fallback)
    return Math.min(Math.max(normalized, min), max)
  }

  protected requireString(value: unknown, field: string) {
    const normalized = this.normalizeOptionalString(value)
    if (!normalized) {
      throw new BadRequestException(`${field} is required`)
    }

    return normalized
  }

  protected requireStringList(value: unknown, field: string) {
    const normalized = this.normalizeStringList(value)
    if (normalized.length === 0) {
      throw new BadRequestException(`${field} is required`)
    }

    return normalized
  }

  protected createBrandAssets(brand: TemplateBrandContext) {
    return {
      logo: brand.logo,
      colors: [...brand.colors],
      fonts: [...brand.fonts],
    }
  }

  protected buildRuntimeProfile(
    paramsSnapshot: Record<string, unknown>,
    runtime: Omit<TemplateRuntimeProfile, 'paramsSnapshot'>,
  ): TemplateRuntimeProfile {
    return {
      ...runtime,
      paramsSnapshot,
    }
  }
}
