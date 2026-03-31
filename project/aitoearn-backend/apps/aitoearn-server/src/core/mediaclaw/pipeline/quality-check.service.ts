import { Injectable } from '@nestjs/common'
import { PipelineQualityMetrics, PipelineQualityReport } from './pipeline.types'
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

    return {
      width: videoStream.width,
      height: videoStream.height,
      duration: Number(Number(parsed.format?.duration || 0).toFixed(3)),
      fileSize: await fileSize(videoPath),
      hasSubtitles,
    }
  }

  evaluateMetrics(
    metrics: PipelineQualityMetrics,
    targetDurationSeconds: number,
    hasSubtitles: boolean,
  ): PipelineQualityReport {
    const errors: string[] = []
    const shortEdge = Math.min(metrics.width, metrics.height)

    if (shortEdge < 720) {
      errors.push(`short edge ${shortEdge}px below 720p`)
    }

    if (Math.abs(metrics.duration - targetDurationSeconds) > 2) {
      errors.push(`duration ${metrics.duration}s exceeds +/-2s window around ${targetDurationSeconds}s`)
    }

    if (metrics.fileSize <= 500 * 1024) {
      errors.push(`file size ${metrics.fileSize} bytes below 500KB`)
    }

    if (hasSubtitles && !metrics.hasSubtitles) {
      errors.push('subtitles expected but missing')
    }

    return {
      passed: errors.length === 0,
      metrics,
      errors,
    }
  }
}
