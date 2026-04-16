import { describe, it, expect } from 'vitest'

import { motionAnalyzer } from './motion-analyzer'
import type { MotionAnalyzerInput, SceneCut, ImageAssetRef } from '@yikart/mediaclaw-shared-kernel'

const placeholderFrame: ImageAssetRef = {
  assetId: 'f1',
  storageKey: '',
  sha256: '',
  mimeType: 'image/jpeg',
  width: 0,
  height: 0,
}

const makeCut = (overrides?: Partial<SceneCut>): SceneCut => ({
  cutId: 'cut_0',
  startSec: 0,
  endSec: 3,
  firstFrame: placeholderFrame,
  ...overrides,
})

describe('motionAnalyzer', () => {
  it('短镜头（<1.5s）识别为 STATIC', async () => {
    const input: MotionAnalyzerInput = {
      cuts: [makeCut({ cutId: 'cut_0', startSec: 0, endSec: 1 })],
    }

    const result = await motionAnalyzer(input)

    expect(result.motions).toHaveLength(1)
    expect(result.motions[0]!.motionType).toBe('STATIC')
    expect(result.motions[0]!.confidence).toBeGreaterThanOrEqual(0.7)
    expect(result.meta.status).toBe('success')
  })

  it('长镜头（>4s）带 pan 描述识别为 PAN', async () => {
    const input: MotionAnalyzerInput = {
      cuts: [makeCut({
        cutId: 'cut_1',
        startSec: 0,
        endSec: 6,
        sceneDescription: '横移扫过产品展示台',
      })],
    }

    const result = await motionAnalyzer(input)

    expect(result.motions[0]!.motionType).toBe('PAN')
    expect(result.motions[0]!.confidence).toBeGreaterThanOrEqual(0.7)
  })

  it('标准镜头带 zoom 描述识别为 ZOOM', async () => {
    const input: MotionAnalyzerInput = {
      cuts: [makeCut({
        cutId: 'cut_2',
        startSec: 0,
        endSec: 3,
        sceneDescription: '推近产品特写',
      })],
    }

    const result = await motionAnalyzer(input)

    expect(result.motions[0]!.motionType).toBe('ZOOM')
  })

  it('无描述的标准镜头置信度低，标记需人工复核', async () => {
    const input: MotionAnalyzerInput = {
      cuts: [makeCut({
        cutId: 'cut_3',
        startSec: 0,
        endSec: 3,
        sceneDescription: undefined,
      })],
    }

    const result = await motionAnalyzer(input)

    expect(result.motions[0]!.confidence).toBeLessThan(0.7)
    expect(result.meta.humanReviewRequired).toBe(true)
  })

  it('styleHint 附加到 motionPrompt', async () => {
    const input: MotionAnalyzerInput = {
      cuts: [makeCut({ cutId: 'cut_4', startSec: 0, endSec: 1 })],
      styleHint: 'cinematic',
    }

    const result = await motionAnalyzer(input)

    expect(result.motions[0]!.motionPrompt).toContain('cinematic')
  })

  it('多个镜头批量分析', async () => {
    const input: MotionAnalyzerInput = {
      cuts: [
        makeCut({ cutId: 'cut_0', startSec: 0, endSec: 1 }),
        makeCut({ cutId: 'cut_1', startSec: 1, endSec: 6, sceneDescription: '俯拍全景' }),
        makeCut({ cutId: 'cut_2', startSec: 5, endSec: 8 }),
      ],
    }

    const result = await motionAnalyzer(input)

    expect(result.motions).toHaveLength(3)
    expect(result.motions[0]!.motionType).toBe('STATIC')
    expect(result.motions[1]!.motionType).toBe('TILT')
  })
})
