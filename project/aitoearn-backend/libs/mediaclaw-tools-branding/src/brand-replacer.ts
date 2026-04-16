import { createHash } from 'node:crypto'

import type {
  BrandReplacerInput,
  BrandReplacerOutput,
  ImageAssetRef,
  ToolResponseMeta,
  RouteProvider,
} from '@yikart/mediaclaw-shared-kernel'

/**
 * 品牌替换 Tool
 *
 * 调用 VCE Gemini Image Edit API（参考 brand-edit.service.ts）
 * 支持 VCE → APIKeyClaw 路由回退。
 */
export async function brandReplacer(
  input: BrandReplacerInput,
): Promise<BrandReplacerOutput> {
  const startMs = Date.now()

  const apiKey = process.env['VCE_API_KEY'] ?? process.env['MEDIACLAW_VCE_API_KEY']
  const akcKey = process.env['APIKEYCLAW_TOKEN']
  if (!apiKey && !akcKey) throw new Error('VCE_API_KEY 或 APIKEYCLAW_TOKEN 未配置')

  const routes: RouteProvider[] = input.routePolicy ?? ['vce', 'apikeyclaw']
  const prompt = buildInpaintingPrompt(input)

  let lastError: Error | undefined

  for (const route of routes) {
    const routeApiKey = route === 'apikeyclaw' ? akcKey : apiKey
    if (!routeApiKey) continue

    const routeBaseUrl = route === 'apikeyclaw'
      ? (process.env['APIKEYCLAW_BASE_URL'] ?? '').replace(/\/+$/, '')
      : (process.env['VCE_GEMINI_BASE_URL'] ?? process.env['MEDIACLAW_VCE_BASE_URL'] ?? 'https://api.vectorengine.cn').replace(/\/+$/, '')
    if (!routeBaseUrl) continue

    const editPath = process.env['VCE_GEMINI_EDIT_PATH'] ?? '/v1/images/edits'
    const model = process.env['VCE_GEMINI_IMAGE_MODEL'] ?? 'gemini-2.5-flash-image'

    try {
      const resp = await fetch(`${routeBaseUrl}${editPath}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${routeApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          prompt,
          image_url: input.sourceFrame.url ?? input.sourceFrame.storageKey,
          response_format: 'url',
        }),
      })

      if (!resp.ok) {
        throw new Error(`${route} API ${resp.status}: ${resp.statusText}`)
      }

      const data = (await resp.json()) as {
        data?: { url?: string; artifacts?: string[] }
      }

      const outputUrl = data.data?.url
      if (!outputUrl) throw new Error(`${route} 返回无图片 URL`)

      const artifactHints = data.data?.artifacts ?? []
      const sha256 = createHash('sha256').update(outputUrl).digest('hex')
      const frame: ImageAssetRef = {
        assetId: `brand_${Date.now()}`,
        storageKey: outputUrl,
        url: outputUrl,
        sha256,
        mimeType: 'image/png',
        width: input.sourceFrame.width,
        height: input.sourceFrame.height,
      }

      return {
        replacedFrame: frame,
        routeUsed: route,
        artifactHints,
        meta: buildMeta('success', 'NONE', artifactHints.length > 0, 0.3, startMs),
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
    }
  }

  throw Object.assign(
    new Error(`品牌替换失败: ${lastError?.message ?? 'unknown'}`),
    { meta: buildMeta('failed', 'API_DOWN', false, 0, startMs) },
  )
}

function buildInpaintingPrompt(input: BrandReplacerInput): string {
  const brand = input.targetBrand
  const product = input.targetProduct
  const features = product.features.slice(0, 3).join('、')

  return `Replace the brand logo and text in the image with "${brand.brandName}" brand. ` +
    `Product: ${product.name}. Key features: ${features}. ` +
    `Keep the composition, lighting, and background unchanged. ` +
    (brand.slogan ? `Brand slogan: "${brand.slogan}". ` : '') +
    `Output high quality, photorealistic result.`
}

function buildMeta(
  status: 'success' | 'failed' | 'partial',
  errorCode: string,
  humanReviewRequired: boolean,
  costYuan: number,
  startMs: number,
): ToolResponseMeta {
  return {
    status,
    errorCode: errorCode as ToolResponseMeta['errorCode'],
    retryable: errorCode === 'API_DOWN' || errorCode === 'RATE_LIMIT',
    confidence: status === 'success' ? 0.85 : 0,
    costYuan,
    humanReviewRequired,
    sideEffects: [`耗时 ${((Date.now() - startMs) / 1000).toFixed(1)}s`],
  }
}
