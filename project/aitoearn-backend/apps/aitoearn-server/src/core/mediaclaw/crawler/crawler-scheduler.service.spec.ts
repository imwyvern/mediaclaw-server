import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CrawlerSchedulerService } from './crawler-scheduler.service'
import {
  MEDIACLAW_CRAWL_SCHEDULER,
  MEDIACLAW_CRAWL_SCHEDULER_CRON,
  MEDIACLAW_CRAWL_SCHEDULER_JOB,
} from './crawler.constants'

describe('crawlerSchedulerService', () => {
  let crawlQueue: Record<string, ReturnType<typeof vi.fn>>
  let competitorModel: Record<string, ReturnType<typeof vi.fn>>
  let crawlerService: Record<string, ReturnType<typeof vi.fn>>
  let service: CrawlerSchedulerService

  beforeEach(() => {
    crawlQueue = {
      upsertJobScheduler: vi.fn().mockResolvedValue(undefined),
    }
    competitorModel = {
      find: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({
          lean: vi.fn().mockReturnValue({
            exec: vi.fn().mockResolvedValue([
              {
                _id: { toString: () => 'competitor-1' },
                orgId: { toString: () => 'org-1' },
                platform: 'douyin',
                accountId: 'creator-a',
                accountName: '达人 A',
                accountUrl: 'https://www.douyin.com/user/creator-a',
              },
            ]),
          }),
        }),
      }),
    }
    crawlerService = {
      enqueueCrawl: vi.fn().mockResolvedValue({
        jobId: 'crawl-job-1',
      }),
    }
    service = new CrawlerSchedulerService(
      crawlQueue as any,
      competitorModel as any,
      crawlerService as any,
    )
  })

  it('should register a repeatable crawl scheduler on module init', async () => {
    await service.onModuleInit()

    expect(crawlQueue.upsertJobScheduler).toHaveBeenCalledWith(
      MEDIACLAW_CRAWL_SCHEDULER,
      {
        pattern: MEDIACLAW_CRAWL_SCHEDULER_CRON,
      },
      expect.objectContaining({
        name: MEDIACLAW_CRAWL_SCHEDULER_JOB,
      }),
    )
  })

  it('should enqueue scheduled competitor profile crawls', async () => {
    const result = await service.processScheduledCrawl()

    expect(crawlerService.enqueueCrawl).toHaveBeenCalledWith(
      'douyin',
      '达人 A',
      2,
      expect.objectContaining({
        crawlType: 'competitor_schedule',
        accountUrl: 'https://www.douyin.com/user/creator-a',
        creatorId: 'creator-a',
        orgId: 'org-1',
        competitorId: 'competitor-1',
      }),
    )
    expect(result).toEqual(
      expect.objectContaining({
        totalCompetitors: 1,
        queuedJobs: 1,
      }),
    )
  })
})
