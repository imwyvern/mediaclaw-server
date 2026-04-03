import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import {
  OrgApiKeyProvider,
  Organization,
  OrganizationApiKeyEntry,
  OrganizationApiKeyMap,
} from '@yikart/mongodb'
import axios from 'axios'
import { Model, Types } from 'mongoose'
import { MediaclawConfigService } from '../mediaclaw-config.service'

type ConfigKeyInput = string | readonly string[]

interface SetApiKeyInput {
  provider: OrgApiKeyProvider
  key?: string
  apiKey?: string
  validateNow?: boolean
}

interface ValidationResult {
  isValid: boolean
  lastValidatedAt: Date
  message: string
}

const SUPPORTED_API_KEY_PROVIDERS = [
  OrgApiKeyProvider.KLING,
  OrgApiKeyProvider.GEMINI,
  OrgApiKeyProvider.DEEPSEEK,
  OrgApiKeyProvider.OPENAI,
  OrgApiKeyProvider.TIKHUB,
  OrgApiKeyProvider.VCE,
] as const

@Injectable()
export class ByokService {
  constructor(
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<Organization>,
    private readonly configService: MediaclawConfigService,
  ) {}

  async setApiKey(
    orgId: string,
    provider: OrgApiKeyProvider,
    plainKey: string,
    validateNow = true,
  ) {
    const organization = await this.findOrganization(orgId)
    const normalizedProvider = this.normalizeProvider(provider)
    const normalizedKey = plainKey.trim()

    if (!normalizedKey) {
      throw new BadRequestException('key is required')
    }

    const currentApiKeys = this.readApiKeyMap(organization.apiKeys)
    const validation = validateNow
      ? await this.safeValidateKey(normalizedProvider, normalizedKey)
      : {
          isValid: false,
          lastValidatedAt: new Date(),
          message: 'Validation skipped',
        }

    currentApiKeys[normalizedProvider] = {
      encryptedKey: this.encryptKey(normalizedKey),
      addedAt: currentApiKeys[normalizedProvider]?.addedAt || new Date(),
      lastUsedAt: currentApiKeys[normalizedProvider]?.lastUsedAt || null,
      isValid: validation.isValid,
      lastValidatedAt: validation.lastValidatedAt,
    }

    organization.set('apiKeys', currentApiKeys)
    await organization.save()

    return {
      orgId: organization._id.toString(),
      key: this.serializeApiKey(normalizedProvider, currentApiKeys[normalizedProvider], validation.message),
    }
  }

  async addKey(orgId: string, input: SetApiKeyInput) {
    return this.setApiKey(
      orgId,
      input.provider,
      input.key?.trim() || input.apiKey?.trim() || '',
      input.validateNow !== false,
    )
  }

  async getApiKey(orgId: string, provider: OrgApiKeyProvider) {
    return this.resolveApiKey(orgId, provider)
  }

  async getDecryptedKey(orgId: string, provider: OrgApiKeyProvider) {
    const organization = await this.findOrganization(orgId)
    const normalizedProvider = this.normalizeProvider(provider)
    const apiKeys = this.readApiKeyMap(organization.apiKeys)
    const current = apiKeys[normalizedProvider]

    if (!current?.encryptedKey) {
      return null
    }

    return this.decryptKey(current.encryptedKey)
  }

  async listApiKeys(orgId: string) {
    const organization = await this.findOrganization(orgId)
    const apiKeys = this.readApiKeyMap(organization.apiKeys)

    return {
      orgId: organization._id.toString(),
      keys: SUPPORTED_API_KEY_PROVIDERS.map(provider =>
        this.serializeApiKey(provider, apiKeys[provider]),
      ),
    }
  }

  async getKeyStatus(orgId: string, provider?: OrgApiKeyProvider) {
    if (!provider) {
      return this.listApiKeys(orgId)
    }

    const organization = await this.findOrganization(orgId)
    const normalizedProvider = this.normalizeProvider(provider)
    const apiKeys = this.readApiKeyMap(organization.apiKeys)

    return {
      orgId: organization._id.toString(),
      key: this.serializeApiKey(normalizedProvider, apiKeys[normalizedProvider]),
    }
  }

  async validateKey(orgId: string, provider: OrgApiKeyProvider) {
    const organization = await this.findOrganization(orgId)
    const normalizedProvider = this.normalizeProvider(provider)
    const apiKeys = this.readApiKeyMap(organization.apiKeys)
    const current = apiKeys[normalizedProvider]

    if (!current?.encryptedKey) {
      throw new NotFoundException('API key not found')
    }

    const validation = await this.safeValidateKey(normalizedProvider, this.decryptKey(current.encryptedKey))
    apiKeys[normalizedProvider] = {
      ...current,
      isValid: validation.isValid,
      lastValidatedAt: validation.lastValidatedAt,
    }

    organization.set('apiKeys', apiKeys)
    await organization.save()

    return {
      orgId: organization._id.toString(),
      key: this.serializeApiKey(normalizedProvider, apiKeys[normalizedProvider], validation.message),
    }
  }

  async removeApiKey(orgId: string, provider: OrgApiKeyProvider) {
    const organization = await this.findOrganization(orgId)
    const normalizedProvider = this.normalizeProvider(provider)
    const apiKeys = this.readApiKeyMap(organization.apiKeys)

    if (!apiKeys[normalizedProvider]) {
      throw new NotFoundException('API key not found')
    }

    delete apiKeys[normalizedProvider]
    organization.set('apiKeys', apiKeys)
    await organization.save()

    return {
      orgId: organization._id.toString(),
      provider: normalizedProvider,
      deleted: true,
    }
  }

  async removeKey(orgId: string, provider: OrgApiKeyProvider) {
    return this.removeApiKey(orgId, provider)
  }

  async resolveApiKey(
    orgId: string | null | undefined,
    provider: OrgApiKeyProvider,
    fallbackEnvName?: ConfigKeyInput,
  ) {
    const normalizedProvider = this.normalizeProvider(provider)

    if (orgId && Types.ObjectId.isValid(orgId)) {
      const organization = await this.organizationModel.findById(new Types.ObjectId(orgId)).exec()
      if (organization) {
        const apiKeys = this.readApiKeyMap(organization.apiKeys)
        const current = apiKeys[normalizedProvider]
        if (current?.encryptedKey) {
          const decrypted = this.decryptKey(current.encryptedKey)
          apiKeys[normalizedProvider] = {
            ...current,
            lastUsedAt: new Date(),
          }
          organization.set('apiKeys', apiKeys)
          await organization.save()
          return decrypted
        }
      }
    }

    return this.resolvePlatformDefaultKey(normalizedProvider, fallbackEnvName)
  }

  async getProviderRuntimeKey(
    orgId: string | null | undefined,
    provider: OrgApiKeyProvider,
    fallbackEnvName?: ConfigKeyInput,
  ) {
    return this.resolveApiKey(orgId, provider, fallbackEnvName)
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
    if (!SUPPORTED_API_KEY_PROVIDERS.includes(provider)) {
      throw new BadRequestException('Unsupported provider')
    }

    return provider
  }

  private readApiKeyMap(raw: unknown): OrganizationApiKeyMap {
    if (!raw) {
      return {}
    }

    if (Array.isArray(raw)) {
      const migrated: OrganizationApiKeyMap = {}
      for (const item of raw) {
        if (!item || typeof item !== 'object') {
          continue
        }

        const candidate = item as Record<string, unknown>
        const providerValue = candidate['provider']
        if (typeof providerValue !== 'string' || !SUPPORTED_API_KEY_PROVIDERS.includes(providerValue as OrgApiKeyProvider)) {
          continue
        }

        const entry = this.normalizeApiKeyEntry(candidate)
        if (entry) {
          migrated[providerValue as OrgApiKeyProvider] = entry
        }
      }
      return migrated
    }

    if (typeof raw !== 'object') {
      return {}
    }

    const map: OrganizationApiKeyMap = {}
    const payload = raw as Record<string, unknown>
    for (const provider of SUPPORTED_API_KEY_PROVIDERS) {
      const entry = payload[provider]
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        continue
      }

      const normalizedEntry = this.normalizeApiKeyEntry(entry as Record<string, unknown>)
      if (normalizedEntry) {
        map[provider] = normalizedEntry
      }
    }

    return map
  }

  private normalizeApiKeyEntry(raw: Record<string, unknown>): OrganizationApiKeyEntry | undefined {
    const encryptedKey = this.readString(raw['encryptedKey'])
    if (!encryptedKey) {
      return undefined
    }

    return {
      encryptedKey,
      addedAt: this.readDate(raw['addedAt']) || new Date(),
      lastUsedAt: this.readDate(raw['lastUsedAt']),
      isValid: typeof raw['isValid'] === 'boolean' ? raw['isValid'] : undefined,
      lastValidatedAt: this.readDate(raw['lastValidatedAt']),
    }
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
      case OrgApiKeyProvider.OPENAI:
      case OrgApiKeyProvider.TIKHUB:
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

  private resolvePlatformDefaultKey(provider: OrgApiKeyProvider, fallbackEnvName?: ConfigKeyInput) {
    const envCandidates = fallbackEnvName
      ? [...this.normalizeConfigKeys(fallbackEnvName), ...this.defaultFallbackEnvNames(provider)]
      : this.defaultFallbackEnvNames(provider)

    return this.configService.getString(envCandidates, '')
  }

  private defaultFallbackEnvNames(provider: OrgApiKeyProvider) {
    switch (provider) {
      case OrgApiKeyProvider.KLING:
        return ['KLING_API_KEY', 'MEDIACLAW_KLING_API_KEY']
      case OrgApiKeyProvider.GEMINI:
        return ['MEDIACLAW_GEMINI_API_KEY', 'GEMINI_API_KEY']
      case OrgApiKeyProvider.DEEPSEEK:
        return ['MEDIACLAW_DEEPSEEK_API_KEY', 'DEEPSEEK_API_KEY']
      case OrgApiKeyProvider.OPENAI:
        return ['OPENAI_API_KEY', 'MEDIACLAW_OPENAI_API_KEY']
      case OrgApiKeyProvider.TIKHUB:
        return ['TIKHUB_API_KEY', 'MEDIACLAW_TIKHUB_API_KEY']
      case OrgApiKeyProvider.VCE:
        return ['VCE_GEMINI_API_KEY', 'MEDIACLAW_VCE_API_KEY']
      default:
        return []
    }
  }

  private normalizeConfigKeys(keys: ConfigKeyInput) {
    return Array.isArray(keys) ? [...keys] : [keys]
  }

  private encryptKey(apiKey: string) {
    const key = this.resolveEncryptionKey()
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const encrypted = Buffer.concat([
      cipher.update(apiKey, 'utf8'),
      cipher.final(),
    ])
    const authTag = cipher.getAuthTag()

    return ['v2', iv.toString('base64'), authTag.toString('base64'), encrypted.toString('base64')].join(':')
  }

  private decryptKey(payload: string) {
    if (payload.startsWith('v2:')) {
      return this.decryptGcmPayload(payload)
    }

    return this.decryptLegacyPayload(payload)
  }

  private decryptGcmPayload(payload: string) {
    const segments = payload.split(':')
    if (segments.length !== 4) {
      throw new BadRequestException('Stored API key payload is invalid')
    }

    const [, ivBase64, authTagBase64, encryptedBase64] = segments
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.resolveEncryptionKey(),
      Buffer.from(ivBase64, 'base64'),
    )
    decipher.setAuthTag(Buffer.from(authTagBase64, 'base64'))

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedBase64, 'base64')),
      decipher.final(),
    ])

    return decrypted.toString('utf8')
  }

  private decryptLegacyPayload(payload: string) {
    const [ivBase64, encrypted] = payload.split(':')
    if (!ivBase64 || !encrypted) {
      throw new BadRequestException('Stored API key payload is invalid')
    }

    const secret = process.env['MEDIACLAW_BYOK_SECRET']?.trim()
    if (!secret) {
      throw new InternalServerErrorException('BYOK encryption not configured: set BYOK_ENCRYPTION_KEY')
    }

    const key = createHash('sha256').update(secret).digest()
    const decipher = createDecipheriv('aes-256-cbc', key, Buffer.from(ivBase64, 'base64'))
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64')),
      decipher.final(),
    ])

    return decrypted.toString('utf8')
  }

  private resolveEncryptionKey() {
    const configuredKey = process.env['BYOK_ENCRYPTION_KEY']?.trim()
    if (!configuredKey) {
      throw new InternalServerErrorException('BYOK encryption not configured: set BYOK_ENCRYPTION_KEY')
    }

    return this.normalizeEncryptionKey(configuredKey)
  }

  private normalizeEncryptionKey(input: string) {
    if (/^[a-fA-F0-9]{64}$/.test(input)) {
      return Buffer.from(input, 'hex')
    }

    const utf8Buffer = Buffer.from(input, 'utf8')
    if (utf8Buffer.length === 32) {
      return utf8Buffer
    }

    try {
      const base64Buffer = Buffer.from(input, 'base64')
      if (base64Buffer.length === 32 && base64Buffer.toString('base64').replace(/=+$/, '') === input.replace(/=+$/, '')) {
        return base64Buffer
      }
    }
    catch {
      // Ignore invalid base64 and fall back to hashing.
    }

    return createHash('sha256').update(input).digest()
  }

  private serializeApiKey(
    provider: OrgApiKeyProvider,
    apiKey: OrganizationApiKeyEntry | undefined,
    validationMessage?: string,
  ) {
    return {
      provider,
      hasKey: Boolean(apiKey?.encryptedKey),
      maskedKey: apiKey?.encryptedKey ? this.maskKey(this.decryptKey(apiKey.encryptedKey)) : null,
      isValid: Boolean(apiKey?.isValid),
      lastValidatedAt: apiKey?.lastValidatedAt || null,
      addedAt: apiKey?.addedAt || null,
      lastUsedAt: apiKey?.lastUsedAt || null,
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

  private readString(value: unknown) {
    return typeof value === 'string' ? value.trim() : ''
  }

  private readDate(value: unknown) {
    if (!value) {
      return null
    }

    const date = value instanceof Date ? value : new Date(String(value))
    return Number.isNaN(date.getTime()) ? null : date
  }
}
