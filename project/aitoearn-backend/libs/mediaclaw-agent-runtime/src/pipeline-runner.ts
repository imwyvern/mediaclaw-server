import type {
  ProductShowcasePipelineInput,
  ProductShowcasePipelineOutput,
  VideoAssetRef,
  ImageAssetRef,
  CostBreakdown,
  QualityReport,
  ToolResponseMeta,
  SceneCut,
  QaIssue,
} from '@yikart/mediaclaw-shared-kernel'
import { TaskState } from '@yikart/mediaclaw-shared-kernel'

import type { AgentContext } from './agent-context'
import { agentDecide } from './agent-decide'

/** Tool 函数签名 */
export type ToolFn<I, O> = (input: I) => Promise<O>

/**
 * 管线依赖注入容器
 */
export interface PipelineToolbox {
  videoDownload: ToolFn<{ sourceUrl: string; expectedPlatform?: string }, { video: VideoAssetRef; sourceUsed: string; fallbackAttempts: number; meta: ToolResponseMeta }>
  sceneCutter: ToolFn<{ video: VideoAssetRef }, { cuts: SceneCut[]; meta: ToolResponseMeta }>
  motionAnalyzer: ToolFn<{ cuts: SceneCut[]; video: VideoAssetRef }, { motions: Array<{ cutId: string; motionType: string; motionPrompt: string }>; meta: ToolResponseMeta }>
  brandReplacer: ToolFn<{ video: VideoAssetRef; sourceBrand: string; targetBrand: string }, { video: VideoAssetRef; meta: ToolResponseMeta }>
  videoGenerator: ToolFn<{ firstFrame: ImageAssetRef; motionPrompt: string; model: string; durationSec: number; seed?: number }, { video: VideoAssetRef; modelUsed: string; estimatedCostYuan: number; meta: ToolResponseMeta }>
  scriptWriter: ToolFn<{ style: string; language: string; brand?: unknown; product?: unknown }, { lines: Array<{ lineId: string; text: string; durationSec: number }>; fullScript: string; meta: ToolResponseMeta }>
  ttsEngine: ToolFn<{ lines: Array<{ lineId: string; text: string; durationSec: number }>; voiceId: string; payloadFormat: string }, { audioSegments: unknown[]; mergedAudio: { assetId: string; storageKey: string; sha256: string; mimeType: string }; meta: ToolResponseMeta }>
  videoAssembler: ToolFn<{ shots: VideoAssetRef[] }, { video: VideoAssetRef; transitionUsed: string; meta: ToolResponseMeta }>
  finalComposer: ToolFn<{ video: VideoAssetRef; ttsAudio?: unknown }, { video: VideoAssetRef; meta: ToolResponseMeta }>
  qaOptimizer: ToolFn<{ video: VideoAssetRef; attempt: number }, { passed: boolean; qaScore: number; issues: QaIssue[]; meta: ToolResponseMeta }>
  dedupGatekeeper: ToolFn<{ video: VideoAssetRef }, { unique: boolean; meta: ToolResponseMeta }>
  contentReviewer: ToolFn<{ platform: string; title?: string; description?: string }, { compliance: { passed: boolean; warnings: string[]; violations: string[] }; meta: ToolResponseMeta }>
}

/**
 * 管线运行事件
 */
export interface PipelineEvent {
  step: string
  toolId: string
  status: 'success' | 'failed' | 'skipped'
  durationMs: number
  costYuan: number
  message: string
}

export type PipelineEventHandler = (event: PipelineEvent) => void

/**
 * MVP 种草管线 Runner
 *
 * 编排 12 步管线：
 * 1. video-download  → 下载原始视频
 * 2. scene-cutter    → 场景切割
 * 3. motion-analyzer → 运镜分析
 * 4. brand-replacer  → 品牌替换
 * 5. video-generator → 逐镜头 AI 生成
 * 6. script-writer   → 文案生成
 * 7. tts-engine      → TTS 配音
 * 8. video-assembler → 镜头拼接
 * 9. final-composer  → 最终合成
 * 10. qa-optimizer   → 质量评估
 * 11. dedup-gatekeeper → 查重
 * 12. content-reviewer → 合规
 */
export async function runProductShowcasePipeline(
  input: ProductShowcasePipelineInput,
  toolbox: PipelineToolbox,
  onEvent?: PipelineEventHandler,
): Promise<ProductShowcasePipelineOutput> {
  const costs: CostBreakdown = { total: 0 }
  let currentState: TaskState = TaskState.PRODUCING

  const ctx: AgentContext = {
    currentState,
    retryCount: 0,
    routeSwitchCount: 0,
    productionMode: 'production',
    inputReady: true,
    currentCostYuan: 0,
    estimatedCostYuan: input.brief.estimatedCostYuan,
    customerConfirmedOverBudget: false,
    employeeConfirmed: false,
    hasPlatformEvidenceUrl: false,
    cancelRequested: false,
    takedownReported: false,
  }

  const emit = (step: string, toolId: string, status: 'success' | 'failed', durationMs: number, costYuan: number, message: string) => {
    onEvent?.({ step, toolId, status, durationMs, costYuan, message })
  }

  // Step 1: 下载原始视频（从 brief 的第一个 cut 的 sourceUrl）
  const sourceUrl = (input.brief.cuts[0] as unknown as { videoRef?: { url?: string } })?.videoRef?.url ?? ''
  let sourceVideo: VideoAssetRef

  const t1 = Date.now()
  try {
    const dlResult = await toolbox.videoDownload({ sourceUrl })
    sourceVideo = dlResult.video
    costs.total += dlResult.meta.costYuan
    ctx.currentCostYuan = costs.total
    emit('1/12', 'video-download', 'success', Date.now() - t1, dlResult.meta.costYuan, `下载完成: ${dlResult.sourceUsed}`)
  } catch (err) {
    emit('1/12', 'video-download', 'failed', Date.now() - t1, 0, String(err))
    return makeSuspendedOutput(costs)
  }

  // Step 2: 场景切割
  const t2 = Date.now()
  let cuts: SceneCut[]
  try {
    const cutResult = await toolbox.sceneCutter({ video: sourceVideo })
    cuts = cutResult.cuts
    emit('2/12', 'scene-cutter', 'success', Date.now() - t2, 0, `切割 ${cuts.length} 个场景`)
  } catch (err) {
    emit('2/12', 'scene-cutter', 'failed', Date.now() - t2, 0, String(err))
    return makeSuspendedOutput(costs)
  }

  // Step 3: 运镜分析
  const t3 = Date.now()
  try {
    const motionResult = await toolbox.motionAnalyzer({ cuts, video: sourceVideo })
    // 合并 motion 到 cuts
    for (const m of motionResult.motions) {
      const cut = cuts.find((c) => c.cutId === m.cutId)
      if (cut) {
        (cut as SceneCut & { motionType?: string; motionPrompt?: string }).motionType = m.motionType;
        (cut as SceneCut & { motionType?: string; motionPrompt?: string }).motionPrompt = m.motionPrompt
      }
    }
    emit('3/12', 'motion-analyzer', 'success', Date.now() - t3, 0, `分析 ${motionResult.motions.length} 个运镜`)
  } catch (err) {
    emit('3/12', 'motion-analyzer', 'failed', Date.now() - t3, 0, String(err))
    // 运镜分析失败不阻塞，使用默认
  }

  // Step 4: 品牌替换
  const t4 = Date.now()
  try {
    const replaceResult = await toolbox.brandReplacer({
      video: sourceVideo,
      sourceBrand: 'original',
      targetBrand: input.targetBrand.brandName,
    })
    sourceVideo = replaceResult.video
    costs.replacement = replaceResult.meta.costYuan
    costs.total += replaceResult.meta.costYuan
    ctx.currentCostYuan = costs.total
    emit('4/12', 'brand-replacer', 'success', Date.now() - t4, replaceResult.meta.costYuan, '品牌替换完成')
  } catch (err) {
    emit('4/12', 'brand-replacer', 'failed', Date.now() - t4, 0, String(err))
    // 品牌替换失败不阻塞
  }

  // Step 5: 逐镜头 AI 视频生成
  const t5 = Date.now()
  const generatedShots: VideoAssetRef[] = []
  let genCost = 0

  for (const cut of cuts) {
    const allocation = input.brief.modelAllocation.find((a) => a.cutId === cut.cutId)
    const model = allocation?.model ?? 'seedance-1.5'
    const motionPrompt = (cut as SceneCut & { motionPrompt?: string }).motionPrompt ?? 'gentle movement'
    const durationSec = cut.endSec - cut.startSec

    // 需要一个首帧（简化：从 cut 的 keyFrame 获取）
    const firstFrame: ImageAssetRef = cut.firstFrame ?? {
      assetId: `frame_${cut.cutId}`,
      storageKey: sourceVideo.storageKey,
      sha256: sourceVideo.sha256,
      mimeType: 'image/jpeg',
      width: sourceVideo.width,
      height: sourceVideo.height,
    }

    try {
      const genResult = await toolbox.videoGenerator({
        firstFrame,
        motionPrompt,
        model,
        durationSec: Math.min(durationSec, 10),
      })
      generatedShots.push(genResult.video)
      genCost += genResult.estimatedCostYuan
    } catch (err) {
      // 生成失败时用决策引擎判断
      const decision = agentDecide(
        { status: 'failed', errorCode: 'API_DOWN', retryable: true, confidence: 0, costYuan: 0, humanReviewRequired: false, sideEffects: [] },
        { ...ctx, currentToolId: 'video-generator' },
      )
      emit('5/12', 'video-generator', 'failed', 0, 0, `${cut.cutId} 生成失败: ${decision.reason}`)

      if (decision.type === 'SUSPEND_TASK') {
        return makeSuspendedOutput(costs)
      }
      // 否则跳过这个 shot
    }
  }

  costs.generation = genCost
  costs.total += genCost
  ctx.currentCostYuan = costs.total
  emit('5/12', 'video-generator', 'success', Date.now() - t5, genCost, `生成 ${generatedShots.length}/${cuts.length} 个镜头`)

  if (generatedShots.length === 0) {
    return makeSuspendedOutput(costs)
  }

  // Step 6: 文案生成
  const t6 = Date.now()
  let scriptLines: Array<{ lineId: string; text: string; durationSec: number }> = []
  try {
    const scriptResult = await toolbox.scriptWriter({
      style: 'seed',
      language: 'zh-CN',
      brand: input.targetBrand,
      product: input.targetProduct,
    })
    scriptLines = scriptResult.lines
    emit('6/12', 'script-writer', 'success', Date.now() - t6, scriptResult.meta.costYuan, `生成 ${scriptLines.length} 句文案`)
  } catch (err) {
    emit('6/12', 'script-writer', 'failed', Date.now() - t6, 0, String(err))
    // 文案失败不阻塞，用 brief 自带的
    scriptLines = input.brief.script
  }

  // Step 7: TTS 配音
  const t7 = Date.now()
  let mergedAudio: { assetId: string; storageKey: string; sha256: string; mimeType: string } | undefined
  try {
    const ttsResult = await toolbox.ttsEngine({
      lines: scriptLines,
      voiceId: 'zh_male_liufei_uranus_bigtts',
      payloadFormat: 'req_params',
    })
    mergedAudio = ttsResult.mergedAudio
    costs.tts = ttsResult.meta.costYuan
    costs.total += ttsResult.meta.costYuan
    ctx.currentCostYuan = costs.total
    emit('7/12', 'tts-engine', 'success', Date.now() - t7, ttsResult.meta.costYuan, 'TTS 合成完成')
  } catch (err) {
    emit('7/12', 'tts-engine', 'failed', Date.now() - t7, 0, String(err))
  }

  // Step 8: 镜头拼接
  const t8 = Date.now()
  let assembledVideo: VideoAssetRef
  try {
    const asmResult = await toolbox.videoAssembler({ shots: generatedShots })
    assembledVideo = asmResult.video
    emit('8/12', 'video-assembler', 'success', Date.now() - t8, 0, `拼接 ${generatedShots.length} 段`)
  } catch (err) {
    emit('8/12', 'video-assembler', 'failed', Date.now() - t8, 0, String(err))
    return makeSuspendedOutput(costs)
  }

  // Step 9: 最终合成
  const t9 = Date.now()
  let finalVideo: VideoAssetRef
  try {
    const composeResult = await toolbox.finalComposer({
      video: assembledVideo,
      ttsAudio: mergedAudio,
    })
    finalVideo = composeResult.video
    costs.compose = composeResult.meta.costYuan
    costs.total += composeResult.meta.costYuan
    emit('9/12', 'final-composer', 'success', Date.now() - t9, 0, '最终合成完成')
  } catch (err) {
    emit('9/12', 'final-composer', 'failed', Date.now() - t9, 0, String(err))
    return makeSuspendedOutput(costs)
  }

  // Step 10: QA 质量评估
  const t10 = Date.now()
  let qualityReport: QualityReport = { qaScore: 0, passed: false, issues: [] }
  try {
    const qaResult = await toolbox.qaOptimizer({ video: finalVideo, attempt: 1 })
    qualityReport = { qaScore: qaResult.qaScore, passed: qaResult.passed, issues: qaResult.issues }
    ctx.qaScore = qaResult.qaScore

    const decision = agentDecide(qaResult.meta, { ...ctx, currentToolId: 'qa-optimizer' })
    emit('10/12', 'qa-optimizer', qaResult.passed ? 'success' : 'failed', Date.now() - t10, 0, `QA ${qaResult.qaScore} 分 → ${decision.type}`)

    if (decision.type === 'SUSPEND_TASK') {
      return { finalVideo, costBreakdown: costs, qualityReport, state: TaskState.SUSPENDED }
    }
  } catch (err) {
    emit('10/12', 'qa-optimizer', 'failed', Date.now() - t10, 0, String(err))
  }

  // Step 11: 查重
  const t11 = Date.now()
  try {
    const dedupResult = await toolbox.dedupGatekeeper({ video: finalVideo })
    ctx.unique = dedupResult.unique
    emit('11/12', 'dedup-gatekeeper', dedupResult.unique ? 'success' : 'failed', Date.now() - t11, 0, dedupResult.unique ? '内容唯一' : '检测到重复')
  } catch (err) {
    emit('11/12', 'dedup-gatekeeper', 'failed', Date.now() - t11, 0, String(err))
  }

  // Step 12: 合规审核
  const t12 = Date.now()
  try {
    const reviewResult = await toolbox.contentReviewer({
      platform: 'douyin',
      title: scriptLines[0]?.text,
      description: scriptLines.map((l) => l.text).join(' '),
    })
    ctx.compliant = reviewResult.compliance.passed
    emit('12/12', 'content-reviewer', reviewResult.compliance.passed ? 'success' : 'failed', Date.now() - t12, 0,
      reviewResult.compliance.passed ? '合规通过' : `违规 ${reviewResult.compliance.violations.length} 项`)
  } catch (err) {
    emit('12/12', 'content-reviewer', 'failed', Date.now() - t12, 0, String(err))
  }

  // 最终状态判定
  const finalState = qualityReport.passed && ctx.unique !== false && ctx.compliant !== false
    ? TaskState.QA_PASSED
    : TaskState.PRODUCING

  return { finalVideo, costBreakdown: costs, qualityReport, state: finalState }
}

function makeSuspendedOutput(costs: CostBreakdown): ProductShowcasePipelineOutput {
  return {
    finalVideo: {
      assetId: '', storageKey: '', sha256: '', mimeType: 'video/mp4',
      durationSec: 0, width: 0, height: 0, fps: 0, hasAudio: false,
    },
    costBreakdown: costs,
    qualityReport: { qaScore: 0, passed: false, issues: [] },
    state: TaskState.SUSPENDED,
  }
}
