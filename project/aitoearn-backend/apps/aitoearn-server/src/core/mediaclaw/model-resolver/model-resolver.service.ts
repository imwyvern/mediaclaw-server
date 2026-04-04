import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import {
  BillingMode,
  OrgApiKeyProvider,
  Organization,
  OrganizationApiKeyMap,
  OrganizationModelPreferenceKey,
  Pipeline,
  PipelineModelOverrides,
} from '@yikart/mongodb'
import { Model, Types } from 'mongoose'
import { MediaclawConfigService } from '../mediaclaw-config.service'

export type MediaClawModelCapability = OrganizationModelPreferenceKey
export type PipelineModelOverrideKey = keyof PipelineModelOverrides

export interface MediaClawModelOption {
  id: string
  label: string
  provider: OrgApiKeyProvider
  runtimeModel: string
  description: string
  available: boolean
  requiresApiKey: boolean
  lockedReason: string | null
  isDefault: boolean
}

export interface ResolvedMediaClawModel extends MediaClawModelOption {
  capability: MediaClawModelCapability
  source: 'default' | 'organization' | 'pipeline'
}

interface ModelOptionDefinition {
  id: string
  label: string
  provider: OrgApiKeyProvider
  description: string
  runtimeModel: string
  runtimeModelEnvKeys: readonly string[]
  fallbackEnvKeys: readonly string[]
  defaultOption?: boolean
}

type ModelCatalog = Record<MediaClawModelCapability, readonly ModelOptionDefinition[]>

const DEFAULT_MODEL_PREFERENCES: Record<MediaClawModelCapability, string> = {
  chat: 'deepseek-v3',
  copy: 'deepseek-v3',
  frameEdit: 'gemini-2.5-flash-image',
  videoGen: 'kling-v3-omni',
  analysis: 'deepseek-v3',
}

const MODEL_CATALOG: ModelCatalog = {
  chat: [
    {
      id: 'deepseek-v3',
      label: 'DeepSeek V3',
      provider: OrgApiKeyProvider.DEEPSEEK,
      description: '日常对话默认模型，成本低、响应快。',
      runtimeModel: 'deepseek-chat',
      runtimeModelEnvKeys: ['MEDIACLAW_DEEPSEEK_MODEL', 'DEEPSEEK_MODEL'],
      fallbackEnvKeys: ['MEDIACLAW_DEEPSEEK_API_KEY', 'DEEPSEEK_API_KEY'],
      defaultOption: true,
    },
    {
      id: 'gpt-4o',
      label: 'GPT-4o',
      provider: OrgApiKeyProvider.OPENAI,
      description: '复杂推理更强，需配置 OpenAI Key。',
      runtimeModel: 'gpt-4o',
      runtimeModelEnvKeys: ['MEDIACLAW_OPENAI_MODEL', 'OPENAI_MODEL'],
      fallbackEnvKeys: ['MEDIACLAW_OPENAI_API_KEY', 'OPENAI_API_KEY'],
    },
    {
      id: 'gemini-2.5-pro',
      label: 'Gemini 2.5 Pro',
      provider: OrgApiKeyProvider.GEMINI,
      description: '长上下文分析能力更强，需配置 Gemini Key。',
      runtimeModel: 'gemini-2.5-pro',
      runtimeModelEnvKeys: ['MEDIACLAW_GEMINI_PRO_MODEL'],
      fallbackEnvKeys: ['MEDIACLAW_GEMINI_API_KEY', 'GEMINI_API_KEY'],
    },
  ],
  copy: [
    {
      id: 'deepseek-v3',
      label: 'DeepSeek V3',
      provider: OrgApiKeyProvider.DEEPSEEK,
      description: '默认文案模型，适合高频生成。',
      runtimeModel: 'deepseek-chat',
      runtimeModelEnvKeys: ['MEDIACLAW_DEEPSEEK_MODEL', 'DEEPSEEK_MODEL'],
      fallbackEnvKeys: ['MEDIACLAW_DEEPSEEK_API_KEY', 'DEEPSEEK_API_KEY'],
      defaultOption: true,
    },
    {
      id: 'gpt-4o',
      label: 'GPT-4o',
      provider: OrgApiKeyProvider.OPENAI,
      description: '复杂文案改写更稳，需配置 OpenAI Key。',
      runtimeModel: 'gpt-4o',
      runtimeModelEnvKeys: ['MEDIACLAW_OPENAI_MODEL', 'OPENAI_MODEL'],
      fallbackEnvKeys: ['MEDIACLAW_OPENAI_API_KEY', 'OPENAI_API_KEY'],
    },
    {
      id: 'gemini-2.5-pro',
      label: 'Gemini 2.5 Pro',
      provider: OrgApiKeyProvider.GEMINI,
      description: '长文案结构化更强，需配置 Gemini Key。',
      runtimeModel: 'gemini-2.5-pro',
      runtimeModelEnvKeys: ['MEDIACLAW_GEMINI_PRO_MODEL'],
      fallbackEnvKeys: ['MEDIACLAW_GEMINI_API_KEY', 'GEMINI_API_KEY'],
    },
  ],
  frameEdit: [
    {
      id: 'gemini-2.5-flash-image',
      label: 'Gemini Flash Image',
      provider: OrgApiKeyProvider.VCE,
      description: '默认参考帧编辑模型。',
      runtimeModel: 'gemini-2.5-flash-image',
      runtimeModelEnvKeys: ['VCE_GEMINI_IMAGE_MODEL', 'MEDIACLAW_VCE_MODEL'],
      fallbackEnvKeys: ['VCE_GEMINI_API_KEY', 'MEDIACLAW_VCE_API_KEY'],
      defaultOption: true,
    },
    {
      id: 'gemini-2.5-pro',
      label: 'Gemini 2.5 Pro',
      provider: OrgApiKeyProvider.VCE,
      description: '更强的编辑理解能力，需可用的 VCE / Gemini 图像能力。',
      runtimeModel: 'gemini-2.5-pro',
      runtimeModelEnvKeys: ['MEDIACLAW_FRAME_EDIT_PRO_MODEL'],
      fallbackEnvKeys: ['VCE_GEMINI_API_KEY', 'MEDIACLAW_VCE_API_KEY'],
    },
  ],
  videoGen: [
    {
      id: 'kling-v3-omni',
      label: 'Kling V3 Omni',
      provider: OrgApiKeyProvider.KLING,
      description: '默认视频生成模型。',
      runtimeModel: 'kling-v3-omni',
      runtimeModelEnvKeys: ['KLING_MODEL', 'MEDIACLAW_KLING_MODEL'],
      fallbackEnvKeys: ['KLING_API_KEY', 'MEDIACLAW_KLING_API_KEY', 'VCE_GEMINI_API_KEY', 'MEDIACLAW_VCE_API_KEY'],
      defaultOption: true,
    },
  ],
  analysis: [
    {
      id: 'deepseek-v3',
      label: 'DeepSeek V3',
      provider: OrgApiKeyProvider.DEEPSEEK,
      description: '默认分析模型，适合爆款拆解和失败复盘。',
      runtimeModel: 'deepseek-chat',
      runtimeModelEnvKeys: ['MEDIACLAW_DEEPSEEK_MODEL', 'DEEPSEEK_MODEL'],
      fallbackEnvKeys: ['MEDIACLAW_DEEPSEEK_API_KEY', 'DEEPSEEK_API_KEY'],
      defaultOption: true,
    },
    {
      id: 'gpt-4o',
      label: 'GPT-4o',
      provider: OrgApiKeyProvider.OPENAI,
      description: '复杂失败分析更强，需配置 OpenAI Key。',
      runtimeModel: 'gpt-4o',
      runtimeModelEnvKeys: ['MEDIACLAW_OPENAI_MODEL', 'OPENAI_MODEL'],
      fallbackEnvKeys: ['MEDIACLAW_OPENAI_API_KEY', 'OPENAI_API_KEY'],
    },
    {
      id: 'gemini-2.5-pro',
      label: 'Gemini 2.5 Pro',
      provider: OrgApiKeyProvider.GEMINI,
      description: '长文本分析与总结更强，需配置 Gemini Key。',
      runtimeModel: 'gemini-2.5-pro',
      runtimeModelEnvKeys: ['MEDIACLAW_GEMINI_PRO_MODEL'],
      fallbackEnvKeys: ['MEDIACLAW_GEMINI_API_KEY', 'GEMINI_API_KEY'],
    },
  ],
}

@Injectable()
export class ModelResolverService {
  constructor(
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<Organization>,
    @InjectModel(Pipeline.name)
    private readonly pipelineModel: Model<Pipeline>,
    private readonly configService: MediaclawConfigService,
  ) {}

  async getOrganizationModelSettings(orgId: string) {
    const organization = await this.findOrganization(orgId)
    const normalizedPreferences = this.normalizePreferences(organization.modelPreferences)

    return {
      orgId: organization._id.toString(),
      billingMode: organization.billingMode,
      preferences: normalizedPreferences,
      availableModels: this.buildCapabilityMap(organization),
    }
  }

  async validateOrganizationPreferences(
    orgId: string,
    input: Partial<Record<MediaClawModelCapability, string | null | undefined>>,
  ) {
    const organization = await this.findOrganization(orgId)
    const currentPreferences = this.normalizePreferences(organization.modelPreferences)
    const nextPreferences = { ...currentPreferences }

    for (const capability of this.listCapabilities()) {
      const candidate = input[capability]
      if (typeof candidate !== 'string') {
        continue
      }

      const normalized = candidate.trim()
      if (!normalized) {
        nextPreferences[capability] = DEFAULT_MODEL_PREFERENCES[capability]
        continue
      }

      const option = this.findOptionDefinition(capability, normalized)
      if (!option) {
        throw new BadRequestException(`${capability} model is not supported`)
      }

      if (!this.isOptionAvailable(organization, option)) {
        throw new BadRequestException(`${option.label} 当前不可用，请先配置对应 API Key`)
      }

      nextPreferences[capability] = option.id
    }

    return nextPreferences
  }

  async validatePipelineOverrides(
    orgId: string,
    input: Partial<Record<PipelineModelOverrideKey, string | null | undefined>>,
  ) {
    const organization = await this.findOrganization(orgId)
    const sanitized: Partial<Record<PipelineModelOverrideKey, string>> = {}

    for (const capability of this.listPipelineOverrideCapabilities()) {
      if (!(capability in input)) {
        continue
      }

      const rawValue = input[capability]
      if (typeof rawValue !== 'string' || !rawValue.trim()) {
        sanitized[capability] = ''
        continue
      }

      const normalized = rawValue.trim()
      const option = this.findOptionDefinition(capability, normalized)
      if (!option) {
        throw new BadRequestException(`${capability} override is not supported`)
      }

      if (!this.isOptionAvailable(organization, option)) {
        throw new BadRequestException(`${option.label} 当前不可用，请先配置对应 API Key`)
      }

      sanitized[capability] = option.id
    }

    return sanitized
  }

  async resolveCapability(
    orgId: string,
    capability: MediaClawModelCapability,
    pipelineId?: string | null,
  ): Promise<ResolvedMediaClawModel> {
    const organization = await this.findOrganization(orgId)
    const defaultOption = this.getDefaultOption(capability)
    const organizationPreference = this.normalizePreferences(organization.modelPreferences)[capability]
    const pipelineOverride = await this.readPipelineOverride(orgId, pipelineId, capability)

    const candidates: Array<{ value: string, source: ResolvedMediaClawModel['source'] }> = []
    if (pipelineOverride) {
      candidates.push({ value: pipelineOverride, source: 'pipeline' })
    }
    candidates.push({ value: organizationPreference, source: 'organization' })
    candidates.push({ value: defaultOption.id, source: 'default' })

    for (const candidate of candidates) {
      const option = this.findOptionDefinition(capability, candidate.value)
      if (!option) {
        continue
      }

      if (!this.isOptionAvailable(organization, option)) {
        continue
      }

      return {
        ...this.toRuntimeOption(organization, option),
        capability,
        source: candidate.source,
      }
    }

    return {
      ...this.toRuntimeOption(organization, defaultOption),
      capability,
      source: 'default',
      available: false,
      lockedReason: '当前没有可用的模型密钥或平台默认密钥',
    }
  }

  isByokUnlimited(organization: Pick<Organization, 'billingMode'> | null | undefined) {
    return organization?.billingMode === BillingMode.BYOK
  }

  private buildCapabilityMap(organization: Organization) {
    return this.listCapabilities().reduce<Record<string, MediaClawModelOption[]>>((acc, capability) => {
      acc[capability] = MODEL_CATALOG[capability].map(option => this.toRuntimeOption(organization, option))
      return acc
    }, {})
  }

  private toRuntimeOption(organization: Organization, option: ModelOptionDefinition): MediaClawModelOption {
    const available = this.isOptionAvailable(organization, option)
    return {
      id: option.id,
      label: option.label,
      provider: option.provider,
      runtimeModel: this.resolveRuntimeModel(option),
      description: option.description,
      available,
      requiresApiKey: !option.defaultOption,
      lockedReason: available ? null : '需配置对应 API Key 或平台默认密钥',
      isDefault: Boolean(option.defaultOption),
    }
  }

  private resolveRuntimeModel(option: ModelOptionDefinition) {
    if (option.runtimeModelEnvKeys.length > 0) {
      const configured = this.configService.getString(option.runtimeModelEnvKeys, '')
      if (configured) {
        return configured
      }
    }

    return option.runtimeModel
  }

  private isOptionAvailable(organization: Organization, option: ModelOptionDefinition) {
    const apiKeys = this.readApiKeyMap(organization.apiKeys)
    const hasOrgKey = Boolean(apiKeys[option.provider]?.encryptedKey)
    const hasPlatformDefault = this.configService.has(option.fallbackEnvKeys)
    return hasOrgKey || hasPlatformDefault
  }

  private readApiKeyMap(raw: unknown) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return {} as OrganizationApiKeyMap
    }

    return raw as OrganizationApiKeyMap
  }

  private normalizePreferences(raw: Partial<Record<MediaClawModelCapability, string>> | null | undefined) {
    const value = raw && typeof raw === 'object' ? raw : {}
    return this.listCapabilities().reduce<Record<MediaClawModelCapability, string>>((acc, capability) => {
      const candidate = typeof value[capability] === 'string' ? value[capability]?.trim() || '' : ''
      acc[capability] = candidate || DEFAULT_MODEL_PREFERENCES[capability]
      return acc
    }, {
      chat: DEFAULT_MODEL_PREFERENCES.chat,
      copy: DEFAULT_MODEL_PREFERENCES.copy,
      frameEdit: DEFAULT_MODEL_PREFERENCES.frameEdit,
      videoGen: DEFAULT_MODEL_PREFERENCES.videoGen,
      analysis: DEFAULT_MODEL_PREFERENCES.analysis,
    })
  }

  private getDefaultOption(capability: MediaClawModelCapability) {
    const option = MODEL_CATALOG[capability].find(item => item.defaultOption) || MODEL_CATALOG[capability][0]
    if (!option) {
      throw new BadRequestException(`${capability} model catalog is empty`)
    }

    return option
  }

  private findOptionDefinition(capability: MediaClawModelCapability, id: string) {
    return MODEL_CATALOG[capability].find(option => option.id === id) || null
  }

  private async readPipelineOverride(
    orgId: string,
    pipelineId: string | null | undefined,
    capability: MediaClawModelCapability,
  ) {
    if (!pipelineId || !this.isPipelineOverrideCapability(capability) || !Types.ObjectId.isValid(pipelineId)) {
      return ''
    }

    const pipeline = await this.pipelineModel.findOne({
      _id: new Types.ObjectId(pipelineId),
      orgId: new Types.ObjectId(orgId),
    }, {
      modelOverrides: 1,
    }).lean().exec()

    const overrides = pipeline?.modelOverrides
    const candidate = overrides && typeof overrides === 'object'
      ? overrides[capability]
      : ''

    return typeof candidate === 'string' ? candidate.trim() : ''
  }

  private async findOrganization(orgId: string) {
    if (!Types.ObjectId.isValid(orgId)) {
      throw new BadRequestException('orgId is invalid')
    }

    const organization = await this.organizationModel.findById(new Types.ObjectId(orgId)).exec()
    if (!organization) {
      throw new NotFoundException('Organization not found')
    }

    return organization
  }

  private isPipelineOverrideCapability(capability: MediaClawModelCapability): capability is PipelineModelOverrideKey {
    return capability === 'copy' || capability === 'frameEdit' || capability === 'videoGen'
  }

  private listCapabilities(): MediaClawModelCapability[] {
    return ['chat', 'copy', 'frameEdit', 'videoGen', 'analysis']
  }

  private listPipelineOverrideCapabilities(): PipelineModelOverrideKey[] {
    return ['copy', 'frameEdit', 'videoGen']
  }
}
