import type {
  AiLivePipelineInput,
  AiLivePipelineOutput,
  VideoAssetRef,
  ImageAssetRef,
  CostBreakdown,
  QualityReport,
  ToolResponseMeta,
} from '@yikart/mediaclaw-shared-kernel'
import { TaskState } from '@yikart/mediaclaw-shared-kernel'

export type ToolFn<I, O> = (input: I) => Promise<O>

export interface AiLiveToolbox {
  videoGenerator: ToolFn<{ firstFrame: ImageAssetRef; motionPrompt: string; model: string; durationSec: number }, { video: VideoAssetRef; estimatedCostYuan: number; meta: ToolResponseMeta }>
  videoAssembler: ToolFn<{ shots: VideoAssetRef[] }, { video: VideoAssetRef; meta: ToolResponseMeta }>
  finalComposer: ToolFn<{ video: VideoAssetRef }, { video: VideoAssetRef; meta: ToolResponseMeta }>
  qaOptimizer: ToolFn<{ video: VideoAssetRef; attempt: number }, { passed: boolean; qaScore: number; issues: Array<{ type: string; message: string; severity: 'low' | 'medium' | 'high' }>; meta: ToolResponseMeta }>
}

/**
 * AI 微动管线 — 产品图 → video-generator → assembler → composer → QA
 */
export async function runAiLivePipeline(
  input: AiLivePipelineInput,
  toolbox: AiLiveToolbox,
): Promise<AiLivePipelineOutput> {
  const costs: CostBreakdown = { total: 0 }

  // Step 1: 逐图生成微动视频
  const shots: VideoAssetRef[] = []
  let genCost = 0
  const perImageDuration = Math.max(2, input.durationSec / Math.max(1, input.productImages.length))

  for (const img of input.productImages) {
    try {
      const result = await toolbox.videoGenerator({
        firstFrame: img,
        motionPrompt: input.style,
        model: 'seedance-1.5',
        durationSec: perImageDuration,
      })
      shots.push(result.video)
      genCost += result.estimatedCostYuan
    } catch {
      // 跳过失败的图片
    }
  }

  costs.generation = genCost
  costs.total += genCost

  if (shots.length === 0) {
    return {
      finalVideo: emptyVideo(),
      costBreakdown: costs,
      qualityReport: { qaScore: 0, passed: false, issues: [] },
    }
  }

  // Step 2: 拼接
  let assembled: VideoAssetRef
  try {
    const asmResult = await toolbox.videoAssembler({ shots })
    assembled = asmResult.video
  } catch {
    return { finalVideo: shots[0], costBreakdown: costs, qualityReport: { qaScore: 0, passed: false, issues: [] } }
  }

  // Step 3: 最终合成
  let finalVideo: VideoAssetRef
  try {
    const composeResult = await toolbox.finalComposer({ video: assembled })
    finalVideo = composeResult.video
  } catch {
    finalVideo = assembled
  }

  // Step 4: QA
  let qualityReport: QualityReport = { qaScore: 0, passed: false, issues: [] }
  try {
    const qaResult = await toolbox.qaOptimizer({ video: finalVideo, attempt: 1 })
    qualityReport = { qaScore: qaResult.qaScore, passed: qaResult.passed, issues: qaResult.issues }
  } catch {
    // QA 失败不阻塞
  }

  return { finalVideo, costBreakdown: costs, qualityReport }
}

function emptyVideo(): VideoAssetRef {
  return { assetId: '', storageKey: '', sha256: '', mimeType: 'video/mp4', durationSec: 0, width: 0, height: 0, fps: 0, hasAudio: false }
}
