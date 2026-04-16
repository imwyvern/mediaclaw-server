import type {
  MotionAnalyzerInput,
  MotionAnalyzerOutput,
  MotionAnalysis,
  SceneCut,
  ToolResponseMeta,
} from '@yikart/mediaclaw-shared-kernel'

/** 运镜类型 */
type MotionType = 'PAN' | 'TILT' | 'ZOOM' | 'STATIC' | 'HANDHELD'

/**
 * 运镜分析 Tool
 *
 * 分析每个镜头切片的运镜类型，输出可直接送给视频生成模型的 motionPrompt。
 * 当前实现基于镜头时长和场景描述的启发式规则；
 * 置信度 < 0.7 时标记需要人工复核。
 */
export async function motionAnalyzer(
  input: MotionAnalyzerInput,
): Promise<MotionAnalyzerOutput> {
  const startMs = Date.now()

  const motions: MotionAnalysis[] = input.cuts.map((cut) =>
    analyzeSingleCut(cut, input.styleHint),
  )

  const lowConfCount = motions.filter((m) => m.confidence < 0.7).length

  const meta: ToolResponseMeta = {
    status: 'success',
    errorCode: 'NONE',
    retryable: false,
    confidence: lowConfCount === 0 ? 0.9 : 0.6,
    costYuan: 0,
    humanReviewRequired: lowConfCount > 0,
    sideEffects: [
      `分析 ${motions.length} 个镜头`,
      lowConfCount > 0 ? `${lowConfCount} 个低置信度需人工复核` : '',
      `耗时 ${((Date.now() - startMs) / 1000).toFixed(1)}s`,
    ].filter(Boolean),
  }

  return { motions, meta }
}

/**
 * 分析单个镜头的运镜类型
 *
 * 启发式规则：
 * - 时长 < 1.5s → 快切，STATIC
 * - 时长 1.5-4s → 标准镜头，根据场景描述推断
 * - 时长 > 4s → 长镜头，倾向 PAN/TILT/ZOOM
 */
function analyzeSingleCut(cut: SceneCut, styleHint?: string): MotionAnalysis {
  const duration = cut.endSec - cut.startSec
  const desc = (cut.sceneDescription ?? '').toLowerCase()

  let motionType: MotionType
  let confidence: number
  let motionPrompt: string

  if (duration < 1.5) {
    // 快切镜头，通常是静态或微动
    motionType = 'STATIC'
    confidence = 0.8
    motionPrompt = 'static shot, minimal camera movement'
  } else if (duration > 4) {
    // 长镜头，推断运镜
    const result = inferMotionFromDescription(desc)
    motionType = result.type
    confidence = result.confidence
    motionPrompt = result.prompt
  } else {
    // 标准镜头
    if (desc.includes('pan') || desc.includes('横移') || desc.includes('平移')) {
      motionType = 'PAN'
      confidence = 0.85
      motionPrompt = 'smooth horizontal pan, left to right'
    } else if (desc.includes('tilt') || desc.includes('俯仰') || desc.includes('上移')) {
      motionType = 'TILT'
      confidence = 0.85
      motionPrompt = 'gentle vertical tilt, bottom to top'
    } else if (desc.includes('zoom') || desc.includes('推') || desc.includes('拉')) {
      motionType = 'ZOOM'
      confidence = 0.85
      motionPrompt = 'slow zoom in, focus on subject'
    } else {
      // 无明确线索，默认 STATIC + 低置信度
      motionType = 'STATIC'
      confidence = 0.55
      motionPrompt = 'static or subtle movement'
    }
  }

  // styleHint 修饰 prompt
  if (styleHint) {
    motionPrompt = `${motionPrompt}, ${styleHint} style`
  }

  return {
    cutId: cut.cutId,
    motionType,
    motionPrompt,
    confidence,
  }
}

/** 从场景描述推断长镜头运镜 */
function inferMotionFromDescription(desc: string): {
  type: MotionType
  confidence: number
  prompt: string
} {
  if (desc.includes('pan') || desc.includes('横') || desc.includes('扫')) {
    return { type: 'PAN', confidence: 0.8, prompt: 'wide horizontal pan, cinematic sweep' }
  }
  if (desc.includes('tilt') || desc.includes('俯') || desc.includes('仰')) {
    return { type: 'TILT', confidence: 0.8, prompt: 'vertical tilt reveal, dramatic angle' }
  }
  if (desc.includes('zoom') || desc.includes('推') || desc.includes('特写')) {
    return { type: 'ZOOM', confidence: 0.8, prompt: 'slow zoom in to detail, cinematic focus' }
  }
  if (desc.includes('手持') || desc.includes('handheld') || desc.includes('shake')) {
    return { type: 'HANDHELD', confidence: 0.75, prompt: 'handheld camera, natural sway' }
  }

  // 长镜头无线索 → PAN 是最常见的默认
  return { type: 'PAN', confidence: 0.5, prompt: 'gentle camera movement, slow pan' }
}
