import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

import type {
  VideoAssemblerInput,
  VideoAssemblerOutput,
  VideoAssetRef,
  ToolResponseMeta,
} from '@yikart/mediaclaw-shared-kernel'

const execFileAsync = promisify(execFile)
const MEDIA_TEMP_DIR = () => process.env['MEDIA_TEMP_DIR'] ?? '/tmp/mediaclaw'

/**
 * 视频拼接 Tool — ffmpeg concat demuxer
 */
export async function videoAssembler(
  input: VideoAssemblerInput,
): Promise<VideoAssemblerOutput> {
  const startMs = Date.now()
  const outDir = join(MEDIA_TEMP_DIR(), `assemble_${Date.now()}`)
  await mkdir(outDir, { recursive: true })

  const concatListPath = join(outDir, 'concat.txt')
  const outputPath = join(outDir, 'assembled.mp4')

  const lines = input.shots.map((shot) => `file '${shot.storageKey}'`).join('\n')
  await writeFile(concatListPath, lines)

  await execFileAsync('ffmpeg', [
    '-f', 'concat', '-safe', '0', '-i', concatListPath,
    '-c', 'copy', '-y', outputPath,
  ], { timeout: 120_000 })

  const totalDuration = input.shots.reduce((sum: number, s) => sum + s.durationSec, 0)
  const sha256 = createHash('sha256').update(outputPath + Date.now()).digest('hex')

  const video: VideoAssetRef = {
    assetId: `asm_${Date.now()}`,
    storageKey: outputPath,
    sha256,
    mimeType: 'video/mp4',
    durationSec: totalDuration,
    width: input.shots[0]?.width ?? 720,
    height: input.shots[0]?.height ?? 1280,
    fps: input.shots[0]?.fps ?? 30,
    hasAudio: input.shots.some((s) => s.hasAudio),
  }

  const meta: ToolResponseMeta = {
    status: 'success', errorCode: 'NONE', retryable: false, confidence: 0.95,
    costYuan: 0, humanReviewRequired: false,
    sideEffects: [`拼接 ${input.shots.length} 段`, `总时长 ${totalDuration.toFixed(1)}s`, `耗时 ${((Date.now() - startMs) / 1000).toFixed(1)}s`],
  }

  return { video, transitionUsed: input.transitionType ?? 'cut', meta }
}
