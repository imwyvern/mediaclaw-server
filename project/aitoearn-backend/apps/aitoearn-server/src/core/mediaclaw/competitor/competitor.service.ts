import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Competitor, ViralContent } from '@yikart/mongodb'
import { Model, Types } from 'mongoose'

@Injectable()
export class CompetitorService {
  constructor(
    @InjectModel(Competitor.name)
    private readonly competitorModel: Model<Competitor>,
    @InjectModel(ViralContent.name)
    private readonly viralContentModel: Model<ViralContent>,
  ) {}

  async addCompetitor(orgId: string, platform: string, accountUrl: string) {
    const normalizedOrgId = this.toObjectId(orgId, 'orgId')
    const normalizedPlatform = platform?.trim().toLowerCase()
    const normalizedUrl = accountUrl?.trim()

    if (!normalizedPlatform) {
      throw new BadRequestException('platform is required')
    }
    if (!normalizedUrl) {
      throw new BadRequestException('accountUrl is required')
    }

    const profile = this.parseAccountProfile(normalizedUrl)

    return this.competitorModel.findOneAndUpdate(
      {
        orgId: normalizedOrgId,
        platform: normalizedPlatform,
        accountUrl: normalizedUrl,
      },
      {
        $set: {
          accountId: profile.accountId,
          accountName: profile.accountName,
          lastSyncedAt: new Date(),
          isActive: true,
        },
        $setOnInsert: {
          orgId: normalizedOrgId,
          platform: normalizedPlatform,
          accountUrl: normalizedUrl,
          metrics: {
            followers: 0,
            avgViews: 0,
            avgLikes: 0,
            postFrequency: 0,
          },
        },
      },
      {
        new: true,
        upsert: true,
      },
    ).lean().exec()
  }

  async listCompetitors(orgId: string) {
    const competitors = await this.competitorModel
      .find({
        orgId: this.toObjectId(orgId, 'orgId'),
        isActive: true,
      })
      .sort({ lastSyncedAt: -1, createdAt: -1 })
      .lean()
      .exec()

    return competitors.map(item => ({
      id: item._id.toString(),
      orgId: item.orgId.toString(),
      platform: item.platform,
      accountId: item.accountId,
      accountName: item.accountName,
      accountUrl: item.accountUrl,
      metrics: item.metrics,
      lastSyncedAt: item.lastSyncedAt,
      isActive: item.isActive,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }))
  }

  async getIndustryHot(industry: string, platform?: string, period = '7d') {
    const query: Record<string, any> = {}
    const normalizedIndustry = industry?.trim()
    const normalizedPlatform = platform?.trim().toLowerCase()

    if (normalizedIndustry) {
      query['industry'] = normalizedIndustry
    }
    if (normalizedPlatform) {
      query['platform'] = normalizedPlatform
    }

    query['discoveredAt'] = {
      $gte: this.resolvePeriodStart(period),
    }

    const items = await this.viralContentModel
      .find(query)
      .sort({ viralScore: -1, discoveredAt: -1 })
      .limit(20)
      .lean()
      .exec()

    return {
      industry: normalizedIndustry || null,
      platform: normalizedPlatform || null,
      period,
      items: items.map(item => ({
        id: item._id.toString(),
        platform: item.platform,
        videoId: item.videoId,
        title: item.title,
        author: item.author,
        viralScore: item.viralScore,
        views: item.views,
        likes: item.likes,
        comments: item.comments,
        shares: item.shares,
        contentUrl: item.contentUrl,
        thumbnailUrl: item.thumbnailUrl,
        discoveredAt: item.discoveredAt,
      })),
    }
  }

  async removeCompetitor(orgId: string, id: string) {
    const competitor = await this.competitorModel
      .findOneAndUpdate(
        {
          _id: this.toObjectId(id, 'id'),
          orgId: this.toObjectId(orgId, 'orgId'),
        },
        { isActive: false },
        { new: true },
      )
      .lean()
      .exec()

    if (!competitor) {
      throw new NotFoundException('Competitor not found')
    }

    return {
      id: competitor._id.toString(),
      removed: true,
    }
  }

  private parseAccountProfile(accountUrl: string) {
    let pathname = accountUrl

    try {
      pathname = new URL(accountUrl).pathname
    }
    catch {
      pathname = accountUrl
    }

    const accountId = pathname
      .split('/')
      .map(segment => segment.trim())
      .filter(Boolean)
      .at(-1) || 'unknown'

    return {
      accountId,
      accountName: accountId.replace(/[-_]/g, ' '),
    }
  }

  private resolvePeriodStart(period: string) {
    const normalized = period?.trim().toLowerCase() || '7d'
    const now = Date.now()
    const periodMap: Record<string, number> = {
      '24h': 1,
      '7d': 7,
      '14d': 14,
      '30d': 30,
      'weekly': 7,
      'monthly': 30,
      'quarterly': 90,
    }

    const days = periodMap[normalized] || Number.parseInt(normalized, 10) || 7
    return new Date(now - (Math.max(1, days) * 24 * 60 * 60 * 1000))
  }

  private toObjectId(value: string, field: string) {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`${field} is invalid`)
    }

    return new Types.ObjectId(value)
  }
}
