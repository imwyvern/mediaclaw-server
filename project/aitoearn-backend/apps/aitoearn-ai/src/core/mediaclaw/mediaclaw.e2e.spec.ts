import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MediaclawController } from './mediaclaw.controller'
import { MediaclawService } from './mediaclaw.service'

// Mock all tool modules
vi.mock('@yikart/mediaclaw-tools-ingest', () => ({
  videoDownload: vi.fn().mockResolvedValue({ video: { assetId: 'dl1', storageKey: '/tmp/dl.mp4', sha256: 'a', mimeType: 'video/mp4', durationSec: 15, width: 1080, height: 1920, fps: 30, hasAudio: true }, meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0, humanReviewRequired: false, sideEffects: [] } }),
  sceneCutter: vi.fn().mockResolvedValue({ cuts: [{ cutId: 'c1', startSec: 0, endSec: 5, video: { assetId: 'cut1', storageKey: '/tmp/cut1.mp4', sha256: 'b', mimeType: 'video/mp4', durationSec: 5, width: 1080, height: 1920, fps: 30, hasAudio: true } }], meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0, humanReviewRequired: false, sideEffects: [] } }),
  motionAnalyzer: vi.fn().mockResolvedValue({ segments: [], meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0, humanReviewRequired: false, sideEffects: [] } }),
}))
vi.mock('@yikart/mediaclaw-tools-branding', () => ({
  brandReplacer: vi.fn().mockResolvedValue({ video: { assetId: 'br1', storageKey: '/tmp/br.mp4', sha256: 'c', mimeType: 'video/mp4', durationSec: 15, width: 1080, height: 1920, fps: 30, hasAudio: true }, replacements: [], meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0, humanReviewRequired: false, sideEffects: [] } }),
}))
vi.mock('@yikart/mediaclaw-tools-generation', () => ({
  videoGenerator: vi.fn().mockResolvedValue({ video: { assetId: 'gen1', storageKey: '/tmp/gen.mp4', sha256: 'd', mimeType: 'video/mp4', durationSec: 5, width: 1080, height: 1920, fps: 30, hasAudio: false }, estimatedCostYuan: 0.3, meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0.3, humanReviewRequired: false, sideEffects: [] } }),
}))
vi.mock('@yikart/mediaclaw-tools-audio-text', () => ({
  scriptWriter: vi.fn().mockResolvedValue({ lines: [{ lineId: 'l1', text: '文案', durationSec: 3 }], fullScript: '文案', meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0.01, humanReviewRequired: false, sideEffects: [] } }),
  ttsEngine: vi.fn().mockResolvedValue({ audioSegments: [], mergedAudio: { assetId: 'tts1', storageKey: '/tmp/tts.mp3', sha256: 'e', mimeType: 'audio/mpeg' }, meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0.02, humanReviewRequired: false, sideEffects: [] } }),
}))
vi.mock('@yikart/mediaclaw-tools-compose', () => ({
  videoAssembler: vi.fn().mockResolvedValue({ video: { assetId: 'asm1', storageKey: '/tmp/asm.mp4', sha256: 'f', mimeType: 'video/mp4', durationSec: 15, width: 1080, height: 1920, fps: 30, hasAudio: true }, meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0, humanReviewRequired: false, sideEffects: [] } }),
  finalComposer: vi.fn().mockResolvedValue({ video: { assetId: 'final1', storageKey: '/tmp/final.mp4', sha256: 'g', mimeType: 'video/mp4', durationSec: 15, width: 1080, height: 1920, fps: 30, hasAudio: true }, meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0, humanReviewRequired: false, sideEffects: [] } }),
}))
vi.mock('@yikart/mediaclaw-tools-quality', () => ({
  qaOptimizer: vi.fn().mockResolvedValue({ passed: true, qaScore: 90, issues: [], meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0, humanReviewRequired: false, sideEffects: [] } }),
  dedupGatekeeper: vi.fn().mockResolvedValue({ isDuplicate: false, similarityScore: 0.1, closestMatch: null, meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0, humanReviewRequired: false, sideEffects: [] } }),
  contentReviewer: vi.fn().mockResolvedValue({ passed: true, warnings: [], violations: [], meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0, humanReviewRequired: false, sideEffects: [] } }),
}))
vi.mock('@yikart/mediaclaw-tools-intelligence', () => ({
  trendingScout: vi.fn().mockResolvedValue({ videos: [{ url: 'https://example.com/v1', title: '热门', likes: 10000 }], meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0, humanReviewRequired: false, sideEffects: [] } }),
  contentPlanner: vi.fn().mockResolvedValue({ weeklyPlan: [{ day: '周一', contentType: '种草', platform: 'douyin', reason: '高转化' }], meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0.01, humanReviewRequired: false, sideEffects: [] } }),
  remixBrief: vi.fn().mockResolvedValue({ brief: { totalDurationSec: 15, cuts: [], script: [], modelAllocation: [], estimatedCostYuan: 1, estimatedTimeMin: 5 }, meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0.01, humanReviewRequired: false, sideEffects: [] } }),
  performanceInsight: vi.fn().mockResolvedValue({ realtime: { videoId: 'v1', platform: 'douyin', metrics: { views: 1000, likes: 50, comments: 10, shares: 5 }, benchmark: '好', diagnosis: '好', actionSuggestion: '保持' }, meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0, humanReviewRequired: false, sideEffects: [] } }),
}))
vi.mock('@yikart/mediaclaw-tools-platform', () => ({
  platformPackager: vi.fn().mockResolvedValue({ title: '测试', coverImage: { assetId: 'cover', storageKey: '/tmp/cover.jpg', sha256: 'h', mimeType: 'image/jpeg', width: 1080, height: 1920 }, hashtags: ['#种草'], description: '描述', complianceCheck: { passed: true, warnings: [], violations: [] }, meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0, humanReviewRequired: false, sideEffects: [] } }),
}))

describe('MediaclawController E2E', () => {
  let controller: MediaclawController
  let service: MediaclawService
  let mockQueueService: any

  beforeEach(() => {
    vi.clearAllMocks()
    service = new MediaclawService()
    mockQueueService = {
      addMediaclawPipelineJob: vi.fn().mockResolvedValue({ id: 'job-1' }),
      getMediaclawPipelineJob: vi.fn().mockResolvedValue({
        getState: vi.fn().mockResolvedValue('completed'),
        progress: 100,
        returnvalue: { finalVideo: { assetId: 'final' } },
        failedReason: null,
      }),
    }
    controller = new MediaclawController(service, mockQueueService)
  })

  it('POST trending-scout 返回趋势', async () => {
    const result = await controller.scoutTrending({ mode: 'discover', category: 'beauty' } as any)
    expect(result.videos).toBeDefined()
    expect(result.videos).toHaveLength(1)
  })

  it('POST content-planner 返回周计划', async () => {
    const result = await controller.planContent({
      brand: { brandId: 'b1', brandName: '测试', industry: 'beauty' },
      products: [{ productId: 'p1', name: '面霜', features: ['保湿'], images: [] }],
      recentPerformance: [{ contentType: '种草', avgViews: 5000, avgEngagementRate: 0.05 }],
      budgetRemaining: 100,
    } as any)
    expect(result.weeklyPlan).toBeDefined()
  })

  it('POST remix-brief 返回拆解', async () => {
    const result = await controller.createRemixBrief({
      referenceUrl: 'https://www.douyin.com/video/123',
      targetBrand: { brandId: 'b1', brandName: '测试', industry: 'beauty' },
      targetProduct: { productId: 'p1', name: '面霜', features: ['保湿'], images: [] },
    } as any)
    expect(result.brief).toBeDefined()
  })

  it('POST product-showcase 返回 queued', async () => {
    const result = await controller.runProductShowcase({
      brief: { totalDurationSec: 15, cuts: [], script: [], modelAllocation: [], estimatedCostYuan: 1, estimatedTimeMin: 5 },
      targetBrand: { brandId: 'b1', brandName: '测试', industry: 'beauty' },
      targetProduct: { productId: 'p1', name: '面霜', features: [], images: [] },
      qualityLevel: 'standard',
    } as any)
    expect(result.taskId).toBeDefined()
    expect(result.status).toBe('queued')
    expect(mockQueueService.addMediaclawPipelineJob).toHaveBeenCalledTimes(1)
  })

  it('GET insight 返回实时数据', async () => {
    const result = await controller.getInsight('test-video', 'douyin')
    expect(result.realtime).toBeDefined()
    expect(result.realtime.videoId).toBe('v1')
  })

  it('GET task status 返回 completed', async () => {
    const result = await controller.getTaskStatus('task-123')
    expect(result.status).toBe('completed')
    expect(result.progress).toBe(100)
  })
})
