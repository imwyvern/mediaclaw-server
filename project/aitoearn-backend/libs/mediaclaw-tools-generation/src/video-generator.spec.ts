import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { videoGenerator } from './video-generator'
import type { VideoGeneratorInput, ImageAssetRef } from '@yikart/mediaclaw-shared-kernel'

const makeFrame = (): ImageAssetRef => ({
  assetId: 'f1', storageKey: '/tmp/frame.jpg', url: 'https://cdn.test/frame.jpg',
  sha256: 'abc', mimeType: 'image/jpeg', width: 1080, height: 1920,
})

describe('videoGenerator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env['SEEDANCE_API_KEY'] = 'test-key'
    process.env['VCE_BASE_URL'] = 'https://api.vce.test'
  })

  it('提交+轮询成功返回视频', async () => {
    // 提交任务
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { task_id: 'task_123' } }),
    })
    // 轮询 - 第一次 processing
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { task_status: 'processing' } }),
    })
    // 轮询 - 第二次 succeed
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          task_status: 'succeed',
          task_result: { videos: [{ url: 'https://cdn.test/output.mp4' }] },
        },
      }),
    })

    const input: VideoGeneratorInput = {
      firstFrame: makeFrame(),
      motionPrompt: 'slow zoom in',
      model: 'seedance-1.5',
      durationSec: 5,
    }

    const result = await videoGenerator(input)

    expect(result.modelUsed).toBe('seedance-1.5')
    expect(result.video.url).toBe('https://cdn.test/output.mp4')
    expect(result.meta.status).toBe('success')
    expect(result.estimatedCostYuan).toBe(0.3)
  }, 30_000)

  it('seedance-2.0 成本更高', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { task_id: 't1' } }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { task_status: 'succeed', task_result: { videos: [{ url: 'https://cdn.test/v2.mp4' }] } },
        }),
      })

    const input: VideoGeneratorInput = {
      firstFrame: makeFrame(),
      motionPrompt: 'cinematic pan',
      model: 'seedance-2.0',
      durationSec: 5,
    }

    const result = await videoGenerator(input)
    expect(result.estimatedCostYuan).toBe(0.8)
  }, 30_000)

  it('提交失败抛错', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Error' })

    const input: VideoGeneratorInput = {
      firstFrame: makeFrame(),
      motionPrompt: 'pan',
      model: 'seedance-1.5',
      durationSec: 5,
    }

    await expect(videoGenerator(input)).rejects.toThrow('生成任务提交失败')
  })
})
