import { createHash, randomBytes } from 'node:crypto'
import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { ApiKey, normalizeUserRole, UserRole } from '@yikart/mongodb'
import { Model, Types } from 'mongoose'

interface CreateApiKeyInput {
  name: string
  orgId?: string | null
  permissions?: string[]
  expiresAt?: string | null
  role?: string | null
}

interface ValidateApiKeyInput {
  key?: string
  prefix?: string
}

@Injectable()
export class MediaClawApiKeyService {
  constructor(
    @InjectModel(ApiKey.name) private readonly apiKeyModel: Model<ApiKey>,
  ) {}

  async create(userId: string, input: CreateApiKeyInput) {
    if (!input.name?.trim()) {
      throw new BadRequestException('API key name is required')
    }

    const secret = randomBytes(16).toString('hex')
    const rawKey = `mc_live_${secret}`
    const hashedKey = this.hashKey(rawKey)
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null
    const role = normalizeUserRole(input.role, UserRole.EMPLOYEE)

    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      throw new BadRequestException('Invalid expiresAt value')
    }

    const apiKey = await this.apiKeyModel.create({
      userId,
      orgId: this.toObjectId(input.orgId),
      key: hashedKey,
      prefix: `mc_live_${secret.slice(0, 8)}`,
      name: input.name.trim(),
      permissions: input.permissions || [],
      role,
      lastUsedAt: null,
      expiresAt,
      isActive: true,
      keyHash: '',
    })

    return {
      id: apiKey._id.toString(),
      key: rawKey,
      prefix: apiKey.prefix,
      name: apiKey.name,
      permissions: apiKey.permissions,
      role: apiKey.role,
      expiresAt: apiKey.expiresAt,
      isActive: apiKey.isActive,
      createdAt: apiKey.createdAt,
    }
  }

  async list(userId: string) {
    return this.apiKeyModel.find({
      userId,
      isActive: true,
    })
      .sort({ createdAt: -1 })
      .exec()
  }

  async revoke(id: string, userId: string) {
    const record = await this.apiKeyModel.findOneAndUpdate(
      { _id: id, userId },
      { isActive: false },
      { new: true },
    ).exec()

    if (!record) {
      throw new NotFoundException('API key not found')
    }

    return {
      id: record._id.toString(),
      revoked: true,
    }
  }

  async validateOwnedKey(userId: string, input: ValidateApiKeyInput) {
    const rawKey = input.key?.trim()
    const prefix = input.prefix?.trim() || this.extractPrefix(rawKey)

    if (rawKey?.startsWith('mc_live_')) {
      const identity = await this.validate(rawKey)
      if (identity.id !== userId) {
        throw new UnauthorizedException('API key does not belong to current user')
      }

      const record = await this.apiKeyModel.findOne({
        userId,
        key: this.hashKey(rawKey),
      }).exec()

      return this.buildValidationResult(record)
    }

    if (!prefix) {
      throw new BadRequestException('key or prefix is required')
    }

    const record = await this.apiKeyModel.findOne({
      userId,
      prefix,
    }).sort({ createdAt: -1 }).exec()

    return this.buildValidationResult(record)
  }

  async validate(rawKey: string) {
    if (!rawKey.startsWith('mc_live_')) {
      throw new UnauthorizedException('Unsupported API key format')
    }

    const hashedKey = this.hashKey(rawKey)
    const record = await this.apiKeyModel.findOne({
      key: hashedKey,
      isActive: true,
      $or: [
        { expiresAt: null },
        { expiresAt: { $gt: new Date() } },
      ],
    }).exec()

    if (!record) {
      throw new UnauthorizedException('Invalid API key')
    }

    await this.apiKeyModel.findByIdAndUpdate(record._id, {
      lastUsedAt: new Date(),
    }).exec()

    return {
      id: record.userId,
      orgId: record.orgId?.toString() || null,
      permissions: record.permissions,
      role: normalizeUserRole(record.role, UserRole.EMPLOYEE),
      apiKeyId: record._id.toString(),
      authType: 'api_key',
    }
  }

  async revokeInternal(id: string) {
    await this.apiKeyModel.findByIdAndUpdate(id, {
      $set: { isActive: false },
    }).exec()
  }

  private hashKey(rawKey: string) {
    return createHash('sha256').update(rawKey).digest('hex')
  }

  private extractPrefix(rawKey?: string) {
    if (!rawKey) {
      return undefined
    }

    const match = rawKey.match(/^(mc_live_[a-z0-9]{8})/i)
    return match?.[1]
  }

  private buildValidationResult(record: ApiKey | null) {
    if (!record) {
      return {
        valid: false,
        message: 'API key not found',
      }
    }

    if (!record.isActive) {
      return {
        valid: false,
        message: 'API key has been revoked',
      }
    }

    if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) {
      return {
        valid: false,
        message: 'API key has expired',
      }
    }

    return {
      valid: true,
      message: 'API key is active',
      expiresAt: record.expiresAt,
      lastUsedAt: record.lastUsedAt,
    }
  }

  private toObjectId(value?: string | null) {
    if (!value || !Types.ObjectId.isValid(value)) {
      return null
    }
    return new Types.ObjectId(value)
  }
}
