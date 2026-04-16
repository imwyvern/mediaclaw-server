import { describe, it, expect, vi } from 'vitest'
import { TaskState } from '@yikart/mediaclaw-shared-kernel'
import type { PipelineToolbox } from './pipeline-runner'
import { runProductShowcasePipeline } from './pipeline-runner'
import type { ProductShowcasePipelineInput, VideoAssetRef, ImageAssetRef, ToolResponseMeta } from '@yikart/mediaclaw-shared-kernel'

const okMeta = (cost = 0): ToolResponseMeta => ({
  status: 'success', errorCode: 'NONE', retryable: false,
  confidence: 0.9, costYuan: cost, humanReviewRequired: false, sideEffects: [],
})

const makeVideo = (id = 'v1'): VideoAssetRef => ({
  assetId: id, storageKey: `/tmp/${id}.mp4`, sha256: 'abc123', mimeType: 'video/mp4',
  durationSec: 15, width: 1080, height: 1920, fps: 30, hasAudio: true,
})

const makeFrame = (): ImageAssetRef => ({
  assetId: 'f1', storageKey: '/tmp/f.jpg', sha256: 'f1', mimeType: 'image/jpeg', width: 1080, height: 1920,
})

function makeToolbox(): PipelineToolbox {
  return {
    videoDownload: vi.fn().mockResolvedValue({ video: makeVideo('dl'), sourceUsed: 'yt-dlp', fallbackAttempts: 0, meta: okMeta(0) }),
    sceneCutter: vi.fn().mockResolvedValue({
      cuts: [
        { cutId: 'c1', startSec: 0, endSec: 5, keyFrame: makeFrame() },
        { cutId: 'c2', startSec: 5, endSec: 10, keyFrame: makeFrame() },
      ],
      meta: okMeta(),
    }),
    motionAnalyzer: vi.fn().mockResolvedValue({
      motions: [
        { cutId: 'c1', motionType: 'PAN', motionPrompt: 'slow pan right' },
        { cutId: 'c2', motionType: 'ZOOM', motionPrompt: 'zoom in' },
      ],
      meta: okMeta(),
    }),
    brandReplacer: vi.fn().mockResolvedValue({ video: makeVideo('br'), meta: okMeta(0.1) }),
    videoGenerator: vi.fn().mockResolvedValue({ video: makeVideo('gen'), modelUsed: 'seedance-1.5', estimatedCostYuan: 0.3, meta: okMeta(0.3) }),
    scriptWriter: vi.fn().mockResolvedValue({
      lines: [{ lineId: 'l1', text: '好喝的啤酒', durationSec: 2 }],
      fullScript: '好喝的啤酒',
      meta: okMeta(0.01),
    }),
    ttsEngine: vi.fn().mockResolvedValue({
      audioSegments: [{ assetId: 'seg1', storageKey: '/tmp/seg1.mp3', sha256: 's1', mimeType: 'audio/mpeg' }],
      mergedAudio: { assetId: 'merged', storageKey: '/tmp/merged.mp3', sha256: 'm1', mimeType: 'audio/mpeg' },
      meta: okMeta(0.02),
    }),
    videoAssembler: vi.fn().mockResolvedValue({ video: makeVideo('asm'), transitionUsed: 'cut', meta: okMeta() }),
    finalComposer: vi.fn().mockResolvedValue({ video: makeVideo('final'), meta: okMeta() }),
    qaOptimizer: vi.fn().mockResolvedValue({
      passed: true, qaScore: 85, issues: [],
      dimensions: { visual: 90, branding: 85, audio: 90, compliance: 100, platformFit: 85, dedupRisk: 95, engagement: 80 },
      retryRecommendation: 'retry',
      meta: okMeta(),
    }),
    dedupGatekeeper: vi.fn().mockResolvedValue({ unique: true, meta: okMeta() }),
    contentReviewer: vi.fn().mockResolvedValue({ compliance: { passed: true, warnings: [], violations: [] }, meta: okMeta() }),
  }
}

function makeInput(): ProductShowcasePipelineInput {
  return {
    brief: {
      totalDurationSec: 30,
      cuts: [
        { cutId: 'c1', startSec: 0, endSec: 5, videoRef: { url: 'https://example.com/v.mp4' } as VideoAssetRef },
        { cutId: 'c2', startSec: 5, endSec: 10, videoRef: { url: 'https://example.com/v.mp4' } as VideoAssetRef },
      ],
      script: [{ lineId: 'l1', text: '默认文案', durationSec: 2 }],
      modelAllocation: [
        { cutId: 'c1', model: 'seedance-2.0', reason: 'hero shot' },
        { cutId: 'c2', model: 'seedance-1.5', reason: 'filler' },
      ],
      estimatedCostYuan: 5,
      estimatedTimeMin: 10,
    },
    targetBrand: { brandId: 'b1', brandName: '越小啤', industry: '啤酒' },
    targetProduct: { productId: 'p1', name: '陈皮柚子铺', features: ['果泥口感'], images: [] },
    qualityLevel: 'standard',
  }
}

describe('runProductShowcasePipeline', () => {
  it('全流程成功返回 QA_PASSED', async () => {
    const toolbox = makeToolbox()
    const events: Array<{ step: string; status: string }> = []

    const result = await runProductShowcasePipeline(
      makeInput(),
      toolbox,
      (e) => events.push({ step: e.step, status: e.status }),
    )

    expect(result.state).toBe(TaskState.QA_PASSED)
    expect(result.finalVideo.assetId).toBe('final')
    expect(result.costBreakdown.total).toBeGreaterThan(0)
    expect(result.qualityReport.passed).toBe(true)

    // 验证所有 12 步都被调用
    expect(toolbox.videoDownload).toHaveBeenCalledTimes(1)
    expect(toolbox.sceneCutter).toHaveBeenCalledTimes(1)
    expect(toolbox.motionAnalyzer).toHaveBeenCalledTimes(1)
    expect(toolbox.brandReplacer).toHaveBeenCalledTimes(1)
    expect(toolbox.videoGenerator).toHaveBeenCalledTimes(2) // 2 cuts
    expect(toolbox.scriptWriter).toHaveBeenCalledTimes(1)
    expect(toolbox.ttsEngine).toHaveBeenCalledTimes(1)
    expect(toolbox.videoAssembler).toHaveBeenCalledTimes(1)
    expect(toolbox.finalComposer).toHaveBeenCalledTimes(1)
    expect(toolbox.qaOptimizer).toHaveBeenCalledTimes(1)
    expect(toolbox.dedupGatekeeper).toHaveBeenCalledTimes(1)
    expect(toolbox.contentReviewer).toHaveBeenCalledTimes(1)
  })

  it('下载失败时返回 SUSPENDED', async () => {
    const toolbox = makeToolbox()
    toolbox.videoDownload = vi.fn().mockRejectedValue(new Error('download failed'))

    const result = await runProductShowcasePipeline(makeInput(), toolbox)
    expect(result.state).toBe(TaskState.SUSPENDED)
  })

  it('QA 不通过时返回 PRODUCING', async () => {
    const toolbox = makeToolbox()
    toolbox.qaOptimizer = vi.fn().mockResolvedValue({
      passed: false, qaScore: 45, issues: [{ type: 'quality', message: '画质差', severity: 'high' }],
      retryRecommendation: 'retry',
      meta: { status: 'failed', errorCode: 'QA_FAIL', retryable: true, confidence: 0.5, costYuan: 0, humanReviewRequired: false, sideEffects: [] },
    })

    const result = await runProductShowcasePipeline(makeInput(), toolbox)
    expect(result.state).toBe(TaskState.PRODUCING)
    expect(result.qualityReport.qaScore).toBe(45)
  })

  it('查重不通过时返回 PRODUCING', async () => {
    const toolbox = makeToolbox()
    toolbox.dedupGatekeeper = vi.fn().mockResolvedValue({ unique: false, meta: okMeta() })

    const result = await runProductShowcasePipeline(makeInput(), toolbox)
    expect(result.state).toBe(TaskState.PRODUCING)
  })

  it('事件回调被正确触发', async () => {
    const toolbox = makeToolbox()
    const events: string[] = []

    await runProductShowcasePipeline(
      makeInput(),
      toolbox,
      (e) => events.push(`${e.step}:${e.toolId}:${e.status}`),
    )

    expect(events).toContain('1/12:video-download:success')
    expect(events).toContain('2/12:scene-cutter:success')
    expect(events).toContain('9/12:final-composer:success')
    expect(events).toContain('10/12:qa-optimizer:success')
  })
})
