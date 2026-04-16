import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MediaclawService } from './mediaclaw.service'

// Mock all tool modules
vi.mock('@yikart/mediaclaw-tools-ingest', () => ({
  videoDownload: vi.fn().mockResolvedValue({
    video: { assetId: 'dl1', storageKey: '/tmp/dl.mp4', sha256: 'a', mimeType: 'video/mp4', durationSec: 15, width: 1080, height: 1920, fps: 30, hasAudio: true },
    meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0, humanReviewRequired: false, sideEffects: [] },
  }),
  sceneCutter: vi.fn().mockResolvedValue({
    cuts: [{ cutId: 'c1', startSec: 0, endSec: 5, video: { assetId: 'cut1', storageKey: '/tmp/cut1.mp4', sha256: 'b', mimeType: 'video/mp4', durationSec: 5, width: 1080, height: 1920, fps: 30, hasAudio: true } }],
    meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0, humanReviewRequired: false, sideEffects: [] },
  }),
  motionAnalyzer: vi.fn().mockResolvedValue({
    segments: [{ cutId: 'c1', motionType: 'zoom_in', motionPrompt: 'slow zoom in', confidence: 0.9 }],
    meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0, humanReviewRequired: false, sideEffects: [] },
  }),
}))

vi.mock('@yikart/mediaclaw-tools-branding', () => ({
  brandReplacer: vi.fn().mockResolvedValue({
    video: { assetId: 'br1', storageKey: '/tmp/br.mp4', sha256: 'c', mimeType: 'video/mp4', durationSec: 15, width: 1080, height: 1920, fps: 30, hasAudio: true },
    replacements: [],
    meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0, humanReviewRequired: false, sideEffects: [] },
  }),
}))

vi.mock('@yikart/mediaclaw-tools-generation', () => ({
  videoGenerator: vi.fn().mockResolvedValue({
    video: { assetId: 'gen1', storageKey: '/tmp/gen.mp4', sha256: 'd', mimeType: 'video/mp4', durationSec: 5, width: 1080, height: 1920, fps: 30, hasAudio: false },
    estimatedCostYuan: 0.3,
    meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0.3, humanReviewRequired: false, sideEffects: [] },
  }),
}))

vi.mock('@yikart/mediaclaw-tools-audio-text', () => ({
  scriptWriter: vi.fn().mockResolvedValue({
    lines: [{ lineId: 'l1', text: '产品文案', durationSec: 3 }],
    fullScript: '产品文案',
    meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0.01, humanReviewRequired: false, sideEffects: [] },
  }),
  ttsEngine: vi.fn().mockResolvedValue({
    audioSegments: [],
    mergedAudio: { assetId: 'tts1', storageKey: '/tmp/tts.mp3', sha256: 'e', mimeType: 'audio/mpeg' },
    meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0.02, humanReviewRequired: false, sideEffects: [] },
  }),
}))

vi.mock('@yikart/mediaclaw-tools-compose', () => ({
  videoAssembler: vi.fn().mockResolvedValue({
    video: { assetId: 'asm1', storageKey: '/tmp/asm.mp4', sha256: 'f', mimeType: 'video/mp4', durationSec: 15, width: 1080, height: 1920, fps: 30, hasAudio: true },
    meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0, humanReviewRequired: false, sideEffects: [] },
  }),
  finalComposer: vi.fn().mockResolvedValue({
    video: { assetId: 'final1', storageKey: '/tmp/final.mp4', sha256: 'g', mimeType: 'video/mp4', durationSec: 15, width: 1080, height: 1920, fps: 30, hasAudio: true },
    meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0, humanReviewRequired: false, sideEffects: [] },
  }),
}))

vi.mock('@yikart/mediaclaw-tools-quality', () => ({
  qaOptimizer: vi.fn().mockResolvedValue({
    passed: true, qaScore: 90, issues: [],
    meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0, humanReviewRequired: false, sideEffects: [] },
  }),
  dedupGatekeeper: vi.fn().mockResolvedValue({
    isDuplicate: false, similarityScore: 0.1, closestMatch: null,
    meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0, humanReviewRequired: false, sideEffects: [] },
  }),
  contentReviewer: vi.fn().mockResolvedValue({
    passed: true, warnings: [], violations: [],
    meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0, humanReviewRequired: false, sideEffects: [] },
  }),
}))

vi.mock('@yikart/mediaclaw-tools-intelligence', () => ({
  trendingScout: vi.fn().mockResolvedValue({
    videos: [{ url: 'https://example.com/v1', title: '热门', likes: 10000 }],
    meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0, humanReviewRequired: false, sideEffects: [] },
  }),
  contentPlanner: vi.fn().mockResolvedValue({
    weeklyPlan: [{ day: '周一', contentType: '种草', platform: 'douyin', reason: '高转化' }],
    meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0.01, humanReviewRequired: false, sideEffects: [] },
  }),
  remixBrief: vi.fn().mockResolvedValue({
    brief: { totalDurationSec: 15, cuts: [], script: [], modelAllocation: [], estimatedCostYuan: 1, estimatedTimeMin: 5 },
    meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0.01, humanReviewRequired: false, sideEffects: [] },
  }),
  performanceInsight: vi.fn().mockResolvedValue({
    realtime: { videoId: 'v1', platform: 'douyin', metrics: { views: 1000, likes: 50, comments: 10, shares: 5 }, benchmark: '高于均值', diagnosis: '内容质量好', actionSuggestion: '保持节奏' },
    meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0, humanReviewRequired: false, sideEffects: [] },
  }),
}))

vi.mock('@yikart/mediaclaw-tools-platform', () => ({
  platformPackager: vi.fn().mockResolvedValue({
    title: '测试标题',
    coverImage: { assetId: 'cover', storageKey: '/tmp/cover.jpg', sha256: 'h', mimeType: 'image/jpeg', width: 1080, height: 1920 },
    hashtags: ['#种草'],
    description: '描述',
    complianceCheck: { passed: true, warnings: [], violations: [] },
    meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0, humanReviewRequired: false, sideEffects: [] },
  }),
}))

describe('MediaclawService', () => {
  let service: MediaclawService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new MediaclawService()
  })

  it('runProductShowcase 成功执行管线', async () => {
    const input = {
      brief: {
        totalDurationSec: 15,
        cuts: [{ cutId: 'c1', startSec: 0, endSec: 5, motionType: 'zoom_in', motionPrompt: 'slow zoom' }],
        script: [{ lineId: 'l1', text: '好用', durationSec: 3 }],
        modelAllocation: [{ cutId: 'c1', model: 'seedance-1.5', reason: 'cost' }],
        estimatedCostYuan: 1,
        estimatedTimeMin: 5,
      },
      targetBrand: { brandId: 'b1', brandName: '测试品牌', industry: 'beauty' },
      targetProduct: { productId: 'p1', name: '面霜', features: ['保湿'], images: [] },
      qualityLevel: 'standard',
    }

    const result = await service.runProductShowcase(input)
    expect(result).toBeDefined()
    expect(result.finalVideo).toBeDefined()
    expect(result.costBreakdown).toBeDefined()
  })

  it('scoutTrending 返回趋势视频', async () => {
    const result = await service.scoutTrending({
      mode: 'discover',
      category: 'beauty',
      platform: 'douyin',
    })
    expect(result).toBeDefined()
    expect(result.videos).toHaveLength(1)
  })

  it('getInsight 返回实时洞察', async () => {
    const result = await service.getInsight('video_123', 'douyin')
    expect(result).toBeDefined()
    expect(result.realtime).toBeDefined()
  })

  it('planContent 返回周计划', async () => {
    const result = await service.planContent({
      brand: { brandId: 'b1', brandName: '测试', industry: 'beauty' },
      products: [{ productId: 'p1', name: '面霜', features: ['保湿'], images: [] }],
      recentPerformance: [{ contentType: '种草', avgViews: 5000, avgEngagementRate: 0.05 }],
      budgetRemaining: 100,
    })
    expect(result).toBeDefined()
    expect(result.weeklyPlan).toHaveLength(1)
  })

  it('packageForPlatform 包装成功', async () => {
    const result = await service.packageForPlatform({
      videoAssetId: 'v1',
      platform: 'douyin',
      brand: { brandId: 'b1', brandName: '测试', industry: 'beauty' },
      product: { productId: 'p1', name: '面霜', features: ['保湿'], images: [] },
    })
    expect(result).toBeDefined()
    expect(result.title).toBe('测试标题')
    expect(result.hashtags).toContain('#种草')
  })
})
