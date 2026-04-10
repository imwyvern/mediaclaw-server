import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq'
import { Injectable, Logger } from '@nestjs/common'
import { Job } from 'bullmq'
import {
  TikHubService,
} from '../acquisition/tikhub.service'
import { ContentRemixService } from '../discovery/content-remix.service'
import { DiscoveryService } from '../discovery/discovery.service'
import { CrawlerResultService } from './crawler-result.service'
import { CrawlerSchedulerService } from './crawler-scheduler.service'
import {
  MEDIACLAW_CRAWL_QUEUE,
  MEDIACLAW_CRAWL_SCHEDULER_JOB,
} from './crawler.constants'
import { CrawlJobData } from './crawler.types'
import { MediaCrawlerProClient } from './media-crawler-pro.client'

@Injectable()
@Processor(MEDIACLAW_CRAWL_QUEUE)
export class CrawlerProcessor extends WorkerHost {
  private readonly logger = new Logger(CrawlerProcessor.name)

  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly mediaCrawlerProClient: MediaCrawlerProClient,
    private readonly tikHubService: TikHubService,
    private readonly crawlerResultService: CrawlerResultService,
    private readonly contentRemixService: ContentRemixService,
    private readonly crawlerSchedulerService: CrawlerSchedulerService,
  ) {
    super()
  }

  async process(job: Job<CrawlJobData>) {
    if (job.name === MEDIACLAW_CRAWL_SCHEDULER_JOB) {
      return this.crawlerSchedulerService.processScheduledCrawl()
    }

    const result = await this.processCrawlJob(job)
    await this.crawlerResultService.recordCompleted(String(job.id || ''), {
      targetId: result.targetId,
      targetUrl: result.targetUrl,
      creatorId: result.creatorProfile?.creatorId || result.targetId || '',
      comments: result.comments,
      creatorProfile: result.creatorProfile,
      recentPosts: result.recentPosts,
      contentIds: result.contentIds,
      persisted: result.persisted,
      supplementalDispatch: result.supplementalDispatch,
      supplementalPersisted: result.supplementalPersisted,
      analysisItems: result.analysisItems,
    })
    return result
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<CrawlJobData>) {
    this.logger.debug(`Crawler job completed: ${job?.id || 'unknown'}`)
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<CrawlJobData> | undefined, error: Error) {
    this.logger.error(`Crawler job failed for ${job?.id || 'unknown'}: ${error.message}`)
    if (job?.id) {
      await this.crawlerResultService.recordFailed(String(job.id), error.message)
    }
  }

  private async processCrawlJob(job: Job<CrawlJobData>) {
    switch (job.data.crawlType) {
      case 'video_comments':
        return this.processVideoComments(job)
      case 'creator_profile':
      case 'competitor_schedule':
        return this.processCreatorProfile(job)
      case 'keyword':
      default:
        return this.processKeywordCrawl(job)
    }
  }

  private async processKeywordCrawl(job: Job<CrawlJobData>) {
    const persisted = await this.discoveryService.ingestSearchResults({
      platform: job.data.platform,
      industry: job.data.industry || job.data.keyword,
      keywords: this.mergeKeywords(job.data.keywords || [], [
        job.data.keyword,
        job.data.industry,
      ]),
      items: job.data.route?.tikhubResponse.items || [],
      discoveredAt: new Date(job.data.createdAt),
    })
    const supplementalDispatch = job.data.route?.mode === 'tikhub_plus_media_crawler_pro'
      ? await this.mediaCrawlerProClient.submitSupplementalJob({
          platform: job.data.platform,
          keyword: job.data.keyword,
          depth: job.data.depth,
        })
      : null
    const supplementalPersisted
      = supplementalDispatch && supplementalDispatch.items.length > 0
        ? await this.discoveryService.ingestSearchResults({
            platform: job.data.platform,
            industry: job.data.industry || job.data.keyword,
            keywords: this.mergeKeywords(job.data.keywords || [], [
              job.data.keyword,
              job.data.industry,
            ]),
            items: supplementalDispatch.items,
            discoveredAt: new Date(),
          })
        : null

    const result = {
      jobId: String(job.id || ''),
      crawlType: job.data.crawlType,
      platform: job.data.platform,
      keyword: job.data.keyword,
      depth: job.data.depth,
      industry: job.data.industry,
      keywords: job.data.keywords,
      sourceTrigger: job.data.source,
      routeMode: job.data.route?.mode || '',
      source: job.data.route?.tikhubResponse.source || 'tikhub',
      persisted,
      seedResults: job.data.seedResults,
      supplementalDispatch,
      supplementalPersisted,
      supplementalResults: supplementalDispatch?.items || [],
      comments: [],
      creatorProfile: null,
      recentPosts: [],
      contentIds: [
        ...persisted.contentIds,
        ...(supplementalPersisted?.contentIds || []),
      ],
      analysisItems: [] as Record<string, unknown>[],
      targetId: '',
      targetUrl: '',
    }

    this.logger.log(
      `Crawl job ${result.jobId} persisted ${persisted.upsertedCount} TikHub item(s)`
      + `${supplementalPersisted ? ` + ${supplementalPersisted.upsertedCount} MediaCrawlerPro item(s)` : ''}`
      + ` for ${job.data.platform}/${job.data.keyword}.`,
    )

    return result
  }

  private async processVideoComments(job: Job<CrawlJobData>) {
    const response = await this.tikHubService.getVideoComments(job.data.platform, {
      videoId: job.data.videoId,
      videoUrl: job.data.videoUrl,
      limit: job.data.resultLimit,
    })

    return {
      jobId: String(job.id || ''),
      crawlType: job.data.crawlType,
      platform: job.data.platform,
      keyword: job.data.keyword,
      depth: job.data.depth,
      industry: job.data.industry,
      keywords: job.data.keywords,
      sourceTrigger: job.data.source,
      routeMode: '',
      source: response.source,
      persisted: null,
      seedResults: job.data.seedResults,
      supplementalDispatch: null,
      supplementalPersisted: null,
      supplementalResults: [],
      comments: response.comments,
      creatorProfile: null,
      recentPosts: [],
      contentIds: [],
      analysisItems: [] as Record<string, unknown>[],
      targetId: response.videoId,
      targetUrl: job.data.videoUrl || '',
    }
  }

  private async processCreatorProfile(job: Job<CrawlJobData>) {
    const response = await this.tikHubService.getCreatorProfile(job.data.platform, {
      creatorId: job.data.creatorId,
      accountUrl: job.data.accountUrl,
      limit: job.data.resultLimit,
    })
    const recentPosts = response.data?.recentPosts || []
    const creatorProfile = response.data?.profile || null
    const persisted = recentPosts.length > 0
      ? await this.discoveryService.ingestSearchResults({
          platform: job.data.platform,
          industry: job.data.industry || job.data.keyword || creatorProfile?.nickname || job.data.platform,
          keywords: this.mergeKeywords(job.data.keywords || [], [
            job.data.keyword,
            job.data.industry,
            creatorProfile?.nickname,
          ]),
          items: recentPosts,
          discoveredAt: new Date(job.data.createdAt),
        })
      : null
    const analysisItems = job.data.crawlType === 'competitor_schedule'
      ? await this.autoAnalyzeContentIds(persisted?.contentIds || [])
      : []

    return {
      jobId: String(job.id || ''),
      crawlType: job.data.crawlType,
      platform: job.data.platform,
      keyword: job.data.keyword,
      depth: job.data.depth,
      industry: job.data.industry,
      keywords: job.data.keywords,
      sourceTrigger: job.data.source,
      routeMode: '',
      source: response.source,
      persisted,
      seedResults: job.data.seedResults,
      supplementalDispatch: null,
      supplementalPersisted: null,
      supplementalResults: [],
      comments: [],
      creatorProfile,
      recentPosts,
      contentIds: persisted?.contentIds || [],
      analysisItems,
      targetId: response.creatorId,
      targetUrl: creatorProfile?.profileUrl || job.data.accountUrl || '',
    }
  }

  private async autoAnalyzeContentIds(contentIds: string[]) {
    const analysisItems: Record<string, unknown>[] = []

    for (const contentId of contentIds.slice(0, 20)) {
      try {
        const analysis = await this.contentRemixService.analyzeViralElements(contentId)
        analysisItems.push({
          contentId,
          analyzed: true,
          summary: analysis.summary,
          source: analysis.source,
        })
      }
      catch (error) {
        analysisItems.push({
          contentId,
          analyzed: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    return analysisItems
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
}
