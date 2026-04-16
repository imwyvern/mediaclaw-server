import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { platformPackager } from './platform-packager'
import { remotionRender } from './remotion-render'

describe('platformPackager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env['GEMINI_API_KEY'] = 'test-key'
  })

  it('生成平台发布文案', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({
          title: '果泥啤酒新体验',
          description: '陈皮柚子铺啤酒，果泥入口即化，低度微醺刚好',
          hashtags: ['果泥啤酒', '微醺', '越小啤'],
        }) }] } }],
      }),
    })

    const result = await platformPackager({
      video: { assetId: 'v1', storageKey: '/tmp/v.mp4', sha256: 'abc', mimeType: 'video/mp4', durationSec: 15, width: 1080, height: 1920, fps: 30, hasAudio: true },
      platform: 'douyin',
      brand: { brandId: 'b1', brandName: '越小啤', industry: '啤酒' },
      product: { productId: 'p1', name: '陈皮柚子铺', features: ['果泥口感'], images: [] },
    })

    expect(result.title).toBe('果泥啤酒新体验')
    expect(result.hashtags).toHaveLength(3)
    expect(result.complianceCheck.passed).toBe(true)
  })
})

describe('remotionRender', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env['REMOTION_API_KEY'] = 'test-key'
    process.env['REMOTION_BASE_URL'] = 'https://api.remotion.test'
  })

  it('提交+轮询成功', async () => {
    // 提交渲染
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ renderId: 'render_123' }),
    })
    // 轮询 - done
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'done', outputUrl: 'https://cdn.test/output.mp4' }),
    })

    const result = await remotionRender({
      product: { productId: 'p1', name: '陈皮柚子铺', features: [], images: [] },
      templateId: 'product-showcase',
      durationSec: 15,
    })

    expect(result.renderJobId).toBe('render_123')
    expect(result.video.url).toBeUndefined() // storageKey is the URL
    expect(result.meta.status).toBe('success')
  }, 30_000)

  it('提交失败抛错', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })

    await expect(remotionRender({
      product: { productId: 'p1', name: 'test', features: [], images: [] },
      templateId: 'tpl',
      durationSec: 10,
    })).rejects.toThrow('Remotion API')
  })
})
