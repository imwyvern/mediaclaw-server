import { createHash } from 'node:crypto'

import type {
  ShotUpgraderInput,
  ShotUpgraderOutput,
  VideoAssetRef,
  ToolResponseMeta,
} from '@yikart/mediaclaw-shared-kernel'

const POLL_INTERVAL = 5_000
const POLL_TIMEOUT = 300_000

/**
 * 镜头升级 Tool — 用更高质量模型重新生成单个镜头
 */
export async function shotUpgrader(
  input: ShotUpgraderInput,
): Promise<ShotUpgraderOutput> {
  const startMs = Date.now()
  const apiKey = process.env['SEEDANCE_API_KEY']
  if (!apiKey) throw new Error('SEEDANCE_API_KEY 未配置')

  const baseUrl = process.env['VCE_BASE_URL'] ?? 'https://api.vectorengine.ai'

  const resp = await fetch(`${baseUrl}/kling/v1/videos/omni-video`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url: input.originalShot.url ?? input.originalShot.storageKey,
      prompt: `upgrade quality, ${input.reason}`,
      duration: input.originalShot.durationSec,
    }),
  })

  if (!resp.ok) {
    throw Object.assign(new Error(`升级任务提交失败: ${resp.status}`), {
      meta: { errorCode: 'API_DOWN', retryable: true },
    })
  }

  const data = (await resp.json()) as { data?: { task_id?: string } }
  const taskId = data.data?.task_id
  if (!taskId) throw new Error('升级任务返回无 task_id')

  // 轮询
  const videoUrl = await pollTask(baseUrl, apiKey, taskId)

  const sha256 = createHash('sha256').update(videoUrl).digest('hex')

  const upgradedShot: VideoAssetRef = {
    assetId: `upgraded_${Date.now()}`,
    storageKey: videoUrl,
    url: videoUrl,
    sha256,
    mimeType: 'video/mp4',
    durationSec: input.originalShot.durationSec,
    width: input.originalShot.width,
    height: input.originalShot.height,
    fps: input.originalShot.fps,
    hasAudio: false,
  }

  const meta: ToolResponseMeta = {
    status: 'success', errorCode: 'NONE', retryable: false, confidence: 0.9,
    costYuan: input.upgradeModel === 'seedance-2.0' ? 0.8 : 0.3,
    humanReviewRequired: false,
    sideEffects: [`模型: ${input.upgradeModel}`, `耗时 ${((Date.now() - startMs) / 1000).toFixed(1)}s`],
  }

  return { upgradedShot, improvementSummary: `使用 ${input.upgradeModel} 升级: ${input.reason}`, meta }
}

async function pollTask(baseUrl: string, apiKey: string, taskId: string): Promise<string> {
  const deadline = Date.now() + POLL_TIMEOUT
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL))
    const resp = await fetch(`${baseUrl}/kling/v1/videos/omni-video/${taskId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    })
    if (!resp.ok) continue
    const data = (await resp.json()) as { data?: { task_status?: string; task_result?: { videos?: Array<{ url?: string }> } } }
    if (data.data?.task_status === 'succeed') {
      const url = data.data?.task_result?.videos?.[0]?.url
      if (url) return url
    }
    if (data.data?.task_status === 'failed') throw new Error('升级失败')
  }
  throw new Error('升级超时')
}
