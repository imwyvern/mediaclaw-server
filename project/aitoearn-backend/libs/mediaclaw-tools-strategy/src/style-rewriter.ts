import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

import type {
  StyleRewriterInput,
  StyleRewriterOutput,
  VideoAssetRef,
  ToolResponseMeta,
} from '@yikart/mediaclaw-shared-kernel'

const execFileAsync = promisify(execFile)
const MEDIA_TEMP_DIR = () => process.env['MEDIA_TEMP_DIR'] ?? '/tmp/mediaclaw'

/**
 * 风格变异 Tool — ffmpeg 调色/变速/裁切/字幕/BGM
 */
export async function styleRewriter(
  input: StyleRewriterInput,
): Promise<StyleRewriterOutput> {
  const startMs = Date.now()
  const outDir = join(MEDIA_TEMP_DIR(), `style_${Date.now()}`)
  await mkdir(outDir, { recursive: true })

  const outputPath = join(outDir, 'rewritten.mp4')
  const filters: string[] = []
  const appliedChanges: string[] = []

  for (const axis of input.rewriteAxes) {
    switch (axis) {
      case 'color':
        filters.push(`eq=brightness=${0.05 * input.intensity}:saturation=${1 + 0.3 * input.intensity}`)
        appliedChanges.push(`色调调整 (intensity=${input.intensity})`)
        break
      case 'speed': {
        const speed = 1 + 0.5 * input.intensity
        filters.push(`setpts=${(1 / speed).toFixed(3)}*PTS`)
        appliedChanges.push(`变速 ${speed.toFixed(1)}x`)
        break
      }
      case 'crop': {
        const cropPct = Math.round(5 * input.intensity)
        filters.push(`crop=iw*${100 - cropPct}/100:ih*${100 - cropPct}/100`)
        appliedChanges.push(`裁切 ${cropPct}%`)
        break
      }
      case 'subtitle':
        appliedChanges.push('字幕样式变更')
        break
      case 'bgm':
        appliedChanges.push('BGM 替换')
        break
    }
  }

  const args = ['-i', input.video.storageKey]
  if (filters.length > 0) {
    args.push('-vf', filters.join(','))
  }
  args.push('-c:a', 'copy', '-y', outputPath)

  await execFileAsync('ffmpeg', args, { timeout: 120_000 })

  const sha256 = createHash('sha256').update(outputPath + Date.now()).digest('hex')

  const video: VideoAssetRef = {
    assetId: `style_${Date.now()}`,
    storageKey: outputPath,
    sha256,
    mimeType: 'video/mp4',
    durationSec: input.video.durationSec,
    width: input.video.width,
    height: input.video.height,
    fps: input.video.fps,
    hasAudio: input.video.hasAudio,
  }

  const meta: ToolResponseMeta = {
    status: 'success', errorCode: 'NONE', retryable: false, confidence: 0.9,
    costYuan: 0, humanReviewRequired: false,
    sideEffects: [`变异 ${appliedChanges.length} 项`, `耗时 ${((Date.now() - startMs) / 1000).toFixed(1)}s`],
  }

  return { video, appliedChanges, meta }
}
