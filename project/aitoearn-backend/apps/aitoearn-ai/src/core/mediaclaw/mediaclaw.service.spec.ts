import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaclawService } from './mediaclaw.service'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

vi.mock('@yikart/mediaclaw-tools-ingest', () => ({
  videoDownload: vi.fn().mockResolvedValue({
    video: {
      assetId: 'dl1',
      storageKey: '/tmp/dl.mp4',
      sha256: 'a',
      mimeType: 'video/mp4',
      durationSec: 15,
      width: 1080,
      height: 1920,
      fps: 30,
      hasAudio: true,
    },
    sourceUsed: 'tikhub',
    fallbackAttempts: 0,
    meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0, humanReviewRequired: false, sideEffects: [] },
  }),
  sceneCutter: vi.fn().mockResolvedValue({
    cuts: [{
      cutId: 'c1',
      startSec: 0,
      endSec: 5,
      firstFrame: {
        assetId: 'frame_1',
        storageKey: '/tmp/frame.jpg',
        sha256: 'frame_sha',
        mimeType: 'image/jpeg',
        width: 1080,
        height: 1920,
      },
    }],
    meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0, humanReviewRequired: false, sideEffects: [] },
  }),
  motionAnalyzer: vi.fn().mockResolvedValue({
    motions: [{ cutId: 'c1', motionType: 'zoom_in', motionPrompt: 'slow zoom in', confidence: 0.9 }],
    meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0, humanReviewRequired: false, sideEffects: [] },
  }),
}))

vi.mock('@yikart/mediaclaw-tools-branding', () => ({
  brandReplacer: vi.fn().mockResolvedValue({
    replacedFrame: {
      assetId: 'br1',
      storageKey: '/tmp/br.png',
      sha256: 'c',
      mimeType: 'image/png',
      width: 1080,
      height: 1920,
    },
    routeUsed: 'vce',
    artifactHints: [],
    meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0, humanReviewRequired: false, sideEffects: [] },
  }),
}))

vi.mock('@yikart/mediaclaw-tools-generation', () => ({
  videoGenerator: vi.fn().mockResolvedValue({
    video: {
      assetId: 'gen1',
      storageKey: '/tmp/gen.mp4',
      sha256: 'd',
      mimeType: 'video/mp4',
      durationSec: 5,
      width: 1080,
      height: 1920,
      fps: 30,
      hasAudio: false,
    },
    modelUsed: 'seedance-1.5',
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
    video: {
      assetId: 'asm1',
      storageKey: '/tmp/asm.mp4',
      sha256: 'f',
      mimeType: 'video/mp4',
      durationSec: 15,
      width: 1080,
      height: 1920,
      fps: 30,
      hasAudio: true,
    },
    transitionUsed: 'cut',
    meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0, humanReviewRequired: false, sideEffects: [] },
  }),
  finalComposer: vi.fn().mockResolvedValue({
    video: {
      assetId: 'final1',
      storageKey: '/tmp/final.mp4',
      sha256: 'g',
      mimeType: 'video/mp4',
      durationSec: 15,
      width: 1080,
      height: 1920,
      fps: 30,
      hasAudio: true,
    },
    meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0, humanReviewRequired: false, sideEffects: [] },
  }),
}))

vi.mock('@yikart/mediaclaw-tools-quality', () => ({
  qaOptimizer: vi.fn().mockResolvedValue({
    passed: true,
    qaScore: 90,
    issues: [],
    meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0, humanReviewRequired: false, sideEffects: [] },
  }),
  dedupGatekeeper: vi.fn().mockResolvedValue({
    unique: true,
    visualDistance: 0.9,
    audioDistance: 0.9,
    semanticDistance: 0.9,
    rewriteRequired: false,
    meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0, humanReviewRequired: false, sideEffects: [] },
  }),
  contentReviewer: vi.fn().mockResolvedValue({
    compliance: { passed: true, warnings: [], violations: [] },
    meta: { status: 'success', errorCode: 'NONE', retryable: false, confidence: 1, costYuan: 0, humanReviewRequired: false, sideEffects: [] },
  }),
}))

vi.mock('@yikart/mediaclaw-tools-platform', () => ({
  platformPackager: vi.fn().mockResolvedValue({
    title: '测试标题',
    coverImage: {
      assetId: 'cover',
      storageKey: '/tmp/cover.jpg',
      sha256: 'h',
      mimeType: 'image/jpeg',
      width: 1080,
      height: 1920,
    },
    hashtags: ['#种草'],
    description: '描述',
    complianceCheck: { passed: true, warnings: [], violations: [] },
  }),
}))

const originalEnv = {
  OPENAI_API_KEY: process.env['OPENAI_API_KEY'],
  GEMINI_API_KEY: process.env['GEMINI_API_KEY'],
  TIKHUB_API_KEY: process.env['TIKHUB_API_KEY'],
  TIKHUB_BASE_URL: process.env['TIKHUB_BASE_URL'],
  MEDIACLAW_DEEPSEEK_API_KEY: process.env['MEDIACLAW_DEEPSEEK_API_KEY'],
  DEEPSEEK_API_KEY: process.env['DEEPSEEK_API_KEY'],
}

describe('MediaclawService', () => {
  let service: MediaclawService

  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock.mockReset()
    process.env['OPENAI_API_KEY'] = 'test-openai-key'
    delete process.env['GEMINI_API_KEY']
    process.env['TIKHUB_API_KEY'] = 'test-tikhub-key'
    process.env['TIKHUB_BASE_URL'] = 'https://api.tikhub.test'
    delete process.env['MEDIACLAW_DEEPSEEK_API_KEY']
    delete process.env['DEEPSEEK_API_KEY']
    service = new MediaclawService()
  })

  afterAll(() => {
    restoreEnv('OPENAI_API_KEY', originalEnv.OPENAI_API_KEY)
    restoreEnv('GEMINI_API_KEY', originalEnv.GEMINI_API_KEY)
    restoreEnv('TIKHUB_API_KEY', originalEnv.TIKHUB_API_KEY)
    restoreEnv('TIKHUB_BASE_URL', originalEnv.TIKHUB_BASE_URL)
    restoreEnv('MEDIACLAW_DEEPSEEK_API_KEY', originalEnv.MEDIACLAW_DEEPSEEK_API_KEY)
    restoreEnv('DEEPSEEK_API_KEY', originalEnv.DEEPSEEK_API_KEY)
  })

  it('runProductShowcase 成功执行管线', async () => {
    const result = await service.runProductShowcase({
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
    })

    expect(result.finalVideo.assetId).toBe('final1')
    expect(result.costBreakdown.total).toBeGreaterThan(0)
    expect(result.state).toBe('QA_PASSED')
  })

  it('createRemixBrief 通过 mock fetch 返回标准 brief 结构', async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse({
        choices: [{
          message: {
            content: JSON.stringify({
              cuts: [
                { cutId: 'cut_0', startSec: 0, endSec: 5, motionType: 'PAN', motionPrompt: 'slow pan' },
                { cutId: 'cut_1', startSec: 5, endSec: 10, motionType: 'ZOOM', motionPrompt: 'zoom in' },
              ],
              script: [{ lineId: 'line_0', text: '产品卖点', durationSec: 2 }],
            }),
          },
        }],
      }),
    )

    const result = await service.createRemixBrief({
      referenceUrl: 'https://www.douyin.com/video/123',
      targetBrand: { brandId: 'b1', brandName: '测试品牌', industry: 'beauty' },
      targetProduct: { productId: 'p1', name: '面霜', features: ['保湿'], images: ['https://img.test/p1.jpg'] },
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.brief.totalDurationSec).toBe(10)
    expect(result.brief.cuts).toHaveLength(2)
    expect(result.brief.script[0]?.text).toBe('产品卖点')
  })

  it('scoutTrending 通过 mock fetch 返回趋势视频', async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse({
        data: [
          { url: 'https://example.com/v1', title: '热门', likes: 10000, shares: 500, tags: ['种草'] },
        ],
      }),
    )

    const result = await service.scoutTrending({
      mode: 'discover',
      category: 'beauty',
      platform: 'douyin',
      limit: 1,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.videos).toHaveLength(1)
    expect(result.videos?.[0]?.title).toBe('热门')
  })

  it('getInsight 返回实时洞察', async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse({
        data: {
          views: 1000,
          likes: 50,
          comments: 10,
          shares: 5,
          benchmark: '高于均值',
          diagnosis: '内容质量好',
        },
      }),
    )

    const result = await service.getInsight('video_123', 'douyin')
    expect(result.realtime?.videoId).toBe('video_123')
    expect(result.realtime?.benchmark).toBe('高于均值')
  })

  it('planContent 通过 mock fetch 返回周计划', async () => {
    fetchMock.mockResolvedValueOnce(
      createJsonResponse({
        choices: [{
          message: {
            content: JSON.stringify({
              weeklyPlan: [{ day: '周一', contentType: '种草', platform: 'douyin', reason: '高转化' }],
              summary: '本周主打种草',
            }),
          },
        }],
      }),
    )

    const result = await service.planContent({
      brand: { brandId: 'b1', brandName: '测试', industry: 'beauty' },
      products: [{ productId: 'p1', name: '面霜', features: ['保湿'], images: [] }],
      recentPerformance: [{ contentType: '种草', avgViews: 5000, avgEngagementRate: 0.05 }],
      budgetRemaining: 100,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.weeklyPlan).toHaveLength(1)
    expect(result.monthlyCalendarSummary).toBe('本周主打种草')
  })

  it('packageForPlatform 包装成功', async () => {
    const result = await service.packageForPlatform({
      videoAssetId: 'v1',
      platform: 'douyin',
      brand: { brandId: 'b1', brandName: '测试', industry: 'beauty' },
      product: { productId: 'p1', name: '面霜', features: ['保湿'], images: [] },
    })

    expect(result.title).toBe('测试标题')
    expect(result.hashtags).toContain('#种草')
  })
})

function createJsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
    return
  }

  process.env[key] = value
}
