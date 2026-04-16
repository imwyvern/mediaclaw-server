import type {
  QAOptimizerInput,
  QAOptimizerOutput,
  QaIssue,
  ToolResponseMeta,
} from '@yikart/mediaclaw-shared-kernel'

const QA_PASS_SCORE = () => parseInt(process.env['QA_PASS_SCORE'] ?? '70', 10)

/**
 * QA 质量评估 Tool
 */
export async function qaOptimizer(
  input: QAOptimizerInput,
): Promise<QAOptimizerOutput> {
  const startMs = Date.now()
  const issues: QaIssue[] = []

  // 各维度评分（0-100）
  let visual = 90
  let branding = 85
  let audio = 90
  let compliance = 100
  let platformFit = 85
  let dedupRisk = 95
  let engagement = 80

  if (input.video.durationSec < 3) {
    issues.push({ type: 'duration', message: '视频时长不足 3 秒', severity: 'high' })
    visual -= 30
    engagement -= 20
  }

  if (input.video.width < 480 || input.video.height < 480) {
    issues.push({ type: 'resolution', message: '分辨率过低', severity: 'high' })
    visual -= 25
    platformFit -= 20
  }

  if (input.video.fps < 15) {
    issues.push({ type: 'fps', message: '帧率过低', severity: 'medium' })
    visual -= 15
  }

  if (!input.video.hasAudio) {
    issues.push({ type: 'audio', message: '缺少音频轨道', severity: 'medium' })
    audio -= 30
  }

  // 综合分数
  const qaScore = Math.round(
    (visual * 0.25 + branding * 0.15 + audio * 0.15 + compliance * 0.15 +
     platformFit * 0.1 + dedupRisk * 0.1 + engagement * 0.1),
  )

  const passed = qaScore >= QA_PASS_SCORE()

  let retryRecommendation: 'retry' | 'reroute' | 'suspend' = 'suspend'
  if (!passed && input.attempt < 3) retryRecommendation = 'retry'
  else if (!passed && input.attempt >= 3) retryRecommendation = 'suspend'
  if (passed) retryRecommendation = 'retry' // 不影响，passed 时不看此字段

  const meta: ToolResponseMeta = {
    status: passed ? 'success' : 'failed',
    errorCode: passed ? 'NONE' : 'QA_FAIL',
    retryable: !passed && input.attempt < 3,
    confidence: 0.9,
    costYuan: 0,
    humanReviewRequired: false,
    sideEffects: [`QA 分数: ${qaScore}`, `耗时 ${((Date.now() - startMs) / 1000).toFixed(1)}s`],
  }

  return {
    passed,
    qaScore,
    dimensions: {
      visual: Math.max(0, visual),
      branding: Math.max(0, branding),
      audio: Math.max(0, audio),
      compliance: Math.max(0, compliance),
      platformFit: Math.max(0, platformFit),
      dedupRisk: Math.max(0, dedupRisk),
      engagement: Math.max(0, engagement),
    },
    issues,
    retryRecommendation,
    meta,
  }
}
