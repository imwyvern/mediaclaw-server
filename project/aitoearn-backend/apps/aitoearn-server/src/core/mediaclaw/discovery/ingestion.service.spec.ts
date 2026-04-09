import { beforeEach, describe, expect, it, Mock, vi } from 'vitest'
import { DiscoveryIngestionService } from './ingestion.service'

interface QueryResult<T> {
  sort: Mock
  lean: Mock
  exec: Mock<Promise<T>, []>
}

function createQueryResult<T>(value: T): QueryResult<T> {
  const query = {
    sort: vi.fn().mockReturnThis(),
    lean: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue(value),
  }

  return query
}

describe('discoveryIngestionService', () => {
  let service: DiscoveryIngestionService
  let discoveryQueue: Record<string, Mock>
  let viralContentModel: Record<string, Mock>
  let competitorModel: Record<string, Mock>
  let brandModel: Record<string, Mock>
  let organizationModel: Record<string, Mock>
  let acquisitionService: Record<string, Mock>
  let discoveryService: Record<string, Mock>
  let discoveryNotificationService: Record<string, Mock>

  beforeEach(() => {
    discoveryQueue = {
      upsertJobScheduler: vi.fn().mockResolvedValue(undefined),
      add: vi.fn().mockResolvedValue({ id: 'job-1' }),
    }
    viralContentModel = {
      find: vi.fn().mockReturnValue(createQueryResult([])),
    }
    competitorModel = {
      find: vi.fn().mockReturnValue(createQueryResult([])),
    }
    brandModel = {
      find: vi.fn().mockReturnValue(createQueryResult([])),
    }
    organizationModel = {
      find: vi.fn().mockReturnValue(createQueryResult([])),
    }
    acquisitionService = {
      searchVideos: vi.fn(),
    }
    discoveryService = {
      ingestSearchResults: vi.fn(),
    }
    discoveryNotificationService = {
      notifyNewDiscoveries: vi.fn(),
    }

    service = new DiscoveryIngestionService(
      discoveryQueue as any,
      viralContentModel as any,
      competitorModel as any,
      brandModel as any,
      organizationModel as any,
      acquisitionService as any,
      discoveryService as any,
      discoveryNotificationService as any,
    )
  })

  it('should register BullMQ scheduler on module init', async () => {
    await service.onModuleInit()

    expect(discoveryQueue.upsertJobScheduler).toHaveBeenCalledWith(
      'discovery-every-6-hours',
      expect.objectContaining({
        pattern: '0 */6 * * *',
      }),
      expect.objectContaining({
        name: 'ingest-industry-pool',
      }),
    )
  })

  it('should bootstrap discovery ingestion for explicit industries and platforms', async () => {
    acquisitionService.searchVideos.mockResolvedValue({
      source: 'tikhub',
      platform: 'douyin',
      items: [
        {
          platform: 'douyin',
          videoId: 'video-1',
          title: '美妆爆款拆解',
          author: 'creator-a',
          contentUrl: 'https://example.com/video-1',
          thumbnailUrl: 'https://example.com/thumb-1.jpg',
          publishedAt: '2026-04-09T00:00:00.000Z',
          metrics: {
            views: 10000,
            likes: 800,
            comments: 120,
            shares: 90,
          },
        },
      ],
    })
    discoveryService.ingestSearchResults.mockResolvedValue({
      industry: '美妆',
      platform: 'douyin',
      scannedCount: 1,
      upsertedCount: 1,
      pendingCount: 1,
      contentIds: ['content-1'],
    })

    const result = await service.runBootstrap(['美妆'], ['douyin'])

    expect(acquisitionService.searchVideos).toHaveBeenCalledWith(
      'douyin',
      '美妆',
      10,
    )
    expect(discoveryService.ingestSearchResults).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'douyin',
        industry: '美妆',
        keywords: ['美妆'],
      }),
    )
    expect(result).toEqual(
      expect.objectContaining({
        plans: 1,
        keywords: 1,
        upserts: 1,
        pending: 1,
      }),
    )
    expect(discoveryNotificationService.notifyNewDiscoveries).not.toHaveBeenCalled()
  })
})
