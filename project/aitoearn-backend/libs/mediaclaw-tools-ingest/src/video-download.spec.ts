import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock node:child_process — promisify 兼容
const mockExecFile = vi.fn()
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => {
    // 如果最后一个参数是 callback，走 callback 模式
    const lastArg = args[args.length - 1]
    if (typeof lastArg === 'function') {
      return mockExecFile(...args)
    }
    // promisify 模式：返回 Promise
    return new Promise((resolve, reject) => {
      const cb = (err: unknown, stdout: string, stderr: string) => {
        if (err) reject(err)
        else resolve({ stdout, stderr })
      }
      mockExecFile(...args, cb)
    })
  },
}))

// Mock node:fs/promises
vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockResolvedValue({ size: 1024 }),
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(Buffer.from('fake-video')),
}))

// Mock global fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { videoDownload } from './video-download'
import type { VideoDownloadInput } from '@yikart/mediaclaw-shared-kernel'

describe('videoDownload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env['TIKHUB_API_KEY'] = 'test-key'
    process.env['TIKHUB_BASE_URL'] = 'https://api.tikhub.io'
    process.env['MEDIA_TEMP_DIR'] = '/tmp/mediaclaw-test'
  })

  it('TikHub 成功时返回 tikhub sourceUsed', async () => {
    // TikHub API 返回视频链接
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { video_url: 'https://example.com/video.mp4' },
        }),
      })
      // 下载视频文件
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(100),
      })

    // Mock execFile for ffprobe
    mockExecFile.mockImplementation((cmd: string, _args: unknown, _opts: unknown, cb?: unknown) => {
      if (typeof _opts === 'function') { cb = _opts }
      if (typeof cb === 'function') {
        cb(null, JSON.stringify({
          format: { duration: '15.5' },
          streams: [
            { codec_type: 'video', width: 1080, height: 1920, r_frame_rate: '30/1' },
            { codec_type: 'audio' },
          ],
        }), '')
      }
    })

    const input: VideoDownloadInput = {
      sourceUrl: 'https://www.tiktok.com/@user/video/123',
    }

    const result = await videoDownload(input)

    expect(result.sourceUsed).toBe('tikhub')
    expect(result.fallbackAttempts).toBe(0)
    expect(result.meta.status).toBe('success')
    expect(result.meta.errorCode).toBe('NONE')
    expect(result.video.mimeType).toBe('video/mp4')
  }, 15_000)

  it('TikHub 失败时回退到 yt-dlp', async () => {
    // TikHub API 失败
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    })

    // Mock execFile for yt-dlp + ffprobe
    mockExecFile.mockImplementation((cmd: string, _args: unknown, _opts: unknown, cb?: unknown) => {
      if (typeof _opts === 'function') { cb = _opts }
      if (typeof cb === 'function') {
        if (cmd === 'yt-dlp') {
          cb(null, '', '')
        } else {
          // ffprobe
          cb(null, JSON.stringify({
            format: { duration: '10' },
            streams: [{ codec_type: 'video', width: 720, height: 1280, r_frame_rate: '30/1' }],
          }), '')
        }
      }
    })

    const input: VideoDownloadInput = {
      sourceUrl: 'https://www.tiktok.com/@user/video/456',
    }

    const result = await videoDownload(input)

    expect(result.sourceUsed).toBe('yt-dlp')
    expect(result.fallbackAttempts).toBe(1)
    expect(result.meta.status).toBe('success')
  }, 15_000)

  it('全部失败时抛出错误', async () => {
    // TikHub 失败
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Error',
    })

    // yt-dlp 也失败
    mockExecFile.mockImplementation((_cmd: string, _args: unknown, _opts: unknown, cb?: unknown) => {
      if (typeof _opts === 'function') { cb = _opts }
      if (typeof cb === 'function') {
        cb(new Error('yt-dlp not found'), '', '')
      }
    })

    const input: VideoDownloadInput = {
      sourceUrl: 'https://example.com/video',
    }

    await expect(videoDownload(input)).rejects.toThrow('下载失败')
  }, 15_000)
})
