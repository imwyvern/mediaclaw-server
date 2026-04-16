import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { trendingScout } from './trending-scout'
import { contentPlanner } from './content-planner'
import { remixBrief } from './remix-brief'
import { performanceInsight } from './performance-insight'

describe('trendingScout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env['TIKHUB_API_KEY'] = 'test-key'
    process.env['TIKHUB_BASE_URL'] = 'https://api.tikhub.test'
  })

  it('discover 模式返回视频列表', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [
        { url: 'https://v.test/1', title: '热门视频1', likes: 1000, shares: 200, tags: ['美食'] },
        { url: 'https://v.test/2', title: '热门视频2', likes: 500, shares: 100, tags: ['种草'] },
      ] }),
    })

    const result = await trendingScout({ mode: 'discover', platform: 'douyin', days: 7, limit: 10 })
    expect(result.videos).toHaveLength(2)
    expect(result.videos![0].title).toBe('热门视频1')
  })

  it('competitor 模式返回竞品报告', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [
        { url: 'https://v.test/c1', postedAt: '2026-04-10', views: 5000, likes: 300, comments: 50, styles: ['种草'] },
      ] }),
    })

    const result = await trendingScout({ mode: 'competitor', competitorAccounts: ['brand_a'] })
    expect(result.competitorReport).toBeDefined()
    expect(result.competitorReport!.newVideos.length).toBeGreaterThan(0)
  })
})

describe('contentPlanner', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env['GEMINI_API_KEY'] = 'test-key'
  })

  it('生成周计划', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({
          weeklyPlan: [
            { day: '周一', contentType: '种草', platform: 'douyin', reason: '周一流量高' },
            { day: '周三', contentType: '测评', platform: 'xhs', reason: '小红书测评效果好' },
          ],
          summary: '本周重点种草+测评',
        }) }] } }],
      }),
    })

    const result = await contentPlanner({
      brand: { brandId: 'b1', brandName: '越小啤', industry: '啤酒' },
      products: [{ productId: 'p1', name: '陈皮柚子铺', features: [], images: [] }],
      recentPerformance: [{ contentType: '种草', avgViews: 5000, avgEngagementRate: 0.05 }],
      budgetRemaining: 10,
    })

    expect(result.weeklyPlan).toHaveLength(2)
    expect(result.weeklyPlan[0].day).toBe('周一')
  })
})

describe('remixBrief', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env['GEMINI_API_KEY'] = 'test-key'
  })

  it('生成复刻 brief', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({
          cuts: [
            { cutId: 'cut_0', startSec: 0, endSec: 5, motionType: 'PAN', motionPrompt: 'slow pan' },
            { cutId: 'cut_1', startSec: 5, endSec: 10, motionType: 'ZOOM', motionPrompt: 'zoom in' },
          ],
          script: [
            { lineId: 'line_0', text: '好喝的啤酒', durationSec: 2 },
          ],
        }) }] } }],
      }),
    })

    const result = await remixBrief({
      referenceUrl: 'https://v.test/ref',
      targetBrand: { brandId: 'b1', brandName: '越小啤', industry: '啤酒' },
      targetProduct: { productId: 'p1', name: '陈皮柚子铺', features: [], images: [] },
    })

    expect(result.brief.cuts).toHaveLength(2)
    expect(result.brief.script).toHaveLength(1)
    expect(result.brief.totalDurationSec).toBe(10)
    expect(result.brief.modelAllocation).toHaveLength(2)
  })
})

describe('performanceInsight', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env['TIKHUB_API_KEY'] = 'test-key'
    process.env['TIKHUB_BASE_URL'] = 'https://api.tikhub.test'
  })

  it('realtime 模式返回实时数据', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { views: 10000, likes: 500, comments: 80, shares: 120, saves: 200, benchmark: '高于行业均值' } }),
    })

    const result = await performanceInsight({ mode: 'realtime', videoId: 'vid_123', platform: 'douyin' })
    expect(result.realtime).toBeDefined()
    expect(result.realtime!.metrics.views).toBe(10000)
    expect(result.realtime!.benchmark).toBe('高于行业均值')
  })

  it('monthly 模式返回月报', async () => {
    const result = await performanceInsight({ mode: 'monthly', orgId: 'org_1', period: '2026-04' })
    expect(result.monthly).toBeDefined()
    expect(result.monthly!.period).toBe('2026-04')
  })
})
