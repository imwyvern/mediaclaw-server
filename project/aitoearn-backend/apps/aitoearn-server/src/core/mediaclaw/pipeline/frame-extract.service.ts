import { Injectable } from '@nestjs/common'
import { copyFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PipelineFrameArtifact, PipelineVideoMetadata } from './pipeline.types'
import { downloadFile, ensureDirectory, runCommand } from './pipeline.utils'

interface FfprobeStream {
  codec_type?: string
  width?: number
  height?: number
  avg_frame_rate?: string
}

interface FfprobeFormat {
  duration?: string
}

interface FfprobeResponse {
  streams?: FfprobeStream[]
  format?: FfprobeFormat
}

@Injectable()
export class FrameExtractService {
  async ensureLocalVideo(sourceVideoUrl: string, workspaceDir: string) {
    if (!sourceVideoUrl.trim()) {
      throw new Error('sourceVideoUrl is required')
    }

    await ensureDirectory(workspaceDir)
    const destinationPath = join(workspaceDir, `source${this.resolveExtension(sourceVideoUrl)}`)

    if (sourceVideoUrl.startsWith('http://') || sourceVideoUrl.startsWith('https://')) {
      await downloadFile(sourceVideoUrl, destinationPath)
      return destinationPath
    }

    const sourcePath = sourceVideoUrl.startsWith('file://')
      ? fileURLToPath(sourceVideoUrl)
      : resolve(sourceVideoUrl)

    if (sourcePath !== destinationPath) {
      await copyFile(sourcePath, destinationPath)
    }

    return destinationPath
  }

  async probeVideoMetadata(videoPath: string): Promise<PipelineVideoMetadata> {
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
      throw new Error(`Unable to detect video stream from ${videoPath}`)
    }

    const frameRate = this.parseFrameRate(videoStream.avg_frame_rate)
    const hasAudio = Boolean(parsed.streams?.some(stream => stream.codec_type === 'audio'))
    const durationSeconds = Number(parsed.format?.duration || 0)

    return {
      durationSeconds: durationSeconds > 0 ? durationSeconds : 0,
      width: videoStream.width,
      height: videoStream.height,
      frameRate,
      hasAudio,
    }
  }

  async extractKeyFrames(
    videoPath: string,
    workspaceDir: string,
    durationSeconds: number,
  ): Promise<PipelineFrameArtifact[]> {
    const timestamps = [
      0,
      Math.max(durationSeconds / 2, 0),
      Math.max(durationSeconds - 0.2, 0),
    ]

    const labels = ['hook', 'product', 'cta']
    const frameArtifacts: PipelineFrameArtifact[] = []

    for (const [index, timestampSeconds] of timestamps.entries()) {
      const outputPath = join(workspaceDir, `frame-${index + 1}.png`)
      await runCommand(
        'ffmpeg',
        [
          '-y',
          '-ss',
          timestampSeconds.toFixed(3),
          '-i',
          videoPath,
          '-frames:v',
          '1',
          outputPath,
        ],
        { timeoutMs: 30_000 },
      )

      frameArtifacts.push({
        index,
        label: labels[index] || `frame-${index + 1}`,
        timestampSeconds,
        sourcePath: outputPath,
      })
    }

    return frameArtifacts
  }

  private resolveExtension(sourceVideoUrl: string) {
    try {
      const pathname = sourceVideoUrl.startsWith('http://') || sourceVideoUrl.startsWith('https://')
        ? new URL(sourceVideoUrl).pathname
        : sourceVideoUrl.startsWith('file://')
          ? fileURLToPath(sourceVideoUrl)
          : sourceVideoUrl
      const extension = extname(pathname)
      return extension || '.mp4'
    }
    catch {
      return '.mp4'
    }
  }

  private parseFrameRate(frameRate: string | undefined) {
    if (!frameRate || frameRate === '0/0') {
      return 0
    }

    const [numerator, denominator] = frameRate.split('/')
    const left = Number(numerator || 0)
    const right = Number(denominator || 1)
    if (!left || !right) {
      return 0
    }

    return Number((left / right).toFixed(3))
  }
}
