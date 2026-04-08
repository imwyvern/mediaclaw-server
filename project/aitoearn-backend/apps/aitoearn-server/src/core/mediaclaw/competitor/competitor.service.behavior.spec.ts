import { Types } from 'mongoose'
import { Mock, vi } from 'vitest'
import { CompetitorService } from './competitor.service'

interface QueryResult<T> {
  sort: Mock
  limit: Mock
  lean: Mock
  exec: Mock<Promise<T>, []>
}

function createQueryResult<T>(value: T): QueryResult<T> {
  const query = {
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    lean: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue(value),
  }

  return query
}

function createExecResult<T>(value: T) {
  return {
    exec: vi.fn().mockResolvedValue(value),
  }
}

describe('competitorService behavior', () => {
  let service: CompetitorService
  let competitorModel: Record<string, Mock>
  let viralContentModel: Record<string, Mock>
  let brandModel: Record<string, Mock>
  let organizationModel: Record<string, Mock>
  let tikHubService: Record<string, Mock>
  let discoveryService: Record<string, Mock>

  beforeEach(() => {
    competitorModel = {
      find: vi.fn(),
      findByIdAndUpdate: vi.fn(),
      findOne: vi.fn(),
      findOneAndUpdate: vi.fn(),
    }
    viralContentModel = {
      find: vi.fn(),
    }
    brandModel = {
      find: vi.fn(),
    }
    organizationModel = {
      findById: vi.fn(),
    }
    tikHubService = {
      searchVideos: vi.fn(),
    }
    discoveryService = {
      ingestSearchResults: vi.fn(),
    }

    service = new CompetitorService(
      competitorModel as any,
      viralContentModel as any,
      brandModel as any,
      organizationModel as any,
      tikHubService as any,
      discoveryService as any,
    )
  })

  it('should trigger competitor sync when adding competitor', async () => {
    const orgId = new Types.ObjectId()
    const competitorId = new Types.ObjectId()
    const competitor = {
      _id: competitorId,
      orgId,
      platform: 'douyin',
      accountId: 'target-creator',
      accountName: 'target creator',
      accountUrl: 'https://www.douyin.com/user/target-creator',
      metrics: {
        followers: 0,
        avgViews: 0,
        avgLikes: 0,
        postFrequency: 0,
      },
      isActive: true,
      lastSyncedAt: new Date('2026-04-08T00:00:00.000Z'),
      createdAt: new Date('2026-04-08T00:00:00.000Z'),
      updatedAt: new Date('2026-04-08T00:00:00.000Z'),
    }

    competitorModel.findOneAndUpdate.mockReturnValue(createQueryResult(competitor))
    competitorModel.findByIdAndUpdate.mockReturnValue(createExecResult({}))
    brandModel.find.mockReturnValue(
      createQueryResult([
        {
          _id: new Types.ObjectId(),
          orgId,
          industry: 'beauty',
          assets: {
            keywords: ['skincare', 'before after'],
          },
        },
      ]),
    )
    organizationModel.findById.mockReturnValue(
      createQueryResult({
        _id: orgId,
        settings: {
          industry: 'beauty',
        },
      }),
    )
    tikHubService.searchVideos.mockResolvedValue({
      source: 'tikhub',
      platform: 'douyin',
      items: [
        {
          platform: 'douyin',
          videoId: 'video-1',
          title: 'Target creator skincare routine',
          author: 'target creator',
          contentUrl: 'https://example.com/videos/video-1',
          thumbnailUrl: 'https://example.com/thumb-1.jpg',
          publishedAt: '2026-04-08T00:00:00.000Z',
          metrics: {
            views: 5000,
            likes: 400,
            comments: 40,
            shares: 30,
          },
        },
      ],
    })
    discoveryService.ingestSearchResults.mockResolvedValue({
      industry: 'beauty',
      platform: 'douyin',
      scannedCount: 1,
      upsertedCount: 1,
      pendingCount: 1,
      contentIds: ['content-1'],
    })

    const result = await service.addCompetitor(
      orgId.toString(),
      'douyin',
      'https://www.douyin.com/user/target-creator',
    )

    expect(tikHubService.searchVideos).toHaveBeenCalledTimes(2)
    expect(tikHubService.searchVideos).toHaveBeenNthCalledWith(
      1,
      'douyin',
      'target-creator',
      10,
    )
    expect(tikHubService.searchVideos).toHaveBeenNthCalledWith(
      2,
      'douyin',
      'target creator',
      10,
    )
    expect(discoveryService.ingestSearchResults).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'douyin',
        industry: 'beauty',
        keywords: expect.arrayContaining([
          'beauty',
          'skincare',
          'target-creator',
          'target creator',
        ]),
      }),
    )
    expect(result.sync).toEqual(
      expect.objectContaining({
        industry: 'beauty',
        platform: 'douyin',
        matchedCount: 1,
        pendingCount: 1,
      }),
    )
  })

  it('should aggregate hot contents by competitor identity', async () => {
    const orgId = new Types.ObjectId()
    const competitorId = new Types.ObjectId()

    competitorModel.find.mockReturnValue(
      createQueryResult([
        {
          _id: competitorId,
          orgId,
          platform: 'douyin',
          accountId: 'target-creator',
          accountName: 'target creator',
          accountUrl: 'https://www.douyin.com/user/target-creator',
          metrics: {},
          isActive: true,
          lastSyncedAt: new Date('2026-04-08T00:00:00.000Z'),
          createdAt: new Date('2026-04-08T00:00:00.000Z'),
          updatedAt: new Date('2026-04-08T00:00:00.000Z'),
        },
      ]),
    )
    viralContentModel.find.mockReturnValue(
      createQueryResult([
        {
          _id: new Types.ObjectId(),
          platform: 'douyin',
          videoId: 'video-1',
          title: '爆款拆解',
          author: 'target creator',
          viralScore: 88.2,
          views: 12000,
          likes: 900,
          comments: 100,
          shares: 50,
          industry: 'beauty',
          keywords: ['beauty'],
          contentUrl: 'https://example.com/target-creator/video-1',
          thumbnailUrl: 'https://example.com/thumb-1.jpg',
          discoveredAt: new Date('2026-04-08T00:00:00.000Z'),
          publishedAt: new Date('2026-04-07T00:00:00.000Z'),
        },
        {
          _id: new Types.ObjectId(),
          platform: 'douyin',
          videoId: 'video-2',
          title: '其他作者内容',
          author: 'other creator',
          viralScore: 91.5,
          views: 15000,
          likes: 1000,
          comments: 120,
          shares: 60,
          industry: 'beauty',
          keywords: ['beauty'],
          contentUrl: 'https://example.com/other/video-2',
          thumbnailUrl: 'https://example.com/thumb-2.jpg',
          discoveredAt: new Date('2026-04-08T00:00:00.000Z'),
          publishedAt: new Date('2026-04-07T00:00:00.000Z'),
        },
      ]),
    )

    const result = await service.getCompetitorHot(orgId.toString(), '7d', 3, 'douyin')

    expect(result.totalCompetitors).toBe(1)
    expect(result.matchedCompetitors).toBe(1)
    expect(result.totalItems).toBe(1)
    expect(result.items[0]?.competitor.accountId).toBe('target-creator')
    expect(result.items[0]?.items.map(item => item.videoId)).toEqual(['video-1'])
  })
})
