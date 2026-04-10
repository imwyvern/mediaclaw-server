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
    vi.unstubAllGlobals()
  })

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
