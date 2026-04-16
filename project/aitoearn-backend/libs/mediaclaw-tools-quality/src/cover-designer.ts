import { createHash } from 'node:crypto'

import type {
  CoverDesignerInput,
  CoverDesignerOutput,
  ImageAssetRef,
  ToolResponseMeta,
} from '@yikart/mediaclaw-shared-kernel'

/**
 * 封面设计 Tool
 */
export async function coverDesigner(
  input: CoverDesignerInput,
): Promise<CoverDesignerOutput> {
  const startMs = Date.now()
  const apiKey = process.env['VCE_API_KEY'] ?? process.env['GEMINI_API_KEY']
  if (!apiKey) throw new Error('VCE_API_KEY 或 GEMINI_API_KEY 未配置')

  const baseUrl = process.env['VCE_BASE_URL'] ?? 'https://api.vectorengine.cn'
  const { width, height } = resolveAspect(input.platform)

  const prompt = buildCoverPrompt(input, width, height)

  const resp = await fetch(`${baseUrl}/v1/images/generations`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gemini-2.0-flash-exp', prompt, size: `${width}x${height}`, n: 1 }),
  })

  if (!resp.ok) {
    throw Object.assign(new Error(`封面生成失败: ${resp.status}`), {
      meta: { errorCode: 'API_DOWN', retryable: true } as Partial<ToolResponseMeta>,
    })
  }

  const data = (await resp.json()) as { data?: Array<{ url?: string }> }
  const coverUrl = data.data?.[0]?.url
  if (!coverUrl) throw new Error('封面生成返回无图片 URL')

  const sha256 = createHash('sha256').update(coverUrl).digest('hex')

  const coverImage: ImageAssetRef = {
    assetId: `cover_${Date.now()}`, storageKey: coverUrl, url: coverUrl,
    sha256, mimeType: 'image/png', width, height,
  }

  const meta: ToolResponseMeta = {
    status: 'success', errorCode: 'NONE', retryable: false, confidence: 0.85,
    costYuan: 0.05, humanReviewRequired: false,
    sideEffects: [`平台: ${input.platform}`, `尺寸: ${width}x${height}`, `耗时 ${((Date.now() - startMs) / 1000).toFixed(1)}s`],
  }

  return {
    coverImage,
    headlineSuggestion: input.headline ?? input.product.name,
    safeArea: { top: 80, right: 40, bottom: 120, left: 40 },
    meta,
  }
}

function resolveAspect(platform: string): { width: number; height: number } {
  switch (platform) {
    case 'xhs': return { width: 1080, height: 1440 }
    case 'douyin': case 'kuaishou': return { width: 720, height: 1280 }
    case 'bilibili': return { width: 1280, height: 720 }
    default: return { width: 720, height: 1280 }
  }
}

function buildCoverPrompt(input: CoverDesignerInput, width: number, height: number): string {
  const product = input.product.name
  const headline = input.headline ?? product
  const style = input.styleHint ?? 'modern, eye-catching'
  return `Design a ${width}x${height} cover image for "${product}". Title: "${headline}". Style: ${style}. High quality, clean design.`
}
