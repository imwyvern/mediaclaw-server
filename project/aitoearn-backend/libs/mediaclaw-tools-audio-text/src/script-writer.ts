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
  const prompt = buildPrompt(input, maxChars)

  // 优先级：DeepSeek > Gemini > OpenAI（参考 copy-engine.service.ts）
  const rawText = await callLlm(prompt)
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

/** 多 provider LLM 调用（参考 copy-engine.service.ts） */
async function callLlm(prompt: string): Promise<string> {
  // 1. DeepSeek（默认，成本最低）
  const deepseekKey = process.env['MEDIACLAW_DEEPSEEK_API_KEY'] ?? process.env['DEEPSEEK_API_KEY']
  if (deepseekKey) {
    const baseUrl = (process.env['MEDIACLAW_DEEPSEEK_BASE_URL'] ?? 'https://api.deepseek.com').replace(/\/+$/, '')
    const model = process.env['MEDIACLAW_DEEPSEEK_MODEL'] ?? process.env['DEEPSEEK_MODEL'] ?? 'deepseek-chat'
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${deepseekKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: 'Return plain text only.' }, { role: 'user', content: prompt }],
        temperature: 0.8,
      }),
    })
    if (resp.ok) {
      const data = await resp.json() as Record<string, unknown>
      const text = extractText(data)
      if (text) return text
    }
  }

  // 2. Gemini
  const geminiKey = process.env['MEDIACLAW_GEMINI_API_KEY'] ?? process.env['GEMINI_API_KEY']
  if (geminiKey) {
    const baseUrl = (process.env['MEDIACLAW_GEMINI_BASE_URL'] ?? 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '')
    const model = process.env['MEDIACLAW_GEMINI_MODEL'] ?? process.env['GEMINI_MODEL'] ?? 'gemini-2.5-flash'
    const resp = await fetch(`${baseUrl}/models/${model}:generateContent?key=${geminiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.8 },
      }),
    })
    if (resp.ok) {
      const data = await resp.json() as Record<string, unknown>
      const text = extractText(data)
      if (text) return text
    }
  }

  // 3. OpenAI
  const openaiKey = process.env['MEDIACLAW_OPENAI_API_KEY'] ?? process.env['OPENAI_API_KEY']
  if (openaiKey) {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env['MEDIACLAW_OPENAI_MODEL'] ?? 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.8,
      }),
    })
    if (resp.ok) {
      const data = await resp.json() as Record<string, unknown>
      const text = extractText(data)
      if (text) return text
    }
  }

  throw Object.assign(new Error('无可用 LLM API Key（需配置 DEEPSEEK_API_KEY / GEMINI_API_KEY / OPENAI_API_KEY）'), {
    meta: { errorCode: 'API_DOWN', retryable: false },
  })
}

function parseLines(text: string, maxChars: number): ScriptLine[] {
  return text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0 && l.length <= maxChars * 2)
    .slice(0, 10).map((text, i) => ({
      lineId: `line_${i}`, text: text.slice(0, maxChars), durationSec: Math.max(1.5, text.length * 0.3),
    }))
}
