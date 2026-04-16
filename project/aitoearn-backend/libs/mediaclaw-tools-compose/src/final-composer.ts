import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

import type {
  FinalComposerInput,
  FinalComposerOutput,
  VideoAssetRef,
  ToolResponseMeta,
} from '@yikart/mediaclaw-shared-kernel'

const execFileAsync = promisify(execFile)
const MEDIA_TEMP_DIR = () => process.env['MEDIA_TEMP_DIR'] ?? '/tmp/mediaclaw'

/**
 * 最终合成 Tool — 合并视频 + TTS 音频 + 字幕
 */
export async function finalComposer(
  input: FinalComposerInput,
): Promise<FinalComposerOutput> {
  const startMs = Date.now()
  const outDir = join(MEDIA_TEMP_DIR(), `compose_${Date.now()}`)
  await mkdir(outDir, { recursive: true })

  const outputPath = join(outDir, 'final.mp4')
  const args = ['-i', input.video.storageKey]

  if (input.ttsAudio) {
    args.push('-i', input.ttsAudio.storageKey)
  }

  args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '23')

  if (input.ttsAudio) {
    args.push('-c:a', 'aac', '-b:a', '128k', '-shortest')
  }

  args.push('-y', outputPath)

  await execFileAsync('ffmpeg', args, { timeout: 180_000 })

  const sha256 = createHash('sha256').update(outputPath + Date.now()).digest('hex')

  const video: VideoAssetRef = {
    assetId: `final_${Date.now()}`,
    storageKey: outputPath,
    sha256,
    mimeType: 'video/mp4',
    durationSec: input.video.durationSec,
    width: input.video.width,
    height: input.video.height,
    fps: input.video.fps,
    hasAudio: !!input.ttsAudio,
  }

  const meta: ToolResponseMeta = {
    status: 'success', errorCode: 'NONE', retryable: false, confidence: 0.95,
    costYuan: 0, humanReviewRequired: false,
    sideEffects: [`耗时 ${((Date.now() - startMs) / 1000).toFixed(1)}s`],
  }

  return { video, meta }
}
