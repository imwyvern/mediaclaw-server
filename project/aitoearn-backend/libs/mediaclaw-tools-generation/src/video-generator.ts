import { createHash } from 'node:crypto'

import type {
  VideoGeneratorInput,
  VideoGeneratorOutput,
  VideoAssetRef,
  ToolResponseMeta,
  VideoModel,
} from '@yikart/mediaclaw-shared-kernel'

/** Seedance API 轮询间隔 ms */
const POLL_INTERVAL = 5_000
/** Seedance API 超时 ms */
const POLL_TIMEOUT = 300_000

/**
 * 视频生成 Tool
 *
 * hero 镜头（model=seedance-2.0）使用高质量模型，
 * 普通镜头（model=seedance-1.5）使用标准模型。
 * 提交任务后轮询直到完成。
 */
export async function videoGenerator(
  input: VideoGeneratorInput,
): Promise<VideoGeneratorOutput> {
  const startMs = Date.now()
  const apiKey = process.env['SEEDANCE_API_KEY']
  if (!apiKey) throw new Error('SEEDANCE_API_KEY 未配置')

  const baseUrl = process.env['VCE_BASE_URL'] ?? 'https://api.vectorengine.ai'

  // 提交生成任务
  const taskId = await submitTask(baseUrl, apiKey, input)

  // 轮询等待完成
  const result = await pollTask(baseUrl, apiKey, taskId)

  const costYuan = input.model === 'seedance-2.0' ? 0.8 : 0.3

  const video: VideoAssetRef = {
    assetId: `gen_${Date.now()}`,
    storageKey: result.videoUrl,
    url: result.videoUrl,
    sha256: createHash('sha256').update(result.videoUrl).digest('hex'),
    mimeType: 'video/mp4',
    durationSec: input.durationSec,
    width: 720,
    height: 1280,
    fps: 24,
    hasAudio: false,
  }

  const meta: ToolResponseMeta = {
    status: 'success',
    errorCode: 'NONE',
    retryable: false,
    confidence: 0.85,
    costYuan,
    humanReviewRequired: false,
    sideEffects: [
      `模型: ${input.model}`,
      `耗时 ${((Date.now() - startMs) / 1000).toFixed(1)}s`,
    ],
  }

  return {
    video,
    modelUsed: input.model,
    estimatedCostYuan: costYuan,
    qualityHints: result.qualityHints,
    meta,
  }
}

/** 提交生成任务 */
async function submitTask(
  baseUrl: string,
  apiKey: string,
  input: VideoGeneratorInput,
): Promise<string> {
  const endpoint = resolveEndpoint(baseUrl, input.model)

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      image_url: input.firstFrame.url ?? input.firstFrame.storageKey,
      prompt: input.motionPrompt,
      duration: input.durationSec,
      seed: input.seed,
    }),
  })

  if (!resp.ok) {
    throw Object.assign(
      new Error(`生成任务提交失败: ${resp.status}`),
      { meta: { errorCode: 'API_DOWN', retryable: true } },
    )
  }

  const data = (await resp.json()) as { data?: { task_id?: string } }
  const taskId = data.data?.task_id
  if (!taskId) throw new Error('生成任务返回无 task_id')

  return taskId
}

/** 轮询任务状态 */
async function pollTask(
  baseUrl: string,
  apiKey: string,
  taskId: string,
): Promise<{ videoUrl: string; qualityHints: string[] }> {
  const deadline = Date.now() + POLL_TIMEOUT

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL)

    const resp = await fetch(`${baseUrl}/kling/v1/videos/omni-video/${taskId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    })

    if (!resp.ok) continue

    const data = (await resp.json()) as {
      data?: {
        task_status?: string
        task_result?: { videos?: Array<{ url?: string }> }
        task_status_msg?: string
      }
    }

    const status = data.data?.task_status
    if (status === 'succeed') {
      const videoUrl = data.data?.task_result?.videos?.[0]?.url
      if (!videoUrl) throw new Error('生成完成但无视频 URL')
      return { videoUrl, qualityHints: [] }
    }

    if (status === 'failed') {
      throw Object.assign(
        new Error(`生成失败: ${data.data?.task_status_msg ?? 'unknown'}`),
        { meta: { errorCode: 'API_DOWN', retryable: true } },
      )
    }
  }

  throw Object.assign(
    new Error(`生成超时 (${POLL_TIMEOUT / 1000}s)`),
    { meta: { errorCode: 'TIMEOUT', retryable: true } },
  )
}

/** 根据模型选择 endpoint */
function resolveEndpoint(baseUrl: string, model: VideoModel): string {
  // Seedance 和 Kling 都走 VCE 代理
  return `${baseUrl}/kling/v1/videos/omni-video`
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
