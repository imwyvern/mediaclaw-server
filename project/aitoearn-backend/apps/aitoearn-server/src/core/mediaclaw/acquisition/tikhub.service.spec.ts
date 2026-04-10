import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TikHubService } from './tikhub.service'

describe('tikHubService', () => {
  const originalApiKey = process.env['TIKHUB_API_KEY']
  let service: TikHubService

  beforeEach(() => {
    process.env['TIKHUB_API_KEY'] = 'test-key'
    service = new TikHubService()
  })

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env['TIKHUB_API_KEY']
    }
    else {
      process.env['TIKHUB_API_KEY'] = originalApiKey
    }
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('should use the documented TikHub search contracts for all supported platforms', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(JSON.stringify({
        code: 200,
        data: {},
      })),
    })
    vi.stubGlobal('fetch', fetchMock)

    const douyinResult = await service.searchVideos('douyin', '智能戒指', 3)
    const xhsResult = await service.searchVideos('xhs', '智能戒指', 3)
    const kuaishouResult = await service.searchVideos('kuaishou', '智能戒指', 3)
    const bilibiliResult = await service.searchVideos('bilibili', '智能戒指', 3)

    expect(douyinResult.request).toEqual(expect.objectContaining({
      method: 'POST',
      url: 'https://api.tikhub.io/api/v1/douyin/search/fetch_video_search_v2',
      body: expect.objectContaining({
        keyword: '智能戒指',
        cursor: 0,
        sort_type: '0',
        publish_time: '0',
        filter_duration: '0',
        content_type: '0',
        backtrace: '',
        search_id: '',
      }),
    }))
    expect(douyinResult.request.body).not.toHaveProperty('offset')
    expect(douyinResult.request.body).not.toHaveProperty('page')

    expect(xhsResult.request).toEqual(expect.objectContaining({
      method: 'GET',
      url: 'https://api.tikhub.io/api/v1/xiaohongshu/web/search_notes',
      query: expect.objectContaining({
        keyword: '智能戒指',
        page: 1,
        sort: 'general',
        noteType: '_1',
        noteTime: '',
      }),
    }))

    expect(kuaishouResult.request).toEqual(expect.objectContaining({
      method: 'GET',
      url: 'https://api.tikhub.io/api/v1/kuaishou/app/search_video_v2',
      query: expect.objectContaining({
        keyword: '智能戒指',
        page: 1,
      }),
    }))
    expect(kuaishouResult.request.query).not.toHaveProperty('pcursor')

    expect(bilibiliResult.request).toEqual(expect.objectContaining({
      method: 'GET',
      url: 'https://api.tikhub.io/api/v1/bilibili/web/fetch_general_search',
      query: expect.objectContaining({
        keyword: '智能戒指',
        order: 'totalrank',
        page: 1,
        page_size: 3,
      }),
    }))

    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('should parse nested douyin v2 search payloads from TikHub', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(JSON.stringify({
        code: 200,
        data: {
          business_data: [
            {
              data_id: '0',
              type: 1,
              data: {
                aweme_info: {
                  aweme_id: '7491626347946781989',
                  desc: '智能戒指测评',
                  create_time: 1775754401,
                  share_url: 'https://www.douyin.com/video/7491626347946781989',
                  author: {
                    nickname: '硬件实验室',
                  },
                  statistics: {
                    play_count: 3210,
                    digg_count: 210,
                    comment_count: 32,
                    share_count: 12,
                  },
                  video: {
                    cover: {
                      url_list: ['//example.com/douyin-cover.jpg'],
                    },
                  },
                },
              },
            },
          ],
        },
      })),
    }))

    const result = await service.searchVideos('douyin', '智能戒指', 3)

    expect(result.request.url).toBe('https://api.tikhub.io/api/v1/douyin/search/fetch_video_search_v2')
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        platform: 'douyin',
        videoId: '7491626347946781989',
        title: '智能戒指测评',
        author: '硬件实验室',
        contentUrl: 'https://www.douyin.com/video/7491626347946781989',
        thumbnailUrl: 'https://example.com/douyin-cover.jpg',
      }),
    )
    expect(result.items[0]?.metrics).toEqual({
      views: 3210,
      likes: 210,
      comments: 32,
      shares: 12,
    })
  })

  it.each(['xhs', 'kuaishou'] as const)(
    'should allow slower %s search requests to use an extended timeout',
    async (platform) => {
      vi.useFakeTimers()
      ;(service as any).maxAttempts = 1

      vi.stubGlobal('fetch', vi.fn().mockImplementation((_url, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          const signal = init?.signal as AbortSignal | undefined
          signal?.addEventListener('abort', () => {
            const abortError = new Error('aborted')
            abortError.name = 'AbortError'
            reject(abortError)
          })
        })
      }))

      const requestPromise = service.searchVideos(platform, '智能戒指', 3)
      let settled = false
      void requestPromise.then(
        () => {
          settled = true
        },
        () => {
          settled = true
        },
      )

      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(5001)
      expect(settled).toBe(false)

      await vi.advanceTimersByTimeAsync(7000)
      await expect(requestPromise).rejects.toThrow('TikHub request timed out after 12000ms')
    },
  )

  it('should parse nested bilibili search payloads from TikHub', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue(JSON.stringify({
        code: 200,
        data: {
          code: 0,
          data: {
            result: [
              {
                bvid: 'BV1AAAAA',
                title: '美妆教程一',
                author: 'creator-a',
                arcurl: 'https://www.bilibili.com/video/BV1AAAAA',
                pic: 'https://example.com/1.jpg',
                pubdate: 1775754401,
                play: 1000,
                like: 100,
                review: 20,
                share: 5,
              },
              {
                bvid: 'BV1BBBBB',
                title: '美妆教程二',
                author: 'creator-b',
                arcurl: 'https://www.bilibili.com/video/BV1BBBBB',
                pic: 'https://example.com/2.jpg',
                pubdate: 1775754301,
                play: 900,
                like: 90,
                review: 18,
                share: 4,
              },
            ],
          },
        },
      })),
    }))

    const result = await service.searchVideos('bilibili', '美妆', 2)

    expect(result.source).toBe('tikhub')
    expect(result.items).toHaveLength(2)
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        platform: 'bilibili',
        videoId: 'BV1AAAAA',
        title: '美妆教程一',
        author: 'creator-a',
      }),
    )
  })
})
