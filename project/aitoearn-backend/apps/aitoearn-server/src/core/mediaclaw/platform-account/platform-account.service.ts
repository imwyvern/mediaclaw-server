import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import {
  PlatformAccount,
  PlatformAccountPlatform,
  PlatformAccountStatus,
  PublishRecord,
} from '@yikart/mongodb'
import { Model, Types } from 'mongoose'
import { getRequiredEnv } from '../mediaclaw-env.util'

interface PaginationInput {
  page?: number
  limit?: number
}

@Injectable()
export class PlatformAccountService {
  constructor(
    @InjectModel(PlatformAccount.name)
    private readonly platformAccountModel: Model<PlatformAccount>,
    @InjectModel(PublishRecord.name)
    private readonly publishRecordModel: Model<PublishRecord>,
  ) {}

  async addAccount(
    orgId: string,
    platform: PlatformAccountPlatform,
    credentials: Record<string, any>,
  ) {
    const accountId = this.pickString(credentials, ['accountId', 'uid', 'id'])
    if (!accountId) {
      throw new BadRequestException('accountId is required')
    }

    const accountName = this.pickString(credentials, ['accountName', 'nickname', 'name'])
      || `${platform}-${accountId}`
    const avatarUrl = this.pickString(credentials, ['avatarUrl', 'avatar', 'avatar_url']) || ''

    const account = await this.platformAccountModel.findOneAndUpdate(
      {
        orgId: new Types.ObjectId(orgId),
        platform,
        accountId,
      },
      {
        $set: {
          accountName,
          avatarUrl,
          credentials: this.encryptCredentials(credentials),
          status: PlatformAccountStatus.ACTIVE,
        },
        $setOnInsert: {
          orgId: new Types.ObjectId(orgId),
          platform,
          accountId,
          metrics: {
            followers: 0,
            totalViews: 0,
            avgEngagement: 0,
          },
          lastSyncedAt: null,
        },
      },
      {
        upsert: true,
        new: true,
      },
    ).lean().exec()

    return this.toResponse(account, { includeEncryptedCredentials: true })
  }

  async listAccounts(orgId: string) {
    const accounts = await this.platformAccountModel.find({
      orgId: new Types.ObjectId(orgId),
    }).sort({ createdAt: -1 }).lean().exec()

    return accounts.map(account => this.toResponse(account))
  }

  async getAccount(orgId: string, id: string) {
    const account = await this.findAccount(orgId, id)
    return this.toResponse(account)
  }

  async syncMetrics(orgId: string, accountId: string) {
    const account = await this.findAccount(orgId, accountId)
    const nextFollowers = (account.metrics?.followers || 0) + 100
    const nextViews = (account.metrics?.totalViews || 0) + 1000
    const nextEngagement = Number((((account.metrics?.avgEngagement || 2.5) + 0.3)).toFixed(2))

    const updated = await this.platformAccountModel.findByIdAndUpdate(
      account._id,
      {
        metrics: {
          followers: nextFollowers,
          totalViews: nextViews,
          avgEngagement: nextEngagement,
        },
        lastSyncedAt: new Date(),
      },
      { new: true },
    ).lean().exec()

    return this.toResponse(updated)
  }

  async removeAccount(orgId: string, id: string) {
    const deleted = await this.platformAccountModel.findOneAndDelete(this.buildOwnedQuery(orgId, id)).lean().exec()
    if (!deleted) {
      throw new NotFoundException('Platform account not found')
    }

    return {
      id,
      deleted: true,
    }
  }

  async getPublishHistory(orgId: string, accountId: string, pagination: PaginationInput) {
    const account = await this.findAccount(orgId, accountId)
    const page = Math.max(Number(pagination.page || 1), 1)
    const limit = Math.min(Math.max(Number(pagination.limit || 20), 1), 100)
    const skip = (page - 1) * limit

    const query = {
      accountId: account.accountId,
    }

    const [items, total] = await Promise.all([
      this.publishRecordModel.find(query)
        .sort({ publishTime: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.publishRecordModel.countDocuments(query),
    ])

    return {
      account: this.toResponse(account),
      items: items.map(item => ({
        id: item.id || item._id?.toString() || '',
        title: item.title || '',
        desc: item.desc || '',
        status: item.status,
        publishTime: item.publishTime,
        videoUrl: item.videoUrl || '',
        coverUrl: item.coverUrl || '',
        workLink: item.workLink || '',
      })),
      total,
      page,
      limit,
    }
  }

  private async findAccount(orgId: string, id: string) {
    const query = Types.ObjectId.isValid(id)
      ? this.buildOwnedQuery(orgId, id)
      : { accountId: id, orgId: new Types.ObjectId(orgId) }
    const account = await this.platformAccountModel.findOne(query).lean().exec()

    if (!account) {
      throw new NotFoundException('Platform account not found')
    }

    return account
  }

  private buildOwnedQuery(orgId: string, id: string) {
    return {
      _id: new Types.ObjectId(id),
      orgId: new Types.ObjectId(orgId),
    }
  }

  private encryptCredentials(credentials: Record<string, any>) {
    const secret = getRequiredEnv('MEDIACLAW_PLATFORM_ACCOUNT_SECRET')
    const key = createHash('sha256').update(secret).digest()
    const iv = randomBytes(16)
    const cipher = createCipheriv('aes-256-cbc', key, iv)
    const payload = JSON.stringify(credentials || {})
    const encrypted = Buffer.concat([
      cipher.update(payload, 'utf8'),
      cipher.final(),
    ]).toString('base64')

    return {
      algorithm: 'aes-256-cbc',
      iv: iv.toString('base64'),
      encryptedData: encrypted,
    }
  }

  private pickString(source: Record<string, any>, keys: string[]) {
    for (const key of keys) {
      const value = source?.[key]
      if (typeof value === 'string' && value.trim()) {
        return value.trim()
      }
    }

    return ''
  }

  private toResponse(account: {
    _id: { toString: () => string }
    orgId: { toString: () => string }
    platform: PlatformAccountPlatform
    accountId: string
    accountName: string
    avatarUrl: string
    credentials?: Record<string, any>
    status: PlatformAccountStatus
    metrics?: {
      followers?: number
      totalViews?: number
      avgEngagement?: number
    }
    lastSyncedAt: Date | null
    createdAt?: Date
    updatedAt?: Date
  } | null, options?: { includeEncryptedCredentials?: boolean }) {
    if (!account) {
      throw new NotFoundException('Platform account not found')
    }

    return {
      id: account._id.toString(),
      orgId: account.orgId.toString(),
      platform: account.platform,
      accountId: account.accountId,
      accountName: account.accountName,
      avatarUrl: account.avatarUrl,
      ...(options?.includeEncryptedCredentials ? { credentials: account.credentials || null } : {}),
      hasCredentials: Boolean(account.credentials && Object.keys(account.credentials).length > 0),
      status: account.status,
      metrics: {
        followers: account.metrics?.followers || 0,
        totalViews: account.metrics?.totalViews || 0,
        avgEngagement: account.metrics?.avgEngagement || 0,
      },
      lastSyncedAt: account.lastSyncedAt,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    }
  }
}
