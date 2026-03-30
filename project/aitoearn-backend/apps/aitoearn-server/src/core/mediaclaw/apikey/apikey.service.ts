import { createHash, randomBytes } from 'node:crypto'
import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { ApiKey } from '@yikart/mongodb'

interface CreateApiKeyInput {
  name: string
  orgId?: string | null
  permissions?: string[]
  expiresAt?: string | null
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
      apiKeyId: record._id.toString(),
      authType: 'api_key',
    }
  }

  private hashKey(rawKey: string) {
    return createHash('sha256').update(rawKey).digest('hex')
  }

  private toObjectId(value?: string | null) {
    if (!value || !Types.ObjectId.isValid(value)) {
      return null
    }
    return new Types.ObjectId(value)
  }
}
