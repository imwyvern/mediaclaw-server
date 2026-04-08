import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Injectable, Logger } from '@nestjs/common'
import { PipelineType } from '@yikart/mongodb'
import { TemplateRuntimeConfig } from './template-runtime.types'

interface RawTemplateRuntimeConfig {
  templateId?: unknown
  name?: unknown
  description?: unknown
  version?: unknown
  category?: unknown
  type?: unknown
  estimatedTimeSec?: unknown
  estimatedCost?: unknown
  qualityStars?: unknown
  categories?: unknown
  styles?: unknown
  defaultParams?: unknown
  requiredInputs?: unknown
  optionalInputs?: unknown
  limitations?: unknown
  verifiedClients?: unknown
}

@Injectable()
export class TemplateRuntimeService {
  private readonly logger = new Logger(TemplateRuntimeService.name)

  async listTemplates() {
    const templatesRoot = await this.resolveTemplatesRoot()

    try {
      const entries = await readdir(templatesRoot, { withFileTypes: true })
      const templates = await Promise.all(
        entries
          .filter(entry => entry.isDirectory())
          .filter(entry => !entry.name.startsWith('.') && !entry.name.startsWith('_'))
          .map(entry => this.loadTemplate(entry.name, templatesRoot)),
      )

      return templates
        .filter((item): item is TemplateRuntimeConfig => Boolean(item))
        .sort((left, right) => left.templateId.localeCompare(right.templateId))
    }
    catch (error) {
      this.logger.warn(
        `Failed to read template runtime catalog from ${templatesRoot}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      return []
    }
  }

  async getTemplate(templateId: string) {
    const normalizedTemplateId = this.normalizeOptionalString(templateId)
    if (!normalizedTemplateId) {
      return null
    }

    return this.loadTemplate(normalizedTemplateId)
  }

  private async loadTemplate(templateId: string, templatesRoot?: string) {
    const normalizedTemplateId = this.normalizeOptionalString(templateId)
    if (!normalizedTemplateId || normalizedTemplateId.startsWith('_')) {
      return null
    }

    const resolvedTemplatesRoot = templatesRoot || (await this.resolveTemplatesRoot())
    const templateRoot = join(resolvedTemplatesRoot, normalizedTemplateId)
    const configPath = join(templateRoot, 'config.json')

    try {
      const rawConfig = JSON.parse(
        await readFile(configPath, 'utf8'),
      ) as RawTemplateRuntimeConfig

      return this.normalizeTemplateConfig(resolvedTemplatesRoot, normalizedTemplateId, rawConfig)
    }
    catch (error) {
      this.logger.warn(
        `Failed to load template config for ${normalizedTemplateId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      return null
    }
  }

  private normalizeTemplateConfig(
    templatesRoot: string,
    fallbackTemplateId: string,
    rawConfig: RawTemplateRuntimeConfig,
  ): TemplateRuntimeConfig {
    const templateId = this.normalizeOptionalString(rawConfig.templateId) || fallbackTemplateId
    const templateRoot = join(templatesRoot, templateId)
    const defaultParams = this.asRecord(rawConfig.defaultParams)

    return {
      templateId,
      name: this.normalizeOptionalString(rawConfig.name) || templateId,
      description: this.normalizeOptionalString(rawConfig.description),
      version: this.normalizeOptionalString(rawConfig.version) || '1.0',
      category: this.normalizeOptionalString(rawConfig.category) || 'custom',
      type: this.normalizePipelineType(rawConfig.type),
      estimatedTimeSec: this.normalizePositiveNumber(rawConfig.estimatedTimeSec),
      estimatedCost: this.normalizePositiveNumber(rawConfig.estimatedCost),
      qualityStars: this.normalizePositiveNumber(rawConfig.qualityStars),
      categories: this.normalizeStringList(rawConfig.categories),
      styles: this.normalizeStringList(rawConfig.styles),
      defaultParams: {
        duration: this.normalizePositiveNumber(defaultParams?.['duration']) || 15,
        aspectRatio: this.normalizeOptionalString(defaultParams?.['aspectRatio']) || '9:16',
        subtitleStyle: this.asRecord(defaultParams?.['subtitleStyle']) || {},
        musicStyle: this.normalizeOptionalString(defaultParams?.['musicStyle']),
        extra: this.asRecord(defaultParams?.['extra']) || {},
      },
      requiredInputs: this.normalizeStringList(rawConfig.requiredInputs),
      optionalInputs: this.normalizeStringList(rawConfig.optionalInputs),
      limitations: this.normalizeStringList(rawConfig.limitations),
      verifiedClients: this.normalizeStringList(rawConfig.verifiedClients),
      runtime: {
        entrypoint: join(templateRoot, 'run.py'),
        configPath: join(templateRoot, 'config.json'),
        readmePath: join(templateRoot, 'README.md'),
      },
    }
  }

  private async resolveTemplatesRoot() {
    let currentDir = process.cwd()

    for (let index = 0; index < 8; index += 1) {
      const candidate = join(currentDir, 'templates')
      if (await this.pathExists(candidate)) {
        return candidate
      }

      const parentDir = dirname(currentDir)
      if (parentDir === currentDir) {
        break
      }
      currentDir = parentDir
    }

    return join(process.cwd(), 'templates')
  }

  private normalizePipelineType(value: unknown) {
    const normalized = this.normalizeOptionalString(value)
    if (Object.values(PipelineType).includes(normalized as PipelineType)) {
      return normalized as PipelineType
    }

    return PipelineType.CUSTOM
  }

  private normalizePositiveNumber(value: unknown) {
    const normalized = Number(value || 0)
    return Number.isFinite(normalized) && normalized > 0
      ? Number(normalized)
      : 0
  }

  private normalizeStringList(value: unknown) {
    return Array.from(new Set(
      (Array.isArray(value) ? value : [])
        .map(item => this.normalizeOptionalString(item))
        .filter(Boolean),
    ))
  }

  private asRecord(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
  }

  private normalizeOptionalString(value: unknown) {
    return typeof value === 'string' && value.trim()
      ? value.trim()
      : ''
  }

  private async pathExists(path: string) {
    try {
      const target = await stat(path)
      return target.isDirectory()
    }
    catch {
      return false
    }
  }
}
