import type {
  PlatformPackagerInput,
  PlatformPackagerOutput,
  ImageAssetRef,
  ComplianceCheck,
} from '@yikart/mediaclaw-shared-kernel'

/**
 * 平台包装 Tool — 生成标题/封面/话题/正文 + 合规检查
 */
export async function platformPackager(
  input: PlatformPackagerInput,
): Promise<PlatformPackagerOutput> {
  const apiKey = process.env['GEMINI_API_KEY'] ?? process.env['OPENAI_API_KEY']
  if (!apiKey) throw new Error('GEMINI_API_KEY 或 OPENAI_API_KEY 未配置')

  const prompt = buildPackagerPrompt(input)
  const baseUrl = process.env['GEMINI_API_KEY']
    ? 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent'
    : 'https://api.openai.com/v1/chat/completions'

  const resp = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env['GEMINI_API_KEY']
        ? { 'x-goog-api-key': apiKey }
        : { 'Authorization': `Bearer ${apiKey}` }),
    },
    body: JSON.stringify(
      process.env['GEMINI_API_KEY']
        ? { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json' } }
        : { model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], response_format: { type: 'json_object' } },
    ),
  })

  if (!resp.ok) throw Object.assign(new Error(`LLM API ${resp.status}`), { meta: { errorCode: 'API_DOWN', retryable: true } })

  const data = await resp.json() as Record<string, unknown>
  const text = extractText(data)
  const parsed = JSON.parse(text) as { title?: string; description?: string; hashtags?: string[] }

  // 生成封面（简化：用固定占位符）
  const coverImage: ImageAssetRef = {
    assetId: `cover_${Date.now()}`,
    storageKey: '/tmp/cover.jpg',
    sha256: 'cover_hash',
    mimeType: 'image/jpeg',
    width: 1080,
    height: 1440,
  }

  // 合规检查
  const complianceCheck: ComplianceCheck = await checkCompliance(parsed.title ?? '', parsed.description ?? '', parsed.hashtags ?? [])

  return {
    title: parsed.title ?? '',
    coverImage,
    hashtags: parsed.hashtags ?? [],
    description: parsed.description ?? '',
    complianceCheck,
  }
}

function buildPackagerPrompt(input: PlatformPackagerInput): string {
  const platform = input.platform
  const brand = input.brand.brandName
  const product = input.product.name
  const features = input.product.features.slice(0, 3).join('、')

  return `为"${brand}"的"${product}"生成${platform}平台发布文案。
产品卖点：${features}

返回 JSON:
{
  "title": "标题（${platform === 'douyin' ? '20字内' : platform === 'xhs' ? '25字内' : '30字内'}）",
  "description": "正文（100-200字）",
  "hashtags": ["话题1", "话题2", "话题3"]
}
标题吸引眼球，正文突出卖点，话题热门相关。`
}

function extractText(data: Record<string, unknown>): string {
  const candidates = (data as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }).candidates
  if (candidates?.[0]?.content?.parts?.[0]?.text) return candidates[0].content.parts[0].text
  const choices = (data as { choices?: Array<{ message?: { content?: string } }> }).choices
  if (choices?.[0]?.message?.content) return choices[0].message.content
  return '{}'
}

async function checkCompliance(title: string, description: string, hashtags: string[]): Promise<ComplianceCheck> {
  const BANNED_WORDS = ['最好', '第一', '国家级', '顶级', '极品', '万能', '祖传', '秘方', '100%', '绝对', '永久', '无副作用', '包治', '根治']
  const SENSITIVE_WORDS = ['政治', '赌博', '色情', '暴力', '毒品']

  const text = [title, description, ...hashtags].join(' ')
  const violations: string[] = []
  const warnings: string[] = []

  for (const word of BANNED_WORDS) {
    if (text.includes(word)) violations.push(`违禁广告用语: "${word}"`)
  }
  for (const word of SENSITIVE_WORDS) {
    if (text.includes(word)) violations.push(`敏感内容: "${word}"`)
  }
  if (text.length > 500) warnings.push('文案超过 500 字，建议精简')

  return { passed: violations.length === 0, warnings, violations }
}
