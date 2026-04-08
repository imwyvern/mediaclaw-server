import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AcquisitionService } from './acquisition.service'
import { ContentProvider } from './content-provider.interface'

describe('acquisitionService behavior', () => {
  let primaryProvider: ContentProvider
  let fallbackProvider: ContentProvider
  let service: AcquisitionService

  beforeEach(() => {
    primaryProvider = {
      providerName: 'primary',
      priority: 10,
      supportsPlatform: vi.fn().mockReturnValue(true),
      searchVideos: vi.fn(),
      getVideoDetail: vi.fn(),
      trackPerformance: vi.fn(),
      getSourceVideo: vi.fn(),
    }
    fallbackProvider = {
      providerName: 'fallback',
      priority: 20,
      supportsPlatform: vi.fn().mockReturnValue(true),
      searchVideos: vi.fn(),
      getVideoDetail: vi.fn(),
      trackPerformance: vi.fn(),
      getSourceVideo: vi.fn(),
    }

    service = new AcquisitionService([primaryProvider, fallbackProvider])
  })

  it('应在主 provider 不可用时回退到下一个 provider 搜索', async () => {
    vi.mocked(primaryProvider.searchVideos).mockResolvedValue({
      provider: 'primary',
      source: 'unavailable',
      reason: 'api_key_missing',
      platform: 'douyin',
      keyword: '护肤',
      limit: 10,
      items: [],
    })
    vi.mocked(fallbackProvider.searchVideos).mockResolvedValue({
      provider: 'fallback',
      source: 'mediacrawler',
      platform: 'douyin',
      keyword: '护肤',
      limit: 10,
      items: [
        {
          platform: 'douyin',
          videoId: 'video_1',
          title: '爆款拆解',
          author: 'creator_a',
          contentUrl: 'https://example.com/video_1',
          thumbnailUrl: 'https://example.com/video_1.jpg',
          publishedAt: '2026-04-08T00:00:00.000Z',
          metrics: {
            views: 1000,
            likes: 100,
            comments: 10,
            shares: 5,
          },
        },
      ],
    })

    const result = await service.searchVideos('douyin', '护肤', 10)

    expect(primaryProvider.searchVideos).toHaveBeenCalledWith('douyin', '护肤', 10)
    expect(fallbackProvider.searchVideos).toHaveBeenCalledWith('douyin', '护肤', 10)
    expect(result.provider).toBe('fallback')
    expect(result.source).toBe('mediacrawler')
    expect(result.items).toHaveLength(1)
  })

  it('应在详情查询异常时继续尝试下一个 provider', async () => {
    vi.mocked(primaryProvider.getVideoDetail).mockRejectedValue(new Error('timeout'))
    vi.mocked(fallbackProvider.getVideoDetail).mockResolvedValue({
      provider: 'fallback',
      source: 'mediacrawler',
      platform: 'xhs',
      videoId: 'note_1',
      data: {
        platform: 'xhs',
        videoId: 'note_1',
        title: '种草视频',
        author: 'creator_b',
        description: '内容详情',
        durationSeconds: 18,
        contentUrl: 'https://example.com/note_1',
        thumbnailUrl: 'https://example.com/note_1.jpg',
        metrics: {
          views: 2200,
          likes: 200,
          comments: 20,
          shares: 8,
        },
      },
    })

    const result = await service.getVideoDetail('xhs', 'note_1')

    expect(primaryProvider.getVideoDetail).toHaveBeenCalledWith('xhs', 'note_1')
    expect(fallbackProvider.getVideoDetail).toHaveBeenCalledWith('xhs', 'note_1')
    expect(result.provider).toBe('fallback')
    expect(result.data?.videoId).toBe('note_1')
  })

  it('应在全部 provider 失效时返回统一 unavailable 结果', async () => {
    vi.mocked(primaryProvider.trackPerformance).mockResolvedValue({
      provider: 'primary',
      source: 'unavailable',
      reason: 'not_supported',
      videoId: 'video_404',
      data: null,
    })
    vi.mocked(fallbackProvider.trackPerformance).mockRejectedValue(new Error('network_error'))

    const result = await service.trackPerformance('video_404')

    expect(result.source).toBe('unavailable')
    expect(result.reason).toContain('fallback:network_error')
    expect(result.videoId).toBe('video_404')
  })
})
