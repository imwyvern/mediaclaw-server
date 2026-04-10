import { describe, expect, it, vi } from 'vitest'
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
    const mediaCrawlerProClient = {
      submitSupplementalJob: vi.fn(),
    }
    const tikHubService = {
      getVideoComments: vi.fn(),
      getCreatorProfile: vi.fn(),
    }
    const crawlerResultService = {
      recordCompleted: vi.fn().mockResolvedValue(undefined),
      recordFailed: vi.fn().mockResolvedValue(undefined),
    }
    const contentRemixService = {
      analyzeViralElements: vi.fn(),
    }
    const crawlerSchedulerService = {
      processScheduledCrawl: vi.fn(),
    }
    const processor = new CrawlerProcessor(
      discoveryService as any,
      mediaCrawlerProClient as any,
      tikHubService as any,
      crawlerResultService as any,
      contentRemixService as any,
      crawlerSchedulerService as any,
    )

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
        supplementalDispatch: null,
      }),
    )
    expect(mediaCrawlerProClient.submitSupplementalJob).not.toHaveBeenCalled()
    expect(crawlerResultService.recordCompleted).toHaveBeenCalledWith(
      'crawl-1',
      expect.objectContaining({
        contentIds: ['content-1'],
      }),
    )
  })

  it('should dispatch MediaCrawlerPro supplemental crawl and ingest returned items when tikhub is insufficient', async () => {
    const discoveryService = {
      ingestSearchResults: vi.fn()
        .mockResolvedValueOnce({
          industry: 'beauty',
          platform: 'douyin',
          scannedCount: 1,
          upsertedCount: 1,
          pendingCount: 1,
          contentIds: ['content-1'],
        })
        .mockResolvedValueOnce({
          industry: 'beauty',
          platform: 'douyin',
          scannedCount: 1,
          upsertedCount: 1,
          pendingCount: 1,
          contentIds: ['content-2'],
        }),
    }
    const mediaCrawlerProClient = {
      submitSupplementalJob: vi.fn().mockResolvedValue({
        source: 'MediaCrawlerPro',
        enabled: true,
        endpoint: 'http://crawler/internal/media-crawler-pro/jobs',
        status: 'completed',
        dispatchedAt: '2026-04-09T00:00:05.000Z',
        items: [
          {
            platform: 'douyin',
            videoId: 'video-2',
            title: '补采内容',
            author: 'creator-b',
            contentUrl: 'https://example.com/video-2',
            thumbnailUrl: 'https://example.com/thumb-2.jpg',
            publishedAt: '2026-04-07T01:00:00.000Z',
            metrics: {
              views: 8000,
              likes: 600,
              comments: 60,
              shares: 35,
            },
          },
        ],
      }),
    }
    const tikHubService = {
      getVideoComments: vi.fn(),
      getCreatorProfile: vi.fn(),
    }
    const crawlerResultService = {
      recordCompleted: vi.fn().mockResolvedValue(undefined),
      recordFailed: vi.fn().mockResolvedValue(undefined),
    }
    const contentRemixService = {
      analyzeViralElements: vi.fn(),
    }
    const crawlerSchedulerService = {
      processScheduledCrawl: vi.fn(),
    }
    const processor = new CrawlerProcessor(
      discoveryService as any,
      mediaCrawlerProClient as any,
      tikHubService as any,
      crawlerResultService as any,
      contentRemixService as any,
      crawlerSchedulerService as any,
    )

    const result = await processor.process({
      id: 'crawl-2',
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
          mode: 'tikhub_plus_media_crawler_pro',
          reason: 'insufficient',
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

    expect(mediaCrawlerProClient.submitSupplementalJob).toHaveBeenCalledWith({
      platform: 'douyin',
      keyword: '竞品达人',
      depth: 2,
    })
    expect(discoveryService.ingestSearchResults).toHaveBeenCalledTimes(2)
    expect(discoveryService.ingestSearchResults).toHaveBeenLastCalledWith({
      platform: 'douyin',
      industry: 'beauty',
      keywords: ['skincare', 'beauty', '竞品达人'],
      items: [
        expect.objectContaining({
          videoId: 'video-2',
        }),
      ],
      discoveredAt: expect.any(Date),
    })
    expect(result).toEqual(
      expect.objectContaining({
        jobId: 'crawl-2',
        supplementalDispatch: expect.objectContaining({
          status: 'completed',
        }),
        supplementalPersisted: expect.objectContaining({
          upsertedCount: 1,
        }),
        supplementalResults: [
          expect.objectContaining({
            videoId: 'video-2',
          }),
        ],
      }),
    )
    expect(crawlerResultService.recordCompleted).toHaveBeenCalledWith(
      'crawl-2',
      expect.objectContaining({
        supplementalPersisted: expect.objectContaining({
          upsertedCount: 1,
        }),
      }),
    )
  })

  it('should crawl creator profile, ingest recent posts, and auto analyze scheduled competitor content', async () => {
    const discoveryService = {
      ingestSearchResults: vi.fn().mockResolvedValue({
        industry: 'beauty',
        platform: 'douyin',
        scannedCount: 1,
        upsertedCount: 1,
        pendingCount: 1,
        contentIds: ['content-creator-1'],
      }),
    }
    const mediaCrawlerProClient = {
      submitSupplementalJob: vi.fn(),
    }
    const tikHubService = {
      getVideoComments: vi.fn(),
      getCreatorProfile: vi.fn().mockResolvedValue({
        source: 'tikhub',
        creatorId: 'creator-sec-id',
        data: {
          profile: {
            creatorId: 'creator-sec-id',
            nickname: '达人成长记',
            avatarUrl: 'https://example.com/avatar.jpg',
            followerCount: 1000,
            followingCount: 10,
            likeCount: 2000,
            bio: 'bio',
            profileUrl: 'https://example.com/u/creator-sec-id',
          },
          recentPosts: [
            {
              platform: 'douyin',
              videoId: 'video-3',
              title: '达人新作',
              author: '达人成长记',
              contentUrl: 'https://example.com/video-3',
              thumbnailUrl: 'https://example.com/thumb-3.jpg',
              publishedAt: '2026-04-08T00:00:00.000Z',
              metrics: {
                views: 9000,
                likes: 700,
                comments: 60,
                shares: 30,
              },
            },
          ],
        },
      }),
    }
    const crawlerResultService = {
      recordCompleted: vi.fn().mockResolvedValue(undefined),
      recordFailed: vi.fn().mockResolvedValue(undefined),
    }
    const contentRemixService = {
      analyzeViralElements: vi.fn().mockResolvedValue({
        summary: '强钩子开场',
        source: 'fallback',
      }),
    }
    const crawlerSchedulerService = {
      processScheduledCrawl: vi.fn(),
    }
    const processor = new CrawlerProcessor(
      discoveryService as any,
      mediaCrawlerProClient as any,
      tikHubService as any,
      crawlerResultService as any,
      contentRemixService as any,
      crawlerSchedulerService as any,
    )

    const result = await processor.process({
      id: 'crawl-3',
      name: 'crawl',
      data: {
        crawlType: 'competitor_schedule',
        platform: 'douyin',
        keyword: 'beauty',
        depth: 2,
        resultLimit: 20,
        industry: 'beauty',
        keywords: ['beauty', '护肤'],
        source: 'competitor_scheduler',
        createdAt: '2026-04-08T00:00:00.000Z',
        seedResults: [],
        route: null,
        accountUrl: 'https://www.douyin.com/user/creator-sec-id',
        creatorId: 'creator-sec-id',
      },
    } as any)

    expect(tikHubService.getCreatorProfile).toHaveBeenCalledWith('douyin', {
      creatorId: 'creator-sec-id',
      accountUrl: 'https://www.douyin.com/user/creator-sec-id',
      limit: 20,
    })
    expect(discoveryService.ingestSearchResults).toHaveBeenCalledWith({
      platform: 'douyin',
      industry: 'beauty',
      keywords: ['beauty', '护肤', '达人成长记'],
      items: [
        expect.objectContaining({
          videoId: 'video-3',
        }),
      ],
      discoveredAt: new Date('2026-04-08T00:00:00.000Z'),
    })
    expect(contentRemixService.analyzeViralElements).toHaveBeenCalledWith('content-creator-1')
    expect(result).toEqual(
      expect.objectContaining({
        creatorProfile: expect.objectContaining({
          creatorId: 'creator-sec-id',
        }),
        contentIds: ['content-creator-1'],
        analysisItems: [
          expect.objectContaining({
            contentId: 'content-creator-1',
            analyzed: true,
          }),
        ],
      }),
    )
  })
})
