/**
 * Smoke test: runs all 3 pipelines through MediaclawService with mock tools.
 * Validates that each pipeline flows start-to-finish and produces a valid result.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaclawService } from './mediaclaw.service'
import type { PipelineEvent } from '@yikart/mediaclaw-agent-runtime'

// ── Helpers (inline in factories since vi.mock is hoisted) ─────────
function m() {
  return { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0, humanReviewRequired: false, sideEffects: [] }
}
function vid() {
  return { assetId: 'v1', storageKey: '/tmp/v1.mp4', sha256: 'abc', mimeType: 'video/mp4', durationSec: 15, width: 1080, height: 1920, fps: 30, hasAudio: true }
}
function img() {
  return { assetId: 'img1', storageKey: '/tmp/img.jpg', sha256: 'def', mimeType: 'image/jpeg', width: 1080, height: 1920 }
}

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

vi.mock('@yikart/mediaclaw-tools-ingest', () => ({
  videoDownload: vi.fn().mockImplementation(async () => ({
    video: { assetId: 'v1', storageKey: '/tmp/v1.mp4', sha256: 'abc', mimeType: 'video/mp4', durationSec: 15, width: 1080, height: 1920, fps: 30, hasAudio: true },
    sourceUsed: 'tikhub', fallbackAttempts: 0,
    meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0, humanReviewRequired: false, sideEffects: [] },
  })),
  sceneCutter: vi.fn().mockImplementation(async () => ({
    cuts: [{ cutId: 'c1', startSec: 0, endSec: 5, firstFrame: { assetId: 'img1', storageKey: '/tmp/img.jpg', sha256: 'def', mimeType: 'image/jpeg', width: 1080, height: 1920 } }],
    meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0, humanReviewRequired: false, sideEffects: [] },
  })),
  motionAnalyzer: vi.fn().mockImplementation(async () => ({
    segments: [{ cutId: 'c1', motionType: 'pan', confidence: 0.9, motionPrompt: 'smooth pan right' }],
    meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0, humanReviewRequired: false, sideEffects: [] },
  })),
}))

vi.mock('@yikart/mediaclaw-tools-branding', () => ({
  brandReplacer: vi.fn().mockImplementation(async () => ({
    video: { assetId: 'v1', storageKey: '/tmp/v1.mp4', sha256: 'abc', mimeType: 'video/mp4', durationSec: 15, width: 1080, height: 1920, fps: 30, hasAudio: true },
    replacements: [{ region: 'logo', confidence: 0.95 }],
    meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0, humanReviewRequired: false, sideEffects: [] },
  })),
}))

vi.mock('@yikart/mediaclaw-tools-generation', () => ({
  videoGenerator: vi.fn().mockImplementation(async () => ({
    video: { assetId: 'v1', storageKey: '/tmp/v1.mp4', sha256: 'abc', mimeType: 'video/mp4', durationSec: 15, width: 1080, height: 1920, fps: 30, hasAudio: true },
    estimatedCostYuan: 0.3,
    meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0.3, humanReviewRequired: false, sideEffects: [] },
  })),
}))

vi.mock('@yikart/mediaclaw-tools-audio-text', () => ({
  scriptWriter: vi.fn().mockImplementation(async () => ({
    lines: [{ lineId: 'l1', text: '测试文案', durationSec: 3 }], fullScript: '测试文案',
    meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0.01, humanReviewRequired: false, sideEffects: [] },
  })),
  ttsEngine: vi.fn().mockImplementation(async () => ({
    audioSegments: [], mergedAudio: { assetId: 'aud1', storageKey: '/tmp/aud.mp3', sha256: 'ghi', mimeType: 'audio/mpeg' },
    meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0.02, humanReviewRequired: false, sideEffects: [] },
  })),
}))

vi.mock('@yikart/mediaclaw-tools-compose', () => ({
  videoAssembler: vi.fn().mockImplementation(async () => ({
    video: { assetId: 'asm1', storageKey: '/tmp/asm.mp4', sha256: 'f', mimeType: 'video/mp4', durationSec: 15, width: 1080, height: 1920, fps: 30, hasAudio: true },
    meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0, humanReviewRequired: false, sideEffects: [] },
  })),
  finalComposer: vi.fn().mockImplementation(async () => ({
    video: { assetId: 'final1', storageKey: '/tmp/final.mp4', sha256: 'g', mimeType: 'video/mp4', durationSec: 15, width: 1080, height: 1920, fps: 30, hasAudio: true },
    meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0, humanReviewRequired: false, sideEffects: [] },
  })),
}))

vi.mock('@yikart/mediaclaw-tools-quality', () => ({
  qaOptimizer: vi.fn().mockImplementation(async () => ({
    passed: true, qaScore: 92, issues: [],
    meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0, humanReviewRequired: false, sideEffects: [] },
  })),
  dedupGatekeeper: vi.fn().mockImplementation(async () => ({
    isDuplicate: false, similarityScore: 0.05, closestMatch: null,
    meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0, humanReviewRequired: false, sideEffects: [] },
  })),
  contentReviewer: vi.fn().mockImplementation(async () => ({
    passed: true, warnings: [], violations: [],
    meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0, humanReviewRequired: false, sideEffects: [] },
  })),
}))

vi.mock('@yikart/mediaclaw-tools-intelligence', () => ({
  trendingScout: vi.fn().mockImplementation(async () => ({
    videos: [{ url: 'https://example.com/v1', title: '热门', likes: 10000 }],
    meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0, humanReviewRequired: false, sideEffects: [] },
  })),
  contentPlanner: vi.fn().mockImplementation(async () => ({
    weeklyPlan: [{ day: '周一', contentType: '种草', platform: 'douyin', reason: '高转化' }],
    meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0.01, humanReviewRequired: false, sideEffects: [] },
  })),
  remixBrief: vi.fn().mockImplementation(async () => ({
    brief: { totalDurationSec: 15, cuts: [{ cutId: 'c1', startSec: 0, endSec: 5 }], script: [{ lineId: 'l1', text: '文案', durationSec: 3 }], modelAllocation: [{ cutId: 'c1', model: 'seedance-1.5' }], estimatedCostYuan: 1, estimatedTimeMin: 5 },
    meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0.01, humanReviewRequired: false, sideEffects: [] },
  })),
  performanceInsight: vi.fn().mockImplementation(async () => ({
    realtime: { videoId: 'v1', platform: 'douyin', metrics: { views: 1000, likes: 50, comments: 10, shares: 5 }, benchmark: '好', diagnosis: '好', actionSuggestion: '保持' },
    meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0, humanReviewRequired: false, sideEffects: [] },
  })),
}))

vi.mock('@yikart/mediaclaw-tools-platform', () => ({
  platformPackager: vi.fn().mockImplementation(async () => ({
    title: '测试标题', coverImage: { assetId: 'cover', storageKey: '/tmp/cover.jpg', sha256: 'h', mimeType: 'image/jpeg', width: 1080, height: 1920 },
    hashtags: ['#种草'], description: '描述', complianceCheck: { passed: true, warnings: [], violations: [] },
    meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0, humanReviewRequired: false, sideEffects: [] },
  })),
  remotionRender: vi.fn().mockImplementation(async () => ({
    video: { assetId: 'v1', storageKey: '/tmp/v1.mp4', sha256: 'abc', mimeType: 'video/mp4', durationSec: 15, width: 1080, height: 1920, fps: 30, hasAudio: true },
    meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0, humanReviewRequired: false, sideEffects: [] },
  })),
}))

// ── Tests ──────────────────────────────────────────────────────────
describe('MediaClaw Smoke Tests — Full Pipeline', () => {
  let service: MediaclawService

  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
    service = new MediaclawService()
  })

  afterAll(() => { vi.restoreAllMocks() })

  // ─── Pipeline 1: Product Showcase ───────────────────────────────
  it('runProductShowcase: full pipeline with events', async () => {
    const events: PipelineEvent[] = []
    const result = await service.runProductShowcase(
      {
        brief: {
          totalDurationSec: 15,
          cuts: [{ cutId: 'c1', startSec: 0, endSec: 5, motionType: 'pan', motionPrompt: 'smooth pan right' }],
          script: [{ lineId: 'l1', text: '测试', durationSec: 3 }],
          modelAllocation: [{ cutId: 'c1', model: 'seedance-1.5' }],
          estimatedCostYuan: 1,
          estimatedTimeMin: 5,
        },
        targetBrand: { brandId: 'b1', brandName: '测试品牌', industry: 'beauty' },
        targetProduct: { productId: 'p1', name: '测试面霜', features: ['保湿', '美白'], images: ['https://example.com/img.jpg'] },
        qualityLevel: 'standard',
      },
      (event) => { events.push(event) },
    )

    expect(result).toBeDefined()
    expect(result.finalVideo).toBeDefined()
    expect(result.finalVideo.assetId).toBeTruthy()
    expect(result.qualityReport).toBeDefined()
    expect(result.state).toBeDefined()
    expect(['PRODUCING', 'QA_PASSED', 'SUSPENDED']).toContain(result.state)
    expect(events.length).toBeGreaterThan(0)
    // Events should have at least some successful steps
    expect(events.some(e => e.status === 'completed' || e.status === 'success')).toBe(true)
  })

  // ─── Pipeline 2: AI Live ────────────────────────────────────────
  it('runAiLive: full pipeline', async () => {
    const result = await service.runAiLive({
      productImages: [{ assetId: 'img1', storageKey: '/tmp/img.jpg', sha256: 'abc', mimeType: 'image/jpeg', width: 1080, height: 1920 }],
      motionPrompts: ['slow zoom in on product'],
      model: 'seedance-1.5',
      durationSec: 5,
    })

    expect(result).toBeDefined()
    expect(result.finalVideo).toBeDefined()
    expect(result.finalVideo.assetId).toBeTruthy()
    expect(result.state).toBeDefined()
  })

  // ─── Pipeline 3: Explainer ──────────────────────────────────────
  it('runExplainer: full pipeline', async () => {
    const result = await service.runExplainer({
      product: { productId: 'p1', name: '测试面霜', features: ['保湿'], images: [] },
      templateId: 'b10-explainer',
      durationSec: 30,
    })

    expect(result).toBeDefined()
    expect(result.finalVideo).toBeDefined()
    expect(result.state).toBeDefined()
  })

  // ─── Standalone Tools ───────────────────────────────────────────
  it('createRemixBrief returns valid brief', async () => {
    const result = await service.createRemixBrief({
      referenceUrl: 'https://www.douyin.com/video/123',
      targetBrand: { brandId: 'b1', brandName: '测试', industry: 'beauty' },
      targetProduct: { productId: 'p1', name: '面霜', features: ['保湿'], images: [] },
    })
    expect(result.brief).toBeDefined()
    expect(result.brief.totalDurationSec).toBeGreaterThan(0)
  })

  it('scoutTrending returns videos', async () => {
    const result = await service.scoutTrending({ mode: 'discover', category: 'beauty' })
    expect(result.videos).toHaveLength(1)
  })

  it('planContent returns weekly plan', async () => {
    const result = await service.planContent({
      brand: { brandId: 'b1', brandName: '测试', industry: 'beauty' },
      products: [{ productId: 'p1', name: '面霜', features: ['保湿'], images: [] }],
      recentPerformance: [{ contentType: '种草', avgViews: 5000, avgEngagementRate: 0.05 }],
      budgetRemaining: 100,
    })
    expect(result.weeklyPlan).toBeDefined()
  })

  it('packageForPlatform returns packaged content', async () => {
    const result = await service.packageForPlatform({
      videoAssetId: 'v1', platform: 'douyin',
      brand: { brandId: 'b1', brandName: '测试', industry: 'beauty' },
      product: { productId: 'p1', name: '面霜', features: ['保湿'], images: [] },
    })
    expect(result.title).toBeTruthy()
  })

  it('getInsight returns realtime data', async () => {
    const result = await service.getInsight('video-123', 'douyin')
    expect(result.realtime).toBeDefined()
    expect(result.realtime.videoId).toBe('v1')
  })

  // ─── Error resilience ──────────────────────────────────────────
  it('pipeline event callback async error does not crash pipeline', async () => {
    const result = await service.runProductShowcase(
      {
        brief: { totalDurationSec: 15, cuts: [{ cutId: 'c1', startSec: 0, endSec: 5 }], script: [], modelAllocation: [], estimatedCostYuan: 1, estimatedTimeMin: 5 },
        targetBrand: { brandId: 'b1', brandName: '测试', industry: 'beauty' },
        targetProduct: { productId: 'p1', name: '面霜', features: [], images: [] },
        qualityLevel: 'standard',
      },
      async () => { await Promise.reject(new Error('async callback error')) },
    )
    expect(result).toBeDefined()
    expect(result.finalVideo).toBeDefined()
  })
})
