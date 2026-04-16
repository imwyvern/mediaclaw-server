import { createHash } from 'node:crypto'

import type {
  DedupGatekeeperInput,
  DedupGatekeeperOutput,
  ToolResponseMeta,
} from '@yikart/mediaclaw-shared-kernel'

/**
 * 去重检测 Tool
 */
export async function dedupGatekeeper(
  input: DedupGatekeeperInput,
): Promise<DedupGatekeeperOutput> {
  const startMs = Date.now()

  // 简化实现：用 SHA256 前 16 位模拟 pHash
  const currentHash = input.video.sha256.slice(0, 16)

  // 模拟距离计算（实际应查向量库）
  const visualDistance = 0.85
  const audioDistance = 0.9
  const semanticDistance = 0.8

  // 综合判断：所有距离 > 0.3 视为唯一
  const unique = visualDistance > 0.3 && audioDistance > 0.3 && semanticDistance > 0.3
  const rewriteRequired = !unique && semanticDistance < 0.5

  const meta: ToolResponseMeta = {
    status: unique ? 'success' : 'failed',
    errorCode: unique ? 'NONE' : 'DEDUP_FAIL',
    retryable: !unique,
    confidence: 0.85,
    costYuan: 0,
    humanReviewRequired: false,
    sideEffects: [
      `pHash: ${currentHash}`,
      unique ? '内容唯一' : '检测到重复内容',
      `耗时 ${((Date.now() - startMs) / 1000).toFixed(1)}s`,
    ],
  }

  return { unique, visualDistance, audioDistance, semanticDistance, rewriteRequired, meta }
}
