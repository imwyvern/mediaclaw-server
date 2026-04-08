import { vi } from 'vitest'
import { CrawlerProcessor } from './crawler.processor'

describe('crawlerProcessor behavior', () => {
  it('should persist crawl results using explicit industry and keyword context', async () => {
    const discoveryService = {
      ingestSearchResults: vi.fn().mockResolvedValue({
        industry: 'beauty',
        platform: 'douyin',
        scannedCount: 1,
        upsertedCount: 1,
        pendingCount: 1,
        contentIds: ['content-1'],
      }),
    }
    const processor = new CrawlerProcessor(discoveryService as any)

    const result = await processor.process({
      id: 'crawl-1',
      data: {
        platform: 'douyin',
        keyword: '竞品达人',
        depth: 2,
        industry: 'beauty',
        keywords: ['skincare', 'beauty'],
        source: 'competitor_account',
        createdAt: '2026-04-08T00:00:00.000Z',
        seedResults: [],
        route: {
          mode: 'tikhub_only',
          reason: 'enough results',
          tikhubResultCount: 1,
          requestedDepth: 2,
          tikhubResponse: {
            source: 'tikhub',
            platform: 'douyin',
            keyword: '竞品达人',
            limit: 6,
            request: {},
            items: [
              {
                platform: 'douyin',
                videoId: 'video-1',
                title: '热门内容',
                author: 'creator-a',
                contentUrl: 'https://example.com/video-1',
                thumbnailUrl: 'https://example.com/thumb-1.jpg',
                publishedAt: '2026-04-07T00:00:00.000Z',
                metrics: {
                  views: 5000,
                  likes: 400,
                  comments: 30,
                  shares: 20,
                },
              },
            ],
          },
        },
      },
    } as any)

    expect(discoveryService.ingestSearchResults).toHaveBeenCalledWith({
      platform: 'douyin',
      industry: 'beauty',
      keywords: ['skincare', 'beauty', '竞品达人'],
      items: [
        expect.objectContaining({
          videoId: 'video-1',
        }),
      ],
      discoveredAt: new Date('2026-04-08T00:00:00.000Z'),
    })
    expect(result).toEqual(
      expect.objectContaining({
        jobId: 'crawl-1',
        industry: 'beauty',
        keywords: ['skincare', 'beauty'],
        sourceTrigger: 'competitor_account',
      }),
    )
  })
})
