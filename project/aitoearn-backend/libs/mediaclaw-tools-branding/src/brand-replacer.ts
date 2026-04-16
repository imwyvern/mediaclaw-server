import { createHash } from 'node:crypto'

import type {
  BrandReplacerInput,
  BrandReplacerOutput,
  ImageAssetRef,
  ToolResponseMeta,
  RouteProvider,
} from '@yikart/mediaclaw-shared-kernel'

/** 运行时读取环境变量（避免模块顶层缓存导致测试 env 失效） */
function getVceBaseUrl(): string {
  return process.env['VCE_BASE_URL'] ?? 'https://api.vectorengine.cn'
}
function getAkcBaseUrl(): string {
  return process.env['APIKEYCLAW_BASE_URL'] ?? ''
}

/**
 * 品牌替换 Tool
 *
 * 调用 VCE inpainting API 把视频帧里的旧品牌区域替换为新品牌素材。
 * 优先走 VCE 直连，失败回退 APIKeyClaw 代理。
 */
export async function brandReplacer(
  input: BrandReplacerInput,
): Promise<BrandReplacerOutput> {
  const startMs = Date.now()

  // 确定路由顺序
  const routes: RouteProvider[] = input.routePolicy ?? ['vce', 'apikeyclaw']
  let lastError: Error | undefined

  for (const route of routes) {
    try {
      const result = await callInpaintingApi(input, route)
      return {
        replacedFrame: result.frame,
        routeUsed: route,
        artifactHints: result.artifactHints,
        meta: buildMeta('success', 'NONE', result.artifactHints.length > 0, 0.3, startMs),
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

/** 调用 inpainting API */
async function callInpaintingApi(
  input: BrandReplacerInput,
  route: RouteProvider,
): Promise<{ frame: ImageAssetRef; artifactHints: string[] }> {
  const baseUrl = route === 'apikeyclaw' ? getAkcBaseUrl() : getVceBaseUrl()
  const apiKey = route === 'apikeyclaw'
    ? process.env['APIKEYCLAW_TOKEN']
    : process.env['VCE_API_KEY']

  if (!apiKey) throw new Error(`${route} API key 未配置`)
  if (!baseUrl) throw new Error(`${route} base URL 未配置`)

  // 构建 inpainting prompt
  const prompt = buildInpaintingPrompt(input)

  const resp = await fetch(`${baseUrl}/v1/images/edits`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gemini-2.0-flash-exp',
      image_url: input.sourceFrame.url ?? input.sourceFrame.storageKey,
      prompt,
      brand_region: input.brandRegionHint,
      preserve_rules: input.preserveRules ?? [],
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

  // 构建 ImageAssetRef
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

  return { frame, artifactHints }
}

/** 构建 inpainting prompt */
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

/** 构建 ToolResponseMeta */
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
