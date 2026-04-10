import { Injectable } from '@nestjs/common'
import {
  PipelineQualityCheck,
  PipelineQualityCheckKey,
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

@Injectable()
export class QualityCheckService {
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
    const errors = checks
      .filter(check => check.severity === 'veto')
      .map(check => check.message)
    const warnings = checks
      .filter(check => check.severity === 'warning')
      .map(check => check.message)

    return {
      passed: errors.length === 0,
      metrics,
      score: this.buildScore(checks),
      checks,
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
      this.createCheck(
        'resolution',
        '分辨率',
        resolutionScore,
        shortEdge >= 720,
        shortEdge >= 720 ? '分辨率满足发布基线' : `短边 ${shortEdge}px 低于 720p 发布基线`,
        shortEdge >= 720 ? 'pass' : 'veto',
      ),
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
    const fileSizeSeverity
      = metrics.fileSize <= 500 * 1024
        ? 'veto'
        : metrics.fileSize < 1024 * 1024
          ? 'warning'
          : 'pass'
    checks.push(
      this.createCheck(
        'fileSize',
        '文件体积',
        fileSizeScore,
        fileSizeSeverity !== 'veto',
        fileSizeSeverity === 'veto'
          ? `文件体积 ${metrics.fileSize} bytes 低于 500KB，通常意味着压缩过度`
          : fileSizeSeverity === 'warning'
            ? `文件体积 ${metrics.fileSize} bytes 偏小，建议提升码率以改善清晰度`
            : '文件体积满足交付要求',
        fileSizeSeverity,
      ),
    )

    const subtitlesScore = hasSubtitles ? (metrics.hasSubtitles ? 92 : 30) : 88
    const subtitlesSeverity = hasSubtitles && !metrics.hasSubtitles ? 'veto' : 'pass'
    checks.push(
      this.createCheck(
        'subtitles',
        '字幕完整度',
        subtitlesScore,
        subtitlesSeverity !== 'veto',
        subtitlesSeverity === 'veto'
          ? '预期有字幕但最终成片缺失字幕'
          : hasSubtitles
            ? '字幕轨已生成'
            : '当前模板未要求强制字幕',
        subtitlesSeverity,
      ),
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
    const durationSeverity
      = durationDelta > 2
        ? 'veto'
        : durationDelta > 1.5
          ? 'warning'
          : 'pass'
    checks.push(
      this.createCheck(
        'duration',
        '时长匹配度',
        durationScore,
        durationSeverity !== 'veto',
        durationSeverity === 'veto'
          ? `时长 ${metrics.duration}s 超出目标 ${targetDurationSeconds}s 的 +/-2s 窗口`
          : durationSeverity === 'warning'
            ? `时长 ${metrics.duration}s 接近容差边界，建议做轻微裁切`
            : `时长与目标 ${targetDurationSeconds}s 保持在可接受范围内`,
        durationSeverity,
      ),
    )

    const clarityScore = Number(((resolutionScore * 0.65) + (fileSizeScore * 0.35)).toFixed(2))
    const claritySeverity = clarityScore < 75 ? 'warning' : 'pass'
    checks.push(
      this.createCheck(
        'clarity',
        '清晰度',
        clarityScore,
        true,
        claritySeverity === 'warning'
          ? '画面清晰度偏弱，建议提升分辨率或输出码率'
          : '画面清晰度稳定',
        claritySeverity,
      ),
    )

    const compositionScore
      = aspectRatio >= 1.6 && aspectRatio <= 1.9
        ? 90
        : aspectRatio >= 1.3 && aspectRatio <= 2.2
          ? 80
          : 68
    const compositionSeverity = compositionScore < 75 ? 'warning' : 'pass'
    checks.push(
      this.createCheck(
        'composition',
        '构图比例',
        compositionScore,
        true,
        compositionSeverity === 'warning'
          ? `画面长宽比 ${metrics.aspectRatio} 偏离短视频主流构图，建议重做裁切`
          : `画面长宽比 ${metrics.aspectRatio} 适合当前短视频构图`,
        compositionSeverity,
      ),
    )

    const viralityScore
      = metrics.duration >= 8 && metrics.duration <= 35
        ? 90
        : metrics.duration >= 6 && metrics.duration <= 45
          ? 82
          : 68
    const viralitySeverity = viralityScore < 75 ? 'warning' : 'pass'
    checks.push(
      this.createCheck(
        'viralityHook',
        '爆款钩子时长',
        viralityScore,
        true,
        viralitySeverity === 'warning'
          ? '节奏长度不够利于前 3 秒抓钩，建议收紧节奏或缩短片长'
          : '时长节奏适合首屏抓钩与完播',
        viralitySeverity,
      ),
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

  private createCheck(
    key: PipelineQualityCheckKey,
    label: string,
    score: number,
    passed: boolean,
    message: string,
    severity: PipelineQualityCheck['severity'],
  ): PipelineQualityCheck {
    return {
      key,
      label,
      score: Number(score.toFixed(2)),
      passed,
      severity,
      message,
    }
  }
}
