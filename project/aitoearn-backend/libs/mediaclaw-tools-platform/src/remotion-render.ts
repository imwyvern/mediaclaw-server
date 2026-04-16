import { createHash } from 'node:crypto'

import type {
  RemotionRenderInput,
  RemotionRenderOutput,
  VideoAssetRef,
  ToolResponseMeta,
} from '@yikart/mediaclaw-shared-kernel'

/**
 * Remotion 渲染 Tool — 调用 Remotion Lambda/API 渲染模板视频
 */
export async function remotionRender(
  input: RemotionRenderInput,
): Promise<RemotionRenderOutput> {
  const startMs = Date.now()
  const apiKey = process.env['REMOTION_API_KEY']
  if (!apiKey) throw new Error('REMOTION_API_KEY 未配置')

  const baseUrl = process.env['REMOTION_BASE_URL'] ?? 'https://api.remotion.dev'

  // 提交渲染任务
  const renderResp = await fetch(`${baseUrl}/v1/render`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      composition: input.templateId,
      inputProps: {
        product: input.product,
        durationSec: input.durationSec,
        brandTheme: input.brandTheme,
      },
      codec: 'h264',
      imageFormat: 'jpeg',
    }),
  })

  if (!renderResp.ok) {
    throw Object.assign(new Error(`Remotion API ${renderResp.status}`), {
      meta: { errorCode: 'API_DOWN', retryable: true } as Partial<ToolResponseMeta>,
    })
  }

  const renderData = (await renderResp.json()) as { renderId?: string }
  const renderId = renderData.renderId
  if (!renderId) throw new Error('Remotion 返回无 renderId')

  // 轮询等待完成
  const videoUrl = await pollRender(baseUrl, apiKey, renderId)

  const sha256 = createHash('sha256').update(videoUrl).digest('hex')

  const video: VideoAssetRef = {
    assetId: `remotion_${Date.now()}`,
    storageKey: videoUrl,
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
    costYuan: 0.5,
    humanReviewRequired: false,
    sideEffects: [`耗时 ${((Date.now() - startMs) / 1000).toFixed(1)}s`],
  }

  return { video, renderJobId: renderId, meta }
}

async function pollRender(baseUrl: string, apiKey: string, renderId: string): Promise<string> {
  const deadline = Date.now() + 180_000 // 3 min timeout

  while (Date.now() < deadline) {
    await sleep(5000)

    const resp = await fetch(`${baseUrl}/v1/render/${renderId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    })

    if (!resp.ok) continue

    const data = (await resp.json()) as { status?: string; outputUrl?: string }

    if (data.status === 'done' && data.outputUrl) {
      return data.outputUrl
    }

    if (data.status === 'error') {
      throw new Error('Remotion 渲染失败')
    }
  }

  throw new Error('Remotion 渲染超时')
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
