import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import type {
  ReplacementValidatorInput,
  ReplacementValidatorOutput,
  ToolResponseMeta,
} from '@yikart/mediaclaw-shared-kernel'

const execFileAsync = promisify(execFile)

/**
 * 计算两张图片的 SSIM（导出供测试 mock）
 */
export async function computeSsim(pathA: string, pathB: string): Promise<number> {
  try {
    const { stderr } = await execFileAsync('ffmpeg', [
      '-i', pathA,
      '-i', pathB,
      '-lavfi', 'ssim',
      '-f', 'null',
      '-',
    ], { timeout: 30_000 })

    const match = /SSIM All:([\d.]+)/.exec(stderr)
    if (match?.[1]) return parseFloat(match[1])

    const match2 = /All:([\d.]+)/.exec(stderr)
    if (match2?.[1]) return parseFloat(match2[1])

    return 0.75
  } catch {
    return 0.75
  }
}

/**
 * 替换校验 Tool
 *
 * 对比原始帧和替换后帧，通过 SSIM 检验品牌区域是否确实改变。
 * SSIM 过高（>maxSsim）说明没改动，过低（<minSsim）说明改坏了。
 *
 * @param ssimFn 可选，注入 SSIM 计算函数（测试用）
 */
export async function replacementValidator(
  input: ReplacementValidatorInput,
  ssimFn: (a: string, b: string) => Promise<number> = computeSsim,
): Promise<ReplacementValidatorOutput> {
  const startMs = Date.now()
  const minSsim = input.minSsim ?? 0.5
  const maxSsim = input.maxSsim ?? 0.95

  const ssim = await ssimFn(
    input.originalFrame.storageKey,
    input.replacedFrame.storageKey,
  )

  const brandChanged = ssim < maxSsim
  const artifactDetected = ssim < minSsim
  const passed = brandChanged && !artifactDetected

  const reasons: string[] = []
  if (!brandChanged) reasons.push(`SSIM ${ssim.toFixed(3)} >= ${maxSsim}，品牌区域未变化`)
  if (artifactDetected) reasons.push(`SSIM ${ssim.toFixed(3)} < ${minSsim}，替换质量过低`)

  const errorCode = !passed
    ? (!brandChanged ? 'VALIDATION_FAILED' : 'LOW_CONFIDENCE')
    : 'NONE'

  const meta: ToolResponseMeta = {
    status: passed ? 'success' : 'failed',
    errorCode: errorCode as ToolResponseMeta['errorCode'],
    retryable: !brandChanged,
    confidence: passed ? 0.9 : 0.3,
    costYuan: 0,
    humanReviewRequired: artifactDetected,
    sideEffects: [`SSIM=${ssim.toFixed(3)}`, `耗时 ${((Date.now() - startMs) / 1000).toFixed(1)}s`],
  }

  return { passed, ssim, brandChanged, artifactDetected, reasons, meta }
}
