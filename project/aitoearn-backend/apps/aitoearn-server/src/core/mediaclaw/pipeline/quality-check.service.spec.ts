import { describe, expect, it } from 'vitest'
import { QualityCheckService } from './quality-check.service'

describe('qualityCheckService', () => {
  it('should pass metrics that satisfy pipeline thresholds', () => {
    const service = new QualityCheckService()
    const report = service.evaluateMetrics(
      {
        width: 1080,
        height: 1920,
        duration: 15,
        fileSize: 1024 * 1024,
        hasSubtitles: true,
        shortEdge: 1080,
        aspectRatio: '1920:1080',
      },
      15,
      true,
    )

    expect(report.passed).toBe(true)
    expect(report.errors).toHaveLength(0)
    expect(report.warnings).toHaveLength(0)
    expect(report.vetoKeys).toEqual([])
    expect(report.checks).toHaveLength(7)
    expect(report.score.total).toBeGreaterThan(80)
    expect(report.score.thresholds.subtitles).toBe(75)
    expect(report.score.dimensions.viralityHook).toBeGreaterThan(80)
  })

  it('should surface warnings without blocking delivery', () => {
    const service = new QualityCheckService()
    const report = service.evaluateMetrics(
      {
        width: 1080,
        height: 1600,
        duration: 38,
        fileSize: 700 * 1024,
        hasSubtitles: false,
        shortEdge: 1080,
        aspectRatio: '1600:1080',
      },
      36.8,
      false,
    )

    expect(report.passed).toBe(true)
    expect(report.errors).toHaveLength(0)
    expect(report.warnings.length).toBeGreaterThan(0)
    expect(report.checks.find(check => check.key === 'fileSize')?.severity).toBe('warning')
  })

  it('should report veto failures across hard quality gates', () => {
    const service = new QualityCheckService()
    const report = service.evaluateMetrics(
      {
        width: 640,
        height: 1136,
        duration: 20.5,
        fileSize: 100 * 1024,
        hasSubtitles: false,
        shortEdge: 640,
        aspectRatio: '1136:640',
      },
      15,
      true,
    )

    expect(report.passed).toBe(false)
    expect(report.errors).toContain('短边 640px 低于 720p 发布基线')
    expect(report.errors).toContain('预期有字幕但最终成片缺失字幕')
    expect(report.score.production).toBeLessThan(70)
  })

  it('should veto the whole report when any L3 dimension drops below threshold', () => {
    const service = new QualityCheckService()
    const report = service.evaluateMetrics(
      {
        width: 1080,
        height: 1080,
        duration: 18,
        fileSize: 2 * 1024 * 1024,
        hasSubtitles: true,
        shortEdge: 1080,
        aspectRatio: '1080:1080',
      },
      18,
      true,
    )

    expect(report.passed).toBe(false)
    expect(report.vetoKeys).toContain('composition')
    expect(report.checks.find(check => check.key === 'composition')).toMatchObject({
      level: 'L3',
      severity: 'veto',
      threshold: 65,
    })
  })
})
