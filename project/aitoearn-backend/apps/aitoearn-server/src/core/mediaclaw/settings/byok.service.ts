import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { OrgApiKeyProvider, Organization } from '@yikart/mongodb'
import axios from 'axios'
import { Model, Types } from 'mongoose'
import { MediaclawConfigService } from '../mediaclaw-config.service'
import { getRequiredEnv } from '../mediaclaw-env.util'

interface AddApiKeyInput {
  provider: OrgApiKeyProvider
  apiKey: string
  validateNow?: boolean
}

interface ValidationResult {
  isValid: boolean
  lastValidatedAt: Date
  message: string
}

@Injectable()
export class ByokService {
  constructor(
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<Organization>,
    private readonly configService: MediaclawConfigService,
  ) {}

  async addKey(orgId: string, input: AddApiKeyInput) {
    const organization = await this.findOrganization(orgId)
    const provider = this.normalizeProvider(input.provider)
    const apiKey = input.apiKey?.trim()

    if (!apiKey) {
      throw new BadRequestException('apiKey is required')
    }

    const validation = input.validateNow === false
      ? {
          isValid: false,
          lastValidatedAt: new Date(),
          message: 'Validation skipped',
        }
      : await this.safeValidateKey(provider, apiKey)

    const nextApiKeys = (organization.apiKeys || []).filter(item => item.provider !== provider)
    nextApiKeys.push({
      provider,
      encryptedKey: this.encryptKey(apiKey),
      isValid: validation.isValid,
      lastValidatedAt: validation.lastValidatedAt,
      addedAt: new Date(),
    } as any)

    organization.apiKeys = nextApiKeys as any
    await organization.save()

    return {
      orgId: organization._id.toString(),
      ...this.serializeApiKey(nextApiKeys.find(item => item.provider === provider), validation.message),
    }
  }

  async validateKey(orgId: string, provider: OrgApiKeyProvider) {
    const organization = await this.findOrganization(orgId)
    const normalizedProvider = this.normalizeProvider(provider)
    const current = (organization.apiKeys || []).find(item => item.provider === normalizedProvider)

    if (!current) {
      throw new NotFoundException('API key not found')
    }

    const validation = await this.safeValidateKey(normalizedProvider, this.decryptKey(current.encryptedKey))
    const nextApiKeys = (organization.apiKeys || []).map((item) => {
      if (item.provider !== normalizedProvider) {
        return item
      }

      return {
        ...item,
        isValid: validation.isValid,
        lastValidatedAt: validation.lastValidatedAt,
      }
    })

    organization.apiKeys = nextApiKeys as any
    await organization.save()

    return {
      orgId: organization._id.toString(),
      ...this.serializeApiKey(nextApiKeys.find(item => item.provider === normalizedProvider), validation.message),
    }
  }

  async getKeyStatus(orgId: string, provider?: OrgApiKeyProvider) {
    const organization = await this.findOrganization(orgId)
    const keys = organization.apiKeys || []

    if (provider) {
      const current = keys.find(item => item.provider === this.normalizeProvider(provider))
      if (!current) {
        throw new NotFoundException('API key not found')
      }

      return {
        orgId: organization._id.toString(),
        key: this.serializeApiKey(current),
      }
    }

    return {
      orgId: organization._id.toString(),
      keys: keys.map(item => this.serializeApiKey(item)),
    }
  }

  async getKey(orgId: string, provider?: OrgApiKeyProvider) {
    return this.getKeyStatus(orgId, provider)
  }

  async getProviderRuntimeKey(
    orgId: string | null | undefined,
    provider: OrgApiKeyProvider,
    fallbackEnvName?: string | readonly string[],
  ) {
    if (orgId && Types.ObjectId.isValid(orgId)) {
      try {
        const key = await this.getDecryptedKey(orgId, provider)
        if (key?.trim()) {
          return key.trim()
        }
      }
      catch {
        // Ignore missing org-scoped keys and fall back to platform defaults.
      }
    }

    return fallbackEnvName ? this.configService.getString(fallbackEnvName, '') : ''
  }

  async getDecryptedKey(orgId: string, provider: OrgApiKeyProvider) {
    const organization = await this.findOrganization(orgId)
    const current = (organization.apiKeys || []).find(item => item.provider === this.normalizeProvider(provider))

    if (!current?.encryptedKey) {
      return null
    }

    return this.decryptKey(current.encryptedKey)
  }

  async removeKey(orgId: string, provider: OrgApiKeyProvider) {
    const organization = await this.findOrganization(orgId)
    const normalizedProvider = this.normalizeProvider(provider)
    const nextApiKeys = (organization.apiKeys || []).filter(item => item.provider !== normalizedProvider)

    if (nextApiKeys.length === (organization.apiKeys || []).length) {
      throw new NotFoundException('API key not found')
    }

    organization.apiKeys = nextApiKeys as any
    await organization.save()

    return {
      orgId: organization._id.toString(),
      provider: normalizedProvider,
      deleted: true,
    }
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

  private normalizeProvider(provider: OrgApiKeyProvider) {
    if (!Object.values(OrgApiKeyProvider).includes(provider)) {
      throw new BadRequestException('Unsupported provider')
    }

    return provider
  }

  private async safeValidateKey(provider: OrgApiKeyProvider, apiKey: string): Promise<ValidationResult> {
    try {
      return await this.validateAgainstProvider(provider, apiKey)
    }
    catch (error) {
      return {
        isValid: false,
        lastValidatedAt: new Date(),
        message: error instanceof Error ? error.message : 'Validation failed',
      }
    }
  }

  private async validateAgainstProvider(provider: OrgApiKeyProvider, apiKey: string): Promise<ValidationResult> {
    switch (provider) {
      case OrgApiKeyProvider.DEEPSEEK:
        return this.validateDeepSeek(apiKey)
      case OrgApiKeyProvider.GEMINI:
        return this.validateGemini(apiKey)
      case OrgApiKeyProvider.KLING:
      case OrgApiKeyProvider.VCE:
        return {
          isValid: apiKey.length >= 16,
          lastValidatedAt: new Date(),
          message: apiKey.length >= 16 ? 'Key format validated' : 'Key format is invalid',
        }
      default:
        throw new BadRequestException('Unsupported provider')
    }
  }

  private async validateDeepSeek(apiKey: string): Promise<ValidationResult> {
    const baseUrl = this.configService.getString(
      ['MEDIACLAW_DEEPSEEK_BASE_URL', 'DEEPSEEK_BASE_URL'],
      'https://api.deepseek.com',
    )
    const model = this.configService.getString(
      ['MEDIACLAW_DEEPSEEK_MODEL', 'DEEPSEEK_MODEL'],
      'deepseek-chat',
    )

    await axios.post(
      `${baseUrl.replace(/\/+$/, '')}/chat/completions`,
      {
        model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        temperature: 0,
      },
      {
        timeout: 8000,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      },
    )

    return {
      isValid: true,
      lastValidatedAt: new Date(),
      message: 'DeepSeek key validated',
    }
  }

  private async validateGemini(apiKey: string): Promise<ValidationResult> {
    const baseUrl = this.configService.getString(
      ['MEDIACLAW_GEMINI_BASE_URL', 'GEMINI_BASE_URL'],
      'https://generativelanguage.googleapis.com/v1beta',
    )
    const model = this.configService.getString(
      ['MEDIACLAW_GEMINI_MODEL', 'GEMINI_MODEL'],
      'gemini-2.5-flash',
    )

    await axios.post(
      `${baseUrl.replace(/\/+$/, '')}/models/${model}:generateContent?key=${apiKey}`,
      {
        contents: [
          {
            role: 'user',
            parts: [{ text: 'ping' }],
          },
        ],
        generationConfig: {
          maxOutputTokens: 1,
          temperature: 0,
        },
      },
      {
        timeout: 8000,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    )

    return {
      isValid: true,
      lastValidatedAt: new Date(),
      message: 'Gemini key validated',
    }
  }

  private encryptKey(apiKey: string) {
    const secret = getRequiredEnv('MEDIACLAW_BYOK_SECRET')
    const key = createHash('sha256').update(secret).digest()
    const iv = randomBytes(16)
    const cipher = createCipheriv('aes-256-cbc', key, iv)
    const encrypted = Buffer.concat([
      cipher.update(apiKey, 'utf8'),
      cipher.final(),
    ]).toString('base64')

    return `${iv.toString('base64')}:${encrypted}`
  }

  private decryptKey(payload: string) {
    const [ivBase64, encrypted] = payload.split(':')
    if (!ivBase64 || !encrypted) {
      throw new BadRequestException('Stored API key payload is invalid')
    }

    const secret = getRequiredEnv('MEDIACLAW_BYOK_SECRET')
    const key = createHash('sha256').update(secret).digest()
    const decipher = createDecipheriv('aes-256-cbc', key, Buffer.from(ivBase64, 'base64'))
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64')),
      decipher.final(),
    ])

    return decrypted.toString('utf8')
  }

  private serializeApiKey(
    apiKey: {
      provider: OrgApiKeyProvider
      encryptedKey?: string
      isValid?: boolean
      lastValidatedAt?: Date | null
      addedAt?: Date | null
    } | undefined,
    validationMessage?: string,
  ) {
    if (!apiKey) {
      throw new NotFoundException('API key not found')
    }

    return {
      provider: apiKey.provider,
      hasKey: Boolean(apiKey.encryptedKey),
      maskedKey: apiKey.encryptedKey ? this.maskKey(this.decryptKey(apiKey.encryptedKey)) : null,
      isValid: Boolean(apiKey.isValid),
      lastValidatedAt: apiKey.lastValidatedAt || null,
      addedAt: apiKey.addedAt || null,
      validationMessage: validationMessage || null,
    }
  }

  private maskKey(apiKey: string) {
    const trimmed = apiKey.trim()
    if (!trimmed) {
      return '****'
    }

    return `****${trimmed.slice(-4)}`
  }
}
