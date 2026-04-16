import { describe, it, expect } from 'vitest'

import { qaOptimizer } from './qa-optimizer'
import { dedupGatekeeper } from './dedup-gatekeeper'
import { contentReviewer } from './content-reviewer'
import type { VideoAssetRef, QAOptimizerInput, DedupGatekeeperInput, ContentReviewerInput } from '@yikart/mediaclaw-shared-kernel'

const makeVideo = (overrides?: Partial<VideoAssetRef>): VideoAssetRef => ({
  assetId: 'v1', storageKey: '/tmp/v.mp4', sha256: 'abcdef1234567890', mimeType: 'video/mp4',
  durationSec: 15, width: 1080, height: 1920, fps: 30, hasAudio: true,
  ...overrides,
})

describe('qaOptimizer', () => {
  it('合格视频通过', async () => {
    const input: QAOptimizerInput = { video: makeVideo(), attempt: 1 }
    const result = await qaOptimizer(input)
    expect(result.passed).toBe(true)
    expect(result.qaScore).toBeGreaterThanOrEqual(70)
    expect(result.meta.status).toBe('success')
  })

  it('时长不足扣分', async () => {
    const input: QAOptimizerInput = { video: makeVideo({ durationSec: 1 }), attempt: 1 }
    const result = await qaOptimizer(input)
    expect(result.qaScore).toBeLessThan(100)
    expect(result.issues.length).toBeGreaterThan(0)
  })

  it('分辨率过低扣分', async () => {
    const input: QAOptimizerInput = { video: makeVideo({ width: 320, height: 240 }), attempt: 1 }
    const result = await qaOptimizer(input)
    expect(result.issues.some((i) => i.type === 'resolution')).toBe(true)
  })
})

describe('dedupGatekeeper', () => {
  it('默认返回唯一', async () => {
    const input: DedupGatekeeperInput = { video: makeVideo() }
    const result = await dedupGatekeeper(input)
    expect(result.unique).toBe(true)
    expect(result.meta.status).toBe('success')
  })
})

describe('contentReviewer', () => {
  it('正常文案通过', async () => {
    const input: ContentReviewerInput = { platform: 'douyin', title: '好喝的啤酒', description: '果泥入口即化' }
    const result = await contentReviewer(input)
    expect(result.compliance.passed).toBe(true)
    expect(result.meta.status).toBe('success')
  })

  it('违禁词不通过', async () => {
    const input: ContentReviewerInput = { platform: 'douyin', title: '最好的啤酒', description: '100%纯天然' }
    const result = await contentReviewer(input)
    expect(result.compliance.passed).toBe(false)
    expect(result.compliance.violations.length).toBeGreaterThan(0)
    expect(result.meta.errorCode).toBe('CONTENT_VIOLATION')
  })
})
