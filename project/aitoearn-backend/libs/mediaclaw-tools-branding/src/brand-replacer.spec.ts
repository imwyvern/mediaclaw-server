import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// 需要在 import 之前设置 env，因为模块顶层会读取
beforeEach(() => {
  process.env['VCE_API_KEY'] = 'test-vce-key'
  process.env['VCE_BASE_URL'] = 'https://api.vce.test'
  process.env['APIKEYCLAW_TOKEN'] = 'test-akc-key'
  process.env['APIKEYCLAW_BASE_URL'] = 'https://akc.test'
})

import { brandReplacer } from './brand-replacer'
import type { BrandReplacerInput, BrandProfile, ProductProfile, ImageAssetRef } from '@yikart/mediaclaw-shared-kernel'

const makeFrame = (): ImageAssetRef => ({
  assetId: 'f1', storageKey: '/tmp/frame.jpg', sha256: 'abc', mimeType: 'image/jpeg', width: 1080, height: 1920,
})

const makeBrand = (): BrandProfile => ({
  brandId: 'b1', brandName: '越小啤', industry: '啤酒', slogan: '果泥新体验',
})

const makeProduct = (): ProductProfile => ({
  productId: 'p1', name: '陈皮柚子铺啤酒', features: ['果泥口感', '低度微醺', '国潮设计'],
  images: [makeFrame()],
})

describe('brandReplacer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('VCE 成功时返回替换后帧', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { url: 'https://cdn.test/replaced.png', artifacts: [] } }),
    })

    const input: BrandReplacerInput = {
      sourceFrame: makeFrame(),
      targetBrand: makeBrand(),
      targetProduct: makeProduct(),
    }

    const result = await brandReplacer(input)

    expect(result.routeUsed).toBe('vce')
    expect(result.replacedFrame.url).toBe('https://cdn.test/replaced.png')
    expect(result.meta.status).toBe('success')
    expect(result.artifactHints).toEqual([])
  })

  it('VCE 失败回退 APIKeyClaw', async () => {
    // VCE 失败
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Error' })
    // APIKeyClaw 成功
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { url: 'https://cdn.test/akc-replaced.png', artifacts: ['slight blur'] } }),
    })

    const input: BrandReplacerInput = {
      sourceFrame: makeFrame(),
      targetBrand: makeBrand(),
      targetProduct: makeProduct(),
    }

    const result = await brandReplacer(input)

    expect(result.routeUsed).toBe('apikeyclaw')
    expect(result.artifactHints).toContain('slight blur')
    expect(result.meta.humanReviewRequired).toBe(true)
  })

  it('全部路由失败时抛错', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503, statusText: 'Unavailable' })

    const input: BrandReplacerInput = {
      sourceFrame: makeFrame(),
      targetBrand: makeBrand(),
      targetProduct: makeProduct(),
      routePolicy: ['vce'],
    }

    await expect(brandReplacer(input)).rejects.toThrow('品牌替换失败')
  })
})
