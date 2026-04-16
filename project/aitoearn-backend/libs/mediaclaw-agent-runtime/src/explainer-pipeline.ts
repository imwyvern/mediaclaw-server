import type {
  ExplainerPipelineInput,
  ExplainerPipelineOutput,
  VideoAssetRef,
  AssetRef,
  CostBreakdown,
  QualityReport,
  ToolResponseMeta,
} from '@yikart/mediaclaw-shared-kernel'

export type ToolFn<I, O> = (input: I) => Promise<O>

export interface ExplainerToolbox {
  remotionRender: ToolFn<{ product: unknown; templateId: string; durationSec: number }, { video: VideoAssetRef; meta: ToolResponseMeta }>
  scriptWriter: ToolFn<{ style: string; language: string; product?: unknown }, { lines: Array<{ lineId: string; text: string; durationSec: number }>; fullScript: string; meta: ToolResponseMeta }>
  ttsEngine: ToolFn<{ lines: Array<{ lineId: string; text: string; durationSec: number }>; voiceId: string; payloadFormat: string }, { mergedAudio: AssetRef; meta: ToolResponseMeta }>
  finalComposer: ToolFn<{ video: VideoAssetRef; ttsAudio?: AssetRef }, { video: VideoAssetRef; meta: ToolResponseMeta }>
  qaOptimizer: ToolFn<{ video: VideoAssetRef; attempt: number }, { passed: boolean; qaScore: number; issues: Array<{ type: string; message: string; severity: 'low' | 'medium' | 'high' }>; meta: ToolResponseMeta }>
}

/**
 * 讲解视频管线 — remotion → script → tts → compose → QA
 */
export async function runExplainerPipeline(
  input: ExplainerPipelineInput,
  toolbox: ExplainerToolbox,
): Promise<ExplainerPipelineOutput> {
  const costs: CostBreakdown = { total: 0 }

  // Step 1: Remotion 渲染模板视频
  let templateVideo: VideoAssetRef
  try {
    const renderResult = await toolbox.remotionRender({
      product: input.product,
      templateId: input.templateId,
      durationSec: input.durationSec,
    })
    templateVideo = renderResult.video
    costs.total += renderResult.meta.costYuan
  } catch {
    return { finalVideo: emptyVideo(), costBreakdown: costs, qualityReport: { qaScore: 0, passed: false, issues: [] } }
  }

  // Step 2: 文案生成
  let scriptLines: Array<{ lineId: string; text: string; durationSec: number }> = []
  try {
    const scriptResult = await toolbox.scriptWriter({
      style: 'review',
      language: 'zh-CN',
      product: input.product,
    })
    scriptLines = scriptResult.lines
    costs.total += scriptResult.meta.costYuan
  } catch {
    // 文案失败不阻塞
  }

  // Step 3: TTS 配音
  let mergedAudio: AssetRef | undefined
  if (scriptLines.length > 0) {
    try {
      const ttsResult = await toolbox.ttsEngine({
        lines: scriptLines,
        voiceId: 'zh_male_liufei_uranus_bigtts',
        payloadFormat: 'req_params',
      })
      mergedAudio = ttsResult.mergedAudio
      costs.tts = ttsResult.meta.costYuan
      costs.total += ttsResult.meta.costYuan
    } catch {
      // TTS 失败不阻塞
    }
  }

  // Step 4: 最终合成
  let finalVideo: VideoAssetRef
  try {
    const composeResult = await toolbox.finalComposer({
      video: templateVideo,
      ttsAudio: mergedAudio,
    })
    finalVideo = composeResult.video
  } catch {
    finalVideo = templateVideo
  }

  // Step 5: QA
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
