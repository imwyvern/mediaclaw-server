import { InjectQueue } from '@nestjs/bullmq'
import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Competitor } from '@yikart/mongodb'
import { Queue } from 'bullmq'
import { Model, Types } from 'mongoose'
import {
  MEDIACLAW_CRAWL_QUEUE,
  MEDIACLAW_CRAWL_SCHEDULER,
  MEDIACLAW_CRAWL_SCHEDULER_CRON,
  MEDIACLAW_CRAWL_SCHEDULER_JOB,
} from './crawler.constants'
import { CrawlerService } from './crawler.service'

type Identifier = Types.ObjectId | string | { toString: () => string }

type LeanCompetitor = Competitor & {
  _id: Identifier
  orgId: Identifier
}

@Injectable()
export class CrawlerSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(CrawlerSchedulerService.name)

  constructor(
    @InjectQueue(MEDIACLAW_CRAWL_QUEUE)
    private readonly crawlQueue: Queue,
    @InjectModel(Competitor.name)
    private readonly competitorModel: Model<Competitor>,
    private readonly crawlerService: CrawlerService,
  ) {}

  async onModuleInit() {
    await this.crawlQueue.upsertJobScheduler(
      MEDIACLAW_CRAWL_SCHEDULER,
      {
        pattern: MEDIACLAW_CRAWL_SCHEDULER_CRON,
      },
      {
        name: MEDIACLAW_CRAWL_SCHEDULER_JOB,
        data: {
          trigger: 'scheduled',
          requestedAt: new Date().toISOString(),
        },
        opts: {
          removeOnComplete: 20,
          removeOnFail: 20,
        },
      },
    )
  }

  async processScheduledCrawl() {
    const competitors = await this.competitorModel
      .find({
        isActive: true,
      })
      .sort({ lastSyncedAt: 1, createdAt: 1 })
      .lean()
      .exec() as unknown as LeanCompetitor[]

    const jobs: Array<Record<string, unknown>> = []

    for (const competitor of competitors) {
      const keyword = this.normalizeText(competitor.accountName)
        || this.normalizeText(competitor.accountId)
        || competitor.platform
      const result = await this.crawlerService.enqueueCrawl(
        competitor.platform,
        keyword,
        2,
        {
          crawlType: 'competitor_schedule',
          accountUrl: competitor.accountUrl,
          creatorId: competitor.accountId || undefined,
          industry: keyword,
          keywords: [competitor.accountId, competitor.accountName].filter(Boolean) as string[],
          source: 'competitor_scheduler',
          orgId: competitor.orgId.toString(),
          competitorId: competitor._id.toString(),
          limit: 20,
        },
      )
      jobs.push({
        competitorId: competitor._id.toString(),
        platform: competitor.platform,
        accountId: competitor.accountId,
        jobId: result.jobId,
      })
    }

    this.logger.log(`Crawler scheduler enqueued ${jobs.length} competitor crawl job(s).`)

    return {
      scheduler: MEDIACLAW_CRAWL_SCHEDULER_JOB,
      totalCompetitors: competitors.length,
      queuedJobs: jobs.length,
      jobs,
    }
  }

  private normalizeText(value?: string | null) {
    return value?.trim() || ''
  }
}
