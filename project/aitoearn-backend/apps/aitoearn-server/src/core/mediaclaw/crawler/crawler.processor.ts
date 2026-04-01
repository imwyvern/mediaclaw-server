import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq'
import { Injectable, Logger } from '@nestjs/common'
import { Job } from 'bullmq'
import { DiscoveryService } from '../discovery/discovery.service'
import { CrawlJobData, MEDIACLAW_CRAWL_QUEUE } from './crawler.service'

@Injectable()
@Processor(MEDIACLAW_CRAWL_QUEUE)
export class CrawlerProcessor extends WorkerHost {
  private readonly logger = new Logger(CrawlerProcessor.name)

  constructor(
    private readonly discoveryService: DiscoveryService,
  ) {
    super()
  }

  async process(job: Job<CrawlJobData>) {
    const persisted = await this.discoveryService.ingestSearchResults({
      platform: job.data.platform,
      industry: job.data.keyword,
      keywords: [job.data.keyword],
      items: job.data.route.tikhubResponse.items,
      discoveredAt: new Date(job.data.createdAt),
    })

    const result = {
      jobId: String(job.id || ''),
      platform: job.data.platform,
      keyword: job.data.keyword,
      depth: job.data.depth,
      routeMode: job.data.route.mode,
      source: job.data.route.tikhubResponse.source,
      persisted,
      seedResults: job.data.seedResults,
    }

    this.logger.log(
      `Crawl job ${result.jobId} persisted ${persisted.upsertedCount} item(s) for ${job.data.platform}/${job.data.keyword}.`,
    )

    return result
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<CrawlJobData>) {
    this.logger.debug(`Crawler job completed: ${job?.id || 'unknown'}`)
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<CrawlJobData> | undefined, error: Error) {
    this.logger.error(`Crawler job failed for ${job?.id || 'unknown'}: ${error.message}`)
  }
}
