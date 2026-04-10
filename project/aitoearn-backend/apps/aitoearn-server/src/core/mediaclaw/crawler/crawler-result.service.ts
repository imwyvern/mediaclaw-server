import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { CrawlerResult } from '@yikart/mongodb'
import { Model, Types } from 'mongoose'
import {
  CrawlCreatorProfileRecord,
  CrawlerStoredResult,
  CrawlJobData,
  CrawlSeedResult,
} from './crawler.types'

type Identifier = Types.ObjectId | string | { toString: () => string }

type LeanCrawlerResult = CrawlerResult & {
  _id: Identifier
  orgId?: Identifier | null
  competitorId?: Identifier | null
}

@Injectable()
export class CrawlerResultService {
  constructor(
    @InjectModel(CrawlerResult.name)
    private readonly crawlerResultModel: Model<CrawlerResult>,
  ) {}

  async recordQueued(jobId: string, data: CrawlJobData) {
    await this.crawlerResultModel
      .findOneAndUpdate(
        { jobId },
        {
          $set: {
            jobId,
            crawlType: data.crawlType,
            status: 'queued',
            platform: data.platform,
            keyword: data.keyword,
            depth: data.depth,
            resultLimit: data.resultLimit,
            industry: data.industry,
            keywords: data.keywords,
            source: data.source,
            routeMode: data.route?.mode || '',
            targetId: data.videoId || data.creatorId || '',
            targetUrl: data.videoUrl || data.accountUrl || '',
            creatorId: data.creatorId || '',
            orgId: this.toObjectIdOrNull(data.orgId),
            competitorId: this.toObjectIdOrNull(data.competitorId),
            route: data.route as unknown as Record<string, unknown> | null,
            seededResults: data.seedResults.map(item => this.toSeedSnapshot(item)),
            updatedAt: new Date(),
          },
          $setOnInsert: {
            comments: [],
            creatorProfile: null,
            recentPosts: [],
            contentIds: [],
            persisted: null,
            supplementalDispatch: null,
            supplementalPersisted: null,
            analysisItems: [],
            error: '',
            completedAt: null,
          },
        },
        {
          upsert: true,
          new: true,
        },
      )
      .exec()
  }

  async recordCompleted(jobId: string, payload: Partial<CrawlerStoredResult>) {
    await this.crawlerResultModel
      .findOneAndUpdate(
        { jobId },
        {
          $set: {
            status: 'completed',
            targetId: payload.targetId || '',
            targetUrl: payload.targetUrl || '',
            creatorId: payload.creatorId || '',
            comments: payload.comments || [],
            creatorProfile: payload.creatorProfile || null,
            recentPosts: (payload.recentPosts || []).map(item => this.toSearchSnapshot(item)),
            contentIds: payload.contentIds || [],
            persisted: payload.persisted || null,
            supplementalDispatch: payload.supplementalDispatch || null,
            supplementalPersisted: payload.supplementalPersisted || null,
            analysisItems: payload.analysisItems || [],
            error: '',
            completedAt: new Date(),
            updatedAt: new Date(),
          },
        },
        {
          new: true,
        },
      )
      .exec()
  }

  async recordFailed(jobId: string, error: string) {
    await this.crawlerResultModel
      .findOneAndUpdate(
        { jobId },
        {
          $set: {
            status: 'failed',
            error,
            completedAt: new Date(),
            updatedAt: new Date(),
          },
        },
        {
          new: true,
        },
      )
      .exec()
  }

  async getByJobId(jobId: string): Promise<CrawlerStoredResult | null> {
    const result = await this.crawlerResultModel
      .findOne({ jobId })
      .lean()
      .exec() as unknown as LeanCrawlerResult | null

    if (!result) {
      return null
    }

    return {
      jobId: result.jobId,
      crawlType: result.crawlType as CrawlerStoredResult['crawlType'],
      status: result.status,
      platform: result.platform,
      keyword: result.keyword,
      depth: result.depth,
      resultLimit: result.resultLimit,
      industry: result.industry,
      keywords: result.keywords || [],
      source: result.source,
      routeMode: result.routeMode || '',
      targetId: result.targetId || '',
      targetUrl: result.targetUrl || '',
      creatorId: result.creatorId || '',
      orgId: result.orgId ? result.orgId.toString() : null,
      competitorId: result.competitorId ? result.competitorId.toString() : null,
      route: result.route || null,
      seededResults: (result.seededResults || []).map(item => this.normalizeStoredSeed(item as any)),
      comments: result.comments || [],
      creatorProfile: result.creatorProfile as CrawlCreatorProfileRecord | null,
      recentPosts: (result.recentPosts || []).map(item => this.toSearchSnapshot(item as any)),
      contentIds: result.contentIds || [],
      persisted: result.persisted || null,
      supplementalDispatch: result.supplementalDispatch || null,
      supplementalPersisted: result.supplementalPersisted || null,
      analysisItems: (result.analysisItems || []) as Record<string, unknown>[],
      error: result.error || '',
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
      completedAt: result.completedAt || null,
    }
  }

  private toObjectIdOrNull(value?: string) {
    if (!value || !Types.ObjectId.isValid(value)) {
      return null
    }

    return new Types.ObjectId(value)
  }

  private toSeedSnapshot(item: CrawlSeedResult) {
    return {
      platform: item.platform,
      videoId: item.videoId,
      title: item.title,
      author: item.author,
      contentUrl: item.contentUrl,
      thumbnailUrl: item.thumbnailUrl,
      publishedAt: item.publishedAt,
      metrics: {
        views: item.views,
        likes: item.likes,
        comments: item.comments,
        shares: item.shares,
      },
    }
  }

  private toSearchSnapshot(item: any) {
    return {
      platform: item.platform || '',
      videoId: item.videoId || '',
      title: item.title || '',
      author: item.author || '',
      contentUrl: item.contentUrl || '',
      thumbnailUrl: item.thumbnailUrl || '',
      publishedAt: item.publishedAt || '',
      metrics: {
        views: item.metrics?.views || 0,
        likes: item.metrics?.likes || 0,
        comments: item.metrics?.comments || 0,
        shares: item.metrics?.shares || 0,
      },
    }
  }

  private normalizeStoredSeed(item: any): CrawlSeedResult {
    return {
      platform: item.platform || '',
      videoId: item.videoId || '',
      title: item.title || '',
      author: item.author || '',
      contentUrl: item.contentUrl || '',
      thumbnailUrl: item.thumbnailUrl || '',
      publishedAt: item.publishedAt || '',
      views: item.metrics?.views || 0,
      likes: item.metrics?.likes || 0,
      comments: item.metrics?.comments || 0,
      shares: item.metrics?.shares || 0,
    }
  }
}
