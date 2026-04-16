import { describe, it, expect, vi } from 'vitest'
import { runAiLivePipeline } from './ai-live-pipeline'
import { runExplainerPipeline } from './explainer-pipeline'
import type { ImageAssetRef, VideoAssetRef, ToolResponseMeta } from '@yikart/mediaclaw-shared-kernel'

const okMeta = (cost = 0): ToolResponseMeta => ({
  status: 'success', errorCode: 'NONE', retryable: false,
  confidence: 0.9, costYuan: cost, humanReviewRequired: false, sideEffects: [],
})

const makeVideo = (id = 'v1'): VideoAssetRef => ({
  assetId: id, storageKey: `/tmp/${id}.mp4`, sha256: 'abc', mimeType: 'video/mp4',
  durationSec: 5, width: 1080, height: 1920, fps: 30, hasAudio: false,
})

const makeImage = (id = 'img1'): ImageAssetRef => ({
  assetId: id, storageKey: `/tmp/${id}.jpg`, sha256: 'img', mimeType: 'image/jpeg', width: 1080, height: 1920,
})

describe('runAiLivePipeline', () => {
  it('成功生成微动视频', async () => {
    const toolbox = {
      videoGenerator: vi.fn().mockResolvedValue({ video: makeVideo('gen'), estimatedCostYuan: 0.3, meta: okMeta(0.3) }),
      videoAssembler: vi.fn().mockResolvedValue({ video: makeVideo('asm'), meta: okMeta() }),
      finalComposer: vi.fn().mockResolvedValue({ video: makeVideo('final'), meta: okMeta() }),
      qaOptimizer: vi.fn().mockResolvedValue({ passed: true, qaScore: 85, issues: [], meta: okMeta() }),
    }

    const result = await runAiLivePipeline({
      productImages: [makeImage('img1'), makeImage('img2')],
      style: 'gentle zoom',
      durationSec: 10,
    }, toolbox)

    expect(result.finalVideo.assetId).toBe('final')
    expect(result.costBreakdown.generation).toBeGreaterThan(0)
    expect(result.qualityReport.passed).toBe(true)
    expect(toolbox.videoGenerator).toHaveBeenCalledTimes(2)
  })

  it('无图片时返回空视频', async () => {
    const toolbox = {
      videoGenerator: vi.fn(),
      videoAssembler: vi.fn(),
      finalComposer: vi.fn(),
      qaOptimizer: vi.fn(),
    }

    const result = await runAiLivePipeline({
      productImages: [],
      style: 'zoom',
      durationSec: 10,
    }, toolbox)

    expect(result.finalVideo.assetId).toBe('')
    expect(result.qualityReport.passed).toBe(false)
  })
})

describe('runExplainerPipeline', () => {
  it('成功生成讲解视频', async () => {
    const toolbox = {
      remotionRender: vi.fn().mockResolvedValue({ video: makeVideo('remotion'), meta: okMeta(0.5) }),
      scriptWriter: vi.fn().mockResolvedValue({
        lines: [{ lineId: 'l1', text: '产品介绍', durationSec: 2 }],
        fullScript: '产品介绍',
        meta: okMeta(0.01),
      }),
      ttsEngine: vi.fn().mockResolvedValue({
        mergedAudio: { assetId: 'audio', storageKey: '/tmp/audio.mp3', sha256: 'a', mimeType: 'audio/mpeg' },
        meta: okMeta(0.02),
      }),
      finalComposer: vi.fn().mockResolvedValue({ video: makeVideo('final'), meta: okMeta() }),
      qaOptimizer: vi.fn().mockResolvedValue({ passed: true, qaScore: 90, issues: [], meta: okMeta() }),
    }

    const result = await runExplainerPipeline({
      product: { productId: 'p1', name: '测试产品', features: [], images: [] },
      templateId: 'explainer-v1',
      durationSec: 15,
    }, toolbox)

    expect(result.finalVideo.assetId).toBe('final')
    expect(result.costBreakdown.tts).toBe(0.02)
    expect(result.qualityReport.passed).toBe(true)
    expect(toolbox.remotionRender).toHaveBeenCalledTimes(1)
    expect(toolbox.scriptWriter).toHaveBeenCalledTimes(1)
    expect(toolbox.ttsEngine).toHaveBeenCalledTimes(1)
  })

  it('Remotion 失败时返回空视频', async () => {
    const toolbox = {
      remotionRender: vi.fn().mockRejectedValue(new Error('render failed')),
      scriptWriter: vi.fn(),
      ttsEngine: vi.fn(),
      finalComposer: vi.fn(),
      qaOptimizer: vi.fn(),
    }

    const result = await runExplainerPipeline({
      product: { productId: 'p1', name: 'test', features: [], images: [] },
      templateId: 'tpl',
      durationSec: 10,
    }, toolbox)

    expect(result.finalVideo.assetId).toBe('')
    expect(result.qualityReport.passed).toBe(false)
  })
})
