import axios from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaCrawlerProClient } from './media-crawler-pro.client'

vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
    isAxiosError: (error: unknown) => Boolean((error as { isAxiosError?: boolean })?.isAxiosError),
  },
  isAxiosError: (error: unknown) => Boolean((error as { isAxiosError?: boolean })?.isAxiosError),
}))

describe('mediaCrawlerProClient behavior', () => {
  const postMock = vi.mocked(axios.post)

  beforeEach(() => {
    postMock.mockReset()
  })

  it('should skip dispatch when crawler base url is not configured', async () => {
    const client = new MediaCrawlerProClient({
      getString: vi.fn().mockReturnValue(''),
      getNumber: vi.fn().mockReturnValue(10000),
    } as any)

    const result = await client.submitSupplementalJob({
      platform: 'douyin',
      keyword: '护肤',
      depth: 2,
    })

    expect(result).toEqual(
      expect.objectContaining({
        enabled: false,
        status: 'skipped',
        items: [],
      }),
    )
    expect(postMock).not.toHaveBeenCalled()
  })

  it('should normalize dispatched payload and returned items from MediaCrawlerPro', async () => {
    postMock.mockResolvedValue({
      status: 202,
      data: {
        data: {
          jobId: 'mcp-job-1',
          status: 'completed',
          items: [
            {
              id: 'video-1',
              title: '补采内容',
              nickname: 'creator-a',
              url: 'https://example.com/video-1',
              coverUrl: 'https://example.com/thumb-1.jpg',
              createdAt: '2026-04-09T00:00:00.000Z',
              metrics: {
                views: 1200,
                likes: 88,
                comments: 12,
                shares: 6,
              },
            },
          ],
        },
      },
    } as any)

    const getString = vi.fn((keys: string | string[], fallback = '') => {
      const joined = Array.isArray(keys) ? keys.join(',') : keys
      if (joined.includes('BASE_URL')) {
        return 'http://crawler:8888'
      }
      if (joined.includes('TOKEN')) {
        return 'secret-token'
      }

      return fallback
    })
    const client = new MediaCrawlerProClient({
      getString,
      getNumber: vi.fn().mockReturnValue(9000),
    } as any)

    const result = await client.submitSupplementalJob({
      platform: 'douyin',
      keyword: '护肤',
      depth: 2,
    })

    expect(postMock).toHaveBeenCalledWith(
      'http://crawler:8888/internal/media-crawler-pro/jobs',
      {
        platform: 'douyin',
        keyword: '护肤',
        depth: 2,
      },
      expect.objectContaining({
        timeout: 9000,
        headers: expect.objectContaining({
          'Authorization': 'Bearer secret-token',
          'x-mediaclaw-source': 'mediaclaw-discovery',
        }),
      }),
    )
    expect(result).toEqual(
      expect.objectContaining({
        enabled: true,
        status: 'completed',
        jobId: 'mcp-job-1',
        httpStatus: 202,
        items: [
          expect.objectContaining({
            platform: 'douyin',
            videoId: 'video-1',
            author: 'creator-a',
          }),
        ],
      }),
    )
  })
})
