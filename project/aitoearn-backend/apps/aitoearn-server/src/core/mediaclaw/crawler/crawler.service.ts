import { InjectQueue } from '@nestjs/bullmq'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Job, Queue } from 'bullmq'
import { TikHubService } from '../acquisition/tikhub.service'

export const MEDIACLAW_CRAWL_QUEUE = 'mediaclaw_crawl'

interface CrawlQuery {
  platform: string
  keyword: string
  depth: number
}

interface CrawlSeedResult {
  platform: string
  title: string
  author: string
  contentUrl: string
  thumbnailUrl: string
}

interface CrawlRouteDecision {
  mode: 'tikhub_only' | 'tikhub_plus_media_crawler_pro'
  reason: string
  tikhubResultCount: number
  requestedDepth: number
  tikhubResponse: Awaited<ReturnType<TikHubService['searchVideos']>>
  mediaCrawlerPro?: {
    source: 'MediaCrawlerPro'
    request: {
      method: 'POST'
      endpoint: string
      body: {
        platform: string
        keyword: string
        depth: number
      }
      note: string
    }
  }
}

interface CrawlJobData {
  platform: string
  keyword: string
  depth: number
  route: CrawlRouteDecision
  seedResults: CrawlSeedResult[]
  createdAt: string
}

@Injectable()
export class CrawlerService {
  constructor(
    @InjectQueue(MEDIACLAW_CRAWL_QUEUE)
    private readonly crawlQueue: Queue<CrawlJobData>,
    private readonly tikHubService: TikHubService,
  ) {}

  async enqueueCrawl(platform: string, keyword: string, depth = 1) {
    const safeKeyword = keyword.trim()
    if (!safeKeyword) {
      throw new BadRequestException('keyword is required')
    }

    const normalizedDepth = this.normalizeDepth(depth)
    const route = await this.dualLayerRoute({
      platform,
      keyword: safeKeyword,
      depth: normalizedDepth,
    })

    const data: CrawlJobData = {
      platform,
      keyword: safeKeyword,
      depth: normalizedDepth,
      route,
      seedResults: route.tikhubResponse.items.map(item => ({
        platform: item.platform,
        title: item.title,
        author: item.author,
        contentUrl: item.contentUrl,
        thumbnailUrl: item.thumbnailUrl,
      })),
      createdAt: new Date().toISOString(),
    }

    const job = await this.crawlQueue.add(
      'crawl',
      data,
      {
        jobId: `crawl:${platform}:${Date.now()}`,
      },
    )

    return {
      jobId: String(job.id || ''),
      queueName: MEDIACLAW_CRAWL_QUEUE,
      status: await job.getState(),
      route,
      seededResults: data.seedResults,
    }
  }

  async getCrawlStatus(jobId: string) {
    const job = await this.findJob(jobId)
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
        : null,
      routeMode: job.data.route.mode,
    }
  }

  async getCrawlResults(jobId: string) {
    const job = await this.findJob(jobId)
    const state = await job.getState()
    const results = Array.isArray(job.returnvalue) && job.returnvalue.length > 0
      ? job.returnvalue
      : job.data.seedResults

    return {
      jobId,
      queueName: MEDIACLAW_CRAWL_QUEUE,
      state,
      route: job.data.route,
      total: results.length,
      results,
    }
  }

  async dualLayerRoute(query: CrawlQuery): Promise<CrawlRouteDecision> {
    const tikhubResponse = await this.tikHubService.searchVideos(
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
        tikhubResponse,
      }
    }

    return {
      mode: 'tikhub_plus_media_crawler_pro',
      reason: 'TikHub 返回结果不足，追加 MediaCrawlerPro 作为第二层补采。',
      tikhubResultCount: tikhubResponse.items.length,
      requestedDepth: query.depth,
      tikhubResponse,
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
          note: '当前只保留补采路由契约，后续再接入真实 worker 与结果回填。',
        },
      },
    }
  }

  private async findJob(jobId: string): Promise<Job<CrawlJobData>> {
    const job = await this.crawlQueue.getJob(jobId)
    if (!job) {
      throw new NotFoundException('Crawl job not found')
    }

    return job
  }

  private normalizeDepth(depth?: number) {
    if (!Number.isFinite(depth)) {
      return 1
    }

    return Math.min(Math.max(Math.trunc(depth as number), 1), 10)
  }
}
