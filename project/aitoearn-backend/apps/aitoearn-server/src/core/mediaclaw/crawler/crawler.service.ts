import { InjectQueue } from '@nestjs/bullmq'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Queue } from 'bullmq'
import { AcquisitionService } from '../acquisition/acquisition.service'
import { CrawlerResultService } from './crawler-result.service'
import { MEDIACLAW_CRAWL_QUEUE } from './crawler.constants'
import {
  CrawlJobData,
  CrawlOptions,
  CrawlQuery,
  CrawlRouteDecision,
  CrawlSeedResult,
} from './crawler.types'

export { MEDIACLAW_CRAWL_QUEUE } from './crawler.constants'

@Injectable()
export class CrawlerService {
  constructor(
    @InjectQueue(MEDIACLAW_CRAWL_QUEUE)
    private readonly crawlQueue: Queue<CrawlJobData>,
    private readonly acquisitionService: AcquisitionService,
    private readonly crawlerResultService: CrawlerResultService,
  ) {}

  async enqueueCrawl(
    platform: string,
    keyword: string,
    depth = 1,
    options: CrawlOptions = {},
  ) {
    const normalizedPlatform = this.normalizePlatform(platform)
    const normalizedDepth = this.normalizeDepth(depth)
    const crawlType = options.crawlType || 'keyword'
    const resultLimit = this.normalizeResultLimit(crawlType, options.limit)
    const normalizedKeyword = this.normalizeText(keyword)
    const normalizedIndustry = this.normalizeText(options.industry) || normalizedKeyword
    const normalizedKeywords = this.mergeKeywords(
      options.keywords || [],
      [normalizedKeyword, normalizedIndustry],
    )

    this.validateRequest(crawlType, {
      keyword: normalizedKeyword,
      videoUrl: this.normalizeText(options.videoUrl),
      videoId: this.normalizeText(options.videoId),
      creatorId: this.normalizeText(options.creatorId),
      accountUrl: this.normalizeText(options.accountUrl),
    })

    const route = crawlType === 'keyword'
      ? await this.dualLayerRoute({
          platform: normalizedPlatform,
          keyword: normalizedKeyword,
          depth: normalizedDepth,
        })
      : null
    const seedResults = route
      ? route.tikhubResponse.items.map(item => this.toSeedResult(item))
      : []

    const data: CrawlJobData = {
      crawlType,
      platform: normalizedPlatform,
      keyword: normalizedKeyword,
      depth: normalizedDepth,
      resultLimit,
      industry: normalizedIndustry,
      keywords: normalizedKeywords,
      source: this.normalizeText(options.source) || 'manual',
      route,
      seedResults,
      videoUrl: this.normalizeText(options.videoUrl) || undefined,
      videoId: this.normalizeText(options.videoId) || undefined,
      creatorId: this.normalizeText(options.creatorId) || undefined,
      accountUrl: this.normalizeText(options.accountUrl) || undefined,
      orgId: this.normalizeText(options.orgId) || undefined,
      competitorId: this.normalizeText(options.competitorId) || undefined,
      createdAt: new Date().toISOString(),
    }

    const job = await this.crawlQueue.add(
      'crawl',
      data,
      {
        jobId: `crawl:${crawlType}:${normalizedPlatform}:${Date.now()}`,
      },
    )

    const jobId = String(job.id || '')
    await this.crawlerResultService.recordQueued(jobId, data)

    return {
      jobId,
      queueName: MEDIACLAW_CRAWL_QUEUE,
      status: await job.getState(),
      crawlType,
      industry: normalizedIndustry,
      keywords: normalizedKeywords,
      source: data.source,
      route,
      seededResults: seedResults,
      targetId: data.videoId || data.creatorId || '',
      targetUrl: data.videoUrl || data.accountUrl || '',
    }
  }

  async getCrawlStatus(jobId: string) {
    const job = await this.crawlQueue.getJob(jobId)
    const stored = await this.crawlerResultService.getByJobId(jobId)
    if (!job && !stored) {
      throw new NotFoundException('Crawl job not found')
    }

    if (job) {
      const state = await job.getState()
      return {
        jobId,
        queueName: MEDIACLAW_CRAWL_QUEUE,
        state,
        progress: typeof job.progress === 'number' ? job.progress : 0,
        attemptsMade: job.attemptsMade,
        createdAt: typeof job.timestamp === 'number'
          ? new Date(job.timestamp).toISOString()
          : job.data.createdAt,
        finishedAt: typeof job.finishedOn === 'number'
          ? new Date(job.finishedOn).toISOString()
          : stored?.completedAt || null,
        crawlType: job.data.crawlType,
        routeMode: job.data.route?.mode || '',
        industry: job.data.industry,
        keywords: job.data.keywords,
        source: job.data.source,
      }
    }

    return {
      jobId,
      queueName: MEDIACLAW_CRAWL_QUEUE,
      state: stored?.status || 'unknown',
      progress: stored?.status === 'completed' ? 100 : 0,
      attemptsMade: 0,
      createdAt: stored?.createdAt || null,
      finishedAt: stored?.completedAt || null,
      crawlType: stored?.crawlType || 'keyword',
      routeMode: stored?.routeMode || '',
      industry: stored?.industry || '',
      keywords: stored?.keywords || [],
      source: stored?.source || '',
    }
  }

  async getCrawlResults(jobId: string) {
    const stored = await this.crawlerResultService.getByJobId(jobId)
    const job = await this.crawlQueue.getJob(jobId)

    if (!stored && !job) {
      throw new NotFoundException('Crawl job not found')
    }

    if (stored) {
      return {
        jobId,
        queueName: MEDIACLAW_CRAWL_QUEUE,
        state: stored.status,
        crawlType: stored.crawlType,
        industry: stored.industry,
        keywords: stored.keywords,
        source: stored.source,
        route: stored.route,
        total: this.resolveStoredTotal(stored),
        results: stored,
      }
    }

    const state = await job!.getState()
    const results = job!.returnvalue || job!.data.seedResults

    return {
      jobId,
      queueName: MEDIACLAW_CRAWL_QUEUE,
      state,
      crawlType: job!.data.crawlType,
      industry: job!.data.industry,
      keywords: job!.data.keywords,
      source: job!.data.source,
      route: job!.data.route,
      total: Array.isArray(results) ? results.length : job!.data.seedResults.length,
      results,
    }
  }

  async dualLayerRoute(query: CrawlQuery): Promise<CrawlRouteDecision> {
    const tikhubResponse = await this.acquisitionService.searchVideos(
      query.platform,
      query.keyword,
      Math.max(5, query.depth * 3),
    )
    const minimumExpectedResults = Math.max(3, query.depth * 2)
    const isInsufficient = tikhubResponse.items.length < minimumExpectedResults

    if (!isInsufficient) {
      return {
        mode: 'tikhub_only',
        reason: 'TikHub 搜索结果已满足当前抓取深度，不触发补采。',
        tikhubResultCount: tikhubResponse.items.length,
        requestedDepth: query.depth,
        tikhubResponse: {
          provider: tikhubResponse.provider,
          source: tikhubResponse.source,
          platform: tikhubResponse.platform,
          keyword: tikhubResponse.keyword,
          limit: tikhubResponse.limit,
          request: tikhubResponse.request,
          items: tikhubResponse.items,
        },
      }
    }

    return {
      mode: 'tikhub_plus_media_crawler_pro',
      reason: 'TikHub 返回结果不足，追加 MediaCrawlerPro 作为第二层补采。',
      tikhubResultCount: tikhubResponse.items.length,
      requestedDepth: query.depth,
      tikhubResponse: {
        provider: tikhubResponse.provider,
        source: tikhubResponse.source,
        platform: tikhubResponse.platform,
        keyword: tikhubResponse.keyword,
        limit: tikhubResponse.limit,
        request: tikhubResponse.request,
        items: tikhubResponse.items,
      },
      mediaCrawlerPro: {
        source: 'MediaCrawlerPro',
        request: {
          method: 'POST',
          endpoint: '/internal/media-crawler-pro/jobs',
          body: {
            platform: query.platform,
            keyword: query.keyword,
            depth: query.depth,
          },
          note: '当前 worker 会真实调度 MediaCrawlerPro；若响应里直接带补采结果，将合并写回发现池。',
        },
      },
    }
  }

  private resolveStoredTotal(stored: Awaited<ReturnType<CrawlerResultService['getByJobId']>>) {
    if (!stored) {
      return 0
    }

    if (stored.comments.length > 0) {
      return stored.comments.length
    }

    if (stored.recentPosts.length > 0) {
      return stored.recentPosts.length
    }

    if (stored.seededResults.length > 0) {
      return stored.seededResults.length
    }

    return stored.contentIds.length
  }

  private validateRequest(
    crawlType: CrawlJobData['crawlType'],
    input: {
      keyword: string
      videoUrl: string
      videoId: string
      creatorId: string
      accountUrl: string
    },
  ) {
    if (crawlType === 'keyword' && !input.keyword) {
      throw new BadRequestException('keyword is required')
    }

    if (crawlType === 'video_comments' && !input.videoUrl && !input.videoId) {
      throw new BadRequestException('videoUrl or videoId is required for video_comments crawl')
    }

    if (
      (crawlType === 'creator_profile' || crawlType === 'competitor_schedule')
      && !input.creatorId
      && !input.accountUrl
    ) {
      throw new BadRequestException('creatorId or accountUrl is required for creator profile crawl')
    }
  }

  private normalizePlatform(platform: string) {
    const normalized = platform.trim().toLowerCase()
    if (!normalized) {
      throw new BadRequestException('platform is required')
    }

    if (normalized === 'xiaohongshu' || normalized === 'rednote') {
      return 'xhs'
    }

    return normalized
  }

  private normalizeText(value?: string | null) {
    return value?.trim() || ''
  }

  private normalizeDepth(depth?: number) {
    if (!Number.isFinite(depth)) {
      return 1
    }

    return Math.min(Math.max(Math.trunc(depth as number), 1), 10)
  }

  private normalizeResultLimit(crawlType: CrawlJobData['crawlType'], limit?: number) {
    const defaultLimit = crawlType === 'video_comments' ? 50 : crawlType === 'keyword' ? 10 : 20
    if (!Number.isFinite(limit)) {
      return defaultLimit
    }

    const upperBound = crawlType === 'video_comments' ? 50 : 20
    return Math.min(Math.max(Math.trunc(limit as number), 1), upperBound)
  }

  private mergeKeywords(primary: string[], secondary: Array<string | undefined>) {
    return Array.from(
      new Set(
        [...primary, ...secondary]
          .filter((item): item is string => typeof item === 'string')
          .map(item => item.trim())
          .filter(Boolean),
      ),
    )
  }

  private toSeedResult(item: CrawlRouteDecision['tikhubResponse']['items'][number]): CrawlSeedResult {
    return {
      platform: item.platform,
      videoId: item.videoId,
      title: item.title,
      author: item.author,
      contentUrl: item.contentUrl,
      thumbnailUrl: item.thumbnailUrl,
      publishedAt: item.publishedAt,
      views: item.metrics.views,
      likes: item.metrics.likes,
      comments: item.metrics.comments,
      shares: item.metrics.shares,
    }
  }
}
