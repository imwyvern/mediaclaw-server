import { describe, expect, it } from 'vitest'
import { QualityCheckService } from './quality-check.service'

describe('QualityCheckService', () => {
  it('should pass metrics that satisfy pipeline thresholds', () => {
    const service = new QualityCheckService()
    const report = service.evaluateMetrics(
      {
        width: 1080,
        height: 1920,
        duration: 15,
        fileSize: 1024 * 1024,
        hasSubtitles: true,
      },
      15,
      true,
    )

    expect(report.passed).toBe(true)
    expect(report.errors).toHaveLength(0)
  })

  it('should report threshold failures', () => {
    const service = new QualityCheckService()
    const report = service.evaluateMetrics(
      {
        width: 640,
        height: 1136,
        duration: 20.5,
        fileSize: 100 * 1024,
        hasSubtitles: false,
      },
      15,
      true,
    )

    expect(report.passed).toBe(false)
    expect(report.errors.length).toBeGreaterThan(0)
  })
})
