import { Injectable } from '@nestjs/common'
import {
  PipelineQualityCheck,
  PipelineQualityCheckKey,
  PipelineQualityDimensionLevel,
  PipelineQualityDimensionThresholds,
  PipelineQualityMetrics,
  PipelineQualityReport,
  PipelineQualityScore,
} from './pipeline.types'
import { fileSize, runCommand } from './pipeline.utils'

interface FfprobeStream {
  codec_type?: string
  width?: number
  height?: number
}

interface FfprobeFormat {
  duration?: string
}

interface FfprobeResponse {
  streams?: FfprobeStream[]
  format?: FfprobeFormat
}

interface QualityCheckDraft {
  key: PipelineQualityCheckKey
  level: PipelineQualityDimensionLevel
  label: string
  score: number
  threshold: number
  warningThreshold: number
  passMessage: string
  warningMessage: string
  vetoMessage: string
}

@Injectable()
export class QualityCheckService {
  private readonly thresholds: PipelineQualityDimensionThresholds = {
    resolution: 72,
    fileSize: 60,
    subtitles: 75,
    duration: 65,
    clarity: 70,
    composition: 65,
    viralityHook: 65,
  }

  async assertQuality(
    videoPath: string,
    targetDurationSeconds: number,
    hasSubtitles: boolean,
  ): Promise<PipelineQualityReport> {
    const metrics = await this.probeVideo(videoPath, hasSubtitles)
    const report = this.evaluateMetrics(metrics, targetDurationSeconds, hasSubtitles)
    if (!report.passed) {
      throw new Error(`Quality check failed: ${report.errors.join('; ')}`)
    }

    return report
  }

  async probeVideo(videoPath: string, hasSubtitles: boolean): Promise<PipelineQualityMetrics> {
    const { stdout } = await runCommand(
      'ffprobe',
      [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_streams',
        '-show_format',
        videoPath,
      ],
      { timeoutMs: 20_000 },
    )

    const parsed = JSON.parse(stdout) as FfprobeResponse
    const videoStream = parsed.streams?.find(stream => stream.codec_type === 'video')
    if (!videoStream?.width || !videoStream.height) {
      throw new Error(`Unable to detect video dimensions for ${videoPath}`)
    }

    const shortEdge = Math.min(videoStream.width, videoStream.height)
    const longEdge = Math.max(videoStream.width, videoStream.height)

    return {
      width: videoStream.width,
      height: videoStream.height,
      duration: Number(Number(parsed.format?.duration || 0).toFixed(3)),
      fileSize: await fileSize(videoPath),
      hasSubtitles,
      shortEdge,
      aspectRatio: `${longEdge}:${shortEdge}`,
    }
  }

  evaluateMetrics(
    metrics: PipelineQualityMetrics,
    targetDurationSeconds: number,
    hasSubtitles: boolean,
  ): PipelineQualityReport {
    const checks = this.buildChecks(metrics, targetDurationSeconds, hasSubtitles)
    const vetoChecks = checks
      .filter(check => check.severity === 'veto')
    const errors = vetoChecks
      .map(check => check.message)
    const warnings = checks
      .filter(check => check.severity === 'warning')
      .map(check => check.message)

    return {
      passed: vetoChecks.length === 0,
      metrics,
      score: this.buildScore(checks),
      checks,
      vetoKeys: vetoChecks.map(check => check.key),
      errors,
      warnings,
    }
  }

  private buildChecks(
    metrics: PipelineQualityMetrics,
    targetDurationSeconds: number,
    hasSubtitles: boolean,
  ): PipelineQualityCheck[] {
    const checks: PipelineQualityCheck[] = []
    const shortEdge = metrics.shortEdge || Math.min(metrics.width, metrics.height)
    const durationDelta = Math.abs(metrics.duration - targetDurationSeconds)
    const aspectRatio = this.parseAspectRatio(metrics.width, metrics.height)

    const resolutionScore
      = shortEdge >= 1080 ? 100 : shortEdge >= 720 ? 86 : shortEdge > 0 ? 60 : 0
    checks.push(
      this.createCheck({
        key: 'resolution',
        level: 'L1',
        label: '技术清晰基线',
        score: resolutionScore,
        threshold: this.thresholds.resolution,
        warningThreshold: 86,
        passMessage: '分辨率满足发布基线',
        warningMessage: `短边 ${shortEdge}px 接近发布下限，建议提升到 1080p 以增强质感`,
        vetoMessage: `短边 ${shortEdge}px 低于 720p 发布基线`,
      }),
    )

    const fileSizeScore
      = metrics.fileSize >= 2 * 1024 * 1024
        ? 96
        : metrics.fileSize >= 1024 * 1024
          ? 88
          : metrics.fileSize >= 500 * 1024
            ? 82
            : metrics.fileSize > 0
              ? 55
              : 0
    checks.push(
      this.createCheck({
        key: 'fileSize',
        level: 'L1',
        label: '编码完整度',
        score: fileSizeScore,
        threshold: this.thresholds.fileSize,
        warningThreshold: 84,
        passMessage: '文件体积满足交付要求',
        warningMessage: `文件体积 ${metrics.fileSize} bytes 偏小，建议提升码率以改善清晰度`,
        vetoMessage: `文件体积 ${metrics.fileSize} bytes 低于 500KB，通常意味着压缩过度`,
      }),
    )

    const subtitlesScore = hasSubtitles ? (metrics.hasSubtitles ? 92 : 30) : 88
    checks.push(
      this.createCheck({
        key: 'subtitles',
        level: 'L2',
        label: '内容合规',
        score: subtitlesScore,
        threshold: this.thresholds.subtitles,
        warningThreshold: 88,
        passMessage: hasSubtitles ? '字幕轨已生成，满足内容合规基线' : '当前模板未要求强制字幕，合规基线通过',
        warningMessage: '字幕信息较弱，建议补充关键信息提示以提升平台友好度',
        vetoMessage: '预期有字幕但最终成片缺失字幕',
      }),
    )

    const durationScore
      = durationDelta <= 0.75
        ? 98
        : durationDelta <= 1.5
          ? 90
          : durationDelta <= 2
            ? 82
            : durationDelta <= 3
              ? 68
              : 50
    checks.push(
      this.createCheck({
        key: 'duration',
        level: 'L2',
        label: '平台时长合规',
        score: durationScore,
        threshold: this.thresholds.duration,
        warningThreshold: 82,
        passMessage: `时长与目标 ${targetDurationSeconds}s 保持在可接受范围内`,
        warningMessage: `时长 ${metrics.duration}s 接近容差边界，建议做轻微裁切`,
        vetoMessage: `时长 ${metrics.duration}s 超出目标 ${targetDurationSeconds}s 的 +/-2s 窗口`,
      }),
    )

    const clarityScore = Number(((resolutionScore * 0.5) + (fileSizeScore * 0.3) + (durationScore * 0.2)).toFixed(2))
    checks.push(
      this.createCheck({
        key: 'clarity',
        level: 'L3',
        label: '首屏清晰抓力',
        score: clarityScore,
        threshold: this.thresholds.clarity,
        warningThreshold: 82,
        passMessage: '画面清晰度稳定，首屏观感达标',
        warningMessage: '画面清晰度偏弱，建议提升分辨率或输出码率',
        vetoMessage: '画面清晰抓力不足，首屏缺乏足够质感支撑传播',
      }),
    )

    const compositionScore
      = aspectRatio >= 1.65 && aspectRatio <= 1.92
        ? 92
        : aspectRatio >= 1.45 && aspectRatio <= 2.2
          ? 82
          : aspectRatio >= 1.2 && aspectRatio <= 2.4
            ? 64
            : 45
    checks.push(
      this.createCheck({
        key: 'composition',
        level: 'L3',
        label: '构图完成度',
        score: compositionScore,
        threshold: this.thresholds.composition,
        warningThreshold: 80,
        passMessage: `画面长宽比 ${metrics.aspectRatio} 适合当前短视频构图`,
        warningMessage: `画面长宽比 ${metrics.aspectRatio} 偏离短视频主流构图，建议重做裁切`,
        vetoMessage: `画面长宽比 ${metrics.aspectRatio} 严重偏离主流短视频构图，传播完成度不足`,
      }),
    )

    const viralityScore
      = metrics.duration >= 9 && metrics.duration <= 25 && durationDelta <= 1.5
        ? 94
        : metrics.duration >= 7 && metrics.duration <= 35 && durationDelta <= 2
          ? 84
          : metrics.duration >= 6 && metrics.duration <= 45
            ? 68
            : 52
    checks.push(
      this.createCheck({
        key: 'viralityHook',
        level: 'L3',
        label: '传播钩子强度',
        score: viralityScore,
        threshold: this.thresholds.viralityHook,
        warningThreshold: 80,
        passMessage: '时长节奏适合首屏抓钩与完播',
        warningMessage: '节奏长度不够利于前 3 秒抓钩，建议收紧节奏或缩短片长',
        vetoMessage: '传播钩子强度过弱，难以支撑首屏留存和完播',
      }),
    )

    return checks
  }

  private buildScore(checks: PipelineQualityCheck[]): PipelineQualityScore {
    const dimensions = {
      resolution: this.readCheckScore(checks, 'resolution'),
      fileSize: this.readCheckScore(checks, 'fileSize'),
      subtitles: this.readCheckScore(checks, 'subtitles'),
      duration: this.readCheckScore(checks, 'duration'),
      clarity: this.readCheckScore(checks, 'clarity'),
      composition: this.readCheckScore(checks, 'composition'),
      viralityHook: this.readCheckScore(checks, 'viralityHook'),
    }

    const production = Number(
      ((dimensions.resolution
        + dimensions.fileSize
        + dimensions.subtitles
        + dimensions.duration)
      / 4).toFixed(2),
    )
    const virality = Number(
      ((dimensions.clarity + dimensions.composition + dimensions.viralityHook) / 3).toFixed(2),
    )

    return {
      total: Number((production * 0.4 + virality * 0.6).toFixed(2)),
      production,
      virality,
      dimensions,
      thresholds: { ...this.thresholds },
    }
  }

  private readCheckScore(checks: PipelineQualityCheck[], key: PipelineQualityCheckKey) {
    return checks.find(check => check.key === key)?.score || 0
  }

  private parseAspectRatio(width: number, height: number) {
    if (!width || !height) {
      return 0
    }

    return Number((Math.max(width, height) / Math.min(width, height)).toFixed(3))
  }

  private createCheck(draft: QualityCheckDraft): PipelineQualityCheck {
    const normalizedScore = Number(draft.score.toFixed(2))
    const severity = normalizedScore < draft.threshold
      ? 'veto'
      : normalizedScore < draft.warningThreshold
        ? 'warning'
        : 'pass'

    return {
      key: draft.key,
      level: draft.level,
      label: draft.label,
      score: normalizedScore,
      threshold: draft.threshold,
      warningThreshold: draft.warningThreshold,
      passed: severity !== 'veto',
      severity,
      message: severity === 'veto'
        ? draft.vetoMessage
        : severity === 'warning'
          ? draft.warningMessage
          : draft.passMessage,
    }
  }
}
