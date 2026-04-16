import { describe, it, expect } from 'vitest'

import { replacementValidator } from './replacement-validator'
import type { ReplacementValidatorInput, ImageAssetRef } from '@yikart/mediaclaw-shared-kernel'

const makeFrame = (id: string): ImageAssetRef => ({
  assetId: id, storageKey: `/tmp/${id}.jpg`, sha256: 'abc', mimeType: 'image/jpeg', width: 1080, height: 1920,
})

describe('replacementValidator', () => {
  it('SSIM 在合理范围内通过', async () => {
    const mockSsim = async () => 0.78

    const input: ReplacementValidatorInput = {
      originalFrame: makeFrame('orig'),
      replacedFrame: makeFrame('replaced'),
    }

    const result = await replacementValidator(input, mockSsim)
    expect(result.passed).toBe(true)
    expect(result.brandChanged).toBe(true)
    expect(result.artifactDetected).toBe(false)
    expect(result.ssim).toBeCloseTo(0.78, 1)
    expect(result.meta.status).toBe('success')
  })

  it('SSIM 过高（未改动）不通过', async () => {
    const mockSsim = async () => 0.98

    const input: ReplacementValidatorInput = {
      originalFrame: makeFrame('orig'),
      replacedFrame: makeFrame('replaced'),
    }

    const result = await replacementValidator(input, mockSsim)
    expect(result.passed).toBe(false)
    expect(result.brandChanged).toBe(false)
    expect(result.meta.errorCode).toBe('VALIDATION_FAILED')
  })

  it('SSIM 过低（质量差）不通过', async () => {
    const mockSsim = async () => 0.30

    const input: ReplacementValidatorInput = {
      originalFrame: makeFrame('orig'),
      replacedFrame: makeFrame('replaced'),
    }

    const result = await replacementValidator(input, mockSsim)
    expect(result.passed).toBe(false)
    expect(result.artifactDetected).toBe(true)
    expect(result.meta.humanReviewRequired).toBe(true)
    expect(result.meta.errorCode).toBe('LOW_CONFIDENCE')
  })
})
