import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import * as path from 'node:path'

import type {
  RemotionRenderInput,
  RemotionRenderOutput,
  VideoAssetRef,
  ToolResponseMeta,
} from '@yikart/mediaclaw-shared-kernel'

const execFileAsync = promisify(execFile)

/**
 * Remotion 渲染 Tool — 本地 CLI 渲染模板视频
 *
 * 依赖：npx remotion render
 * 不需要 API Key，Remotion 是自部署/本地工具
 *
 * 环境变量：
 *   REMOTION_COMPOSITIONS_DIR  — compositions 目录（默认 ./remotion）
 *   MEDIA_TEMP_DIR             — 渲染输出目录（默认 /tmp/mediaclaw）
 */
export async function remotionRender(
  input: RemotionRenderInput,
): Promise<RemotionRenderOutput> {
  const startMs = Date.now()

  const compositionsDir = process.env['REMOTION_COMPOSITIONS_DIR'] ?? './remotion'
  const tempDir = process.env['MEDIA_TEMP_DIR'] ?? '/tmp/mediaclaw'
  const outputPath = path.join(tempDir, `remotion_${Date.now()}.mp4`)

  if (!existsSync(compositionsDir)) {
    throw new Error(`Remotion compositions 目录不存在: ${compositionsDir}`)
  }

  const inputPropsJson = JSON.stringify({
    product: input.product,
    durationSec: input.durationSec,
    brandTheme: input.brandTheme,
  })

  await execFileAsync('npx', [
    'remotion', 'render',
    compositionsDir,
    input.templateId,
    outputPath,
    '--props', inputPropsJson,
    '--codec', 'h264',
    '--image-format', 'jpeg',
    '--log', 'error',
  ], {
    timeout: 180_000, // 3min
  })

  const sha256 = createHash('sha256').update(outputPath).digest('hex')

  const video: VideoAssetRef = {
    assetId: `remotion_${Date.now()}`,
    storageKey: outputPath,
    sha256,
    mimeType: 'video/mp4',
    durationSec: input.durationSec,
    width: 1080,
    height: 1920,
    fps: 30,
    hasAudio: false,
  }

  const meta: ToolResponseMeta = {
    status: 'success',
    errorCode: 'NONE',
    retryable: false,
    confidence: 0.95,
    costYuan: 0,
    humanReviewRequired: false,
    sideEffects: [`耗时 ${((Date.now() - startMs) / 1000).toFixed(1)}s`],
  }

  return { video, renderJobId: outputPath, meta }
}
