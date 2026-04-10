import { beforeEach, describe, expect, it, Mock, vi } from 'vitest'
import { CrawlerService, MEDIACLAW_CRAWL_QUEUE } from './crawler.service'

describe('crawlerService behavior', () => {
  let service: CrawlerService
  let crawlQueue: Record<string, Mock>
  let tikHubService: Record<string, Mock>

  beforeEach(() => {
    crawlQueue = {
      add: vi.fn(),
    }
    tikHubService = {
      searchVideos: vi.fn(),
    }

    service = new CrawlerService(crawlQueue as any, tikHubService as any)
  })

  it('should preserve industry and keyword metadata when enqueueing a crawl', async () => {
    tikHubService.searchVideos.mockResolvedValue({
      source: 'tikhub',
      platform: 'douyin',
      items: [
        {
          platform: 'douyin',
          videoId: 'video-1',
          title: '热门内容',
          author: 'creator-a',
          contentUrl: 'https://example.com/video-1',
          thumbnailUrl: 'https://example.com/thumb-1.jpg',
          publishedAt: '2026-04-08T00:00:00.000Z',
          metrics: {
            views: 2000,
            likes: 150,
            comments: 20,
            shares: 12,
          },
        },
      ],
    })
    crawlQueue.add.mockImplementation(async (_name, data, opts) => ({
      id: opts.jobId,
      data,
      attemptsMade: 0,
      timestamp: Date.parse('2026-04-08T00:00:00.000Z'),
      finishedOn: null,
      progress: 0,
      getState: vi.fn().mockResolvedValue('waiting'),
    }))

    const result = await service.enqueueCrawl(
      'douyin',
      '竞品达人',
      2,
      {
        industry: 'beauty',
        keywords: ['skincare', 'before after'],
        source: 'competitor_account',
      },
    )

    expect(crawlQueue.add).toHaveBeenCalledWith(
      'crawl',
      expect.objectContaining({
        platform: 'douyin',
        keyword: '竞品达人',
        depth: 2,
        industry: 'beauty',
        keywords: expect.arrayContaining([
          '竞品达人',
          'beauty',
          'skincare',
          'before after',
        ]),
        source: 'competitor_account',
      }),
      expect.objectContaining({
        jobId: expect.stringContaining('crawl:douyin:'),
      }),
    )
    expect(result.queueName).toBe(MEDIACLAW_CRAWL_QUEUE)
    expect(result.industry).toBe('beauty')
    expect(result.keywords).toEqual(
      expect.arrayContaining(['竞品达人', 'beauty', 'skincare']),
    )
    expect(result.seededResults[0]).toEqual(
      expect.objectContaining({
        videoId: 'video-1',
        views: 2000,
        likes: 150,
      }),
    )
  })
})
