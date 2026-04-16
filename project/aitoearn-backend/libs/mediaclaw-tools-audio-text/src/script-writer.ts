import type {
  ScriptWriterInput,
  ScriptWriterOutput,
  ScriptLine,
  ToolResponseMeta,
} from '@yikart/mediaclaw-shared-kernel'

/**
 * 文案生成 Tool
 */
export async function scriptWriter(
  input: ScriptWriterInput,
): Promise<ScriptWriterOutput> {
  const startMs = Date.now()
  const maxChars = input.maxCharsPerLine ?? 15
  const apiKey = process.env['GEMINI_API_KEY'] ?? process.env['OPENAI_API_KEY']
  if (!apiKey) throw new Error('GEMINI_API_KEY 或 OPENAI_API_KEY 未配置')

  const prompt = buildPrompt(input, maxChars)
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
        ? { contents: [{ parts: [{ text: prompt }] }] }
        : { model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }] },
    ),
  })

  if (!resp.ok) {
    throw Object.assign(new Error(`LLM API ${resp.status}`), {
      meta: { errorCode: 'API_DOWN', retryable: true },
    })
  }

  const data = await resp.json() as Record<string, unknown>
  const rawText = extractText(data)
  const lines = parseLines(rawText, maxChars)

  const meta: ToolResponseMeta = {
    status: 'success',
    errorCode: 'NONE',
    retryable: false,
    confidence: 0.85,
    costYuan: 0.01,
    humanReviewRequired: false,
    sideEffects: [`生成 ${lines.length} 句文案`, `耗时 ${((Date.now() - startMs) / 1000).toFixed(1)}s`],
  }

  return { lines, fullScript: lines.map((l) => l.text).join('\n'), meta }
}

function buildPrompt(input: ScriptWriterInput, maxChars: number): string {
  const brand = input.brand?.brandName ?? '品牌'
  const product = input.product?.name ?? '产品'
  const features = input.product?.features?.slice(0, 3).join('、') ?? ''
  const style = input.style === 'seed' ? '种草' : input.style === 'review' ? '测评' : '故事'
  return `你是短视频文案专家。为"${brand}"的"${product}"写${style}风格的中文短句文案。\n产品卖点：${features}\n要求：每句不超过${maxChars}个中文字，生成5-8句，每句一行，不要编号，语气自然口语化`
}

function extractText(data: Record<string, unknown>): string {
  const candidates = (data as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }).candidates
  if (candidates?.[0]?.content?.parts?.[0]?.text) return candidates[0].content.parts[0].text
  const choices = (data as { choices?: Array<{ message?: { content?: string } }> }).choices
  if (choices?.[0]?.message?.content) return choices[0].message.content
  return ''
}

function parseLines(text: string, maxChars: number): ScriptLine[] {
  return text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0 && l.length <= maxChars * 2)
    .slice(0, 10).map((text, i) => ({
      lineId: `line_${i}`, text: text.slice(0, maxChars), durationSec: Math.max(1.5, text.length * 0.3),
    }))
}
