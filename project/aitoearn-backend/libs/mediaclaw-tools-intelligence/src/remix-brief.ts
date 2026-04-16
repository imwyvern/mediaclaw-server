import type {
  RemixBriefInput,
  RemixBriefOutput,
  RemixBrief,
  SceneCut,
  ScriptLine,
} from '@yikart/mediaclaw-shared-kernel'

/**
 * 复刻拆解 Tool — 分析参考视频生成 RemixBrief
 */
export async function remixBrief(
  input: RemixBriefInput,
): Promise<RemixBriefOutput> {
  const apiKey = process.env['GEMINI_API_KEY'] ?? process.env['OPENAI_API_KEY']
  if (!apiKey) throw new Error('GEMINI_API_KEY 或 OPENAI_API_KEY 未配置')

  const prompt = buildRemixPrompt(input)
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
  const parsed = JSON.parse(text) as Partial<RemixBrief>

  const cuts: Array<SceneCut & { motionType?: string; motionPrompt?: string }> = (parsed.cuts ?? []).map((c, i) => ({
    cutId: c.cutId ?? `cut_${i}`,
    startSec: c.startSec ?? i * 5,
    endSec: c.endSec ?? (i + 1) * 5,
    firstFrame: c.firstFrame ?? { assetId: `f_${i}`, storageKey: '', sha256: '', mimeType: 'image/jpeg', width: 1080, height: 1920 },
    motionType: (c as { motionType?: string }).motionType,
    motionPrompt: (c as { motionPrompt?: string }).motionPrompt,
  }))

  const script: ScriptLine[] = (parsed.script ?? []).map((s, i) => ({
    lineId: s.lineId ?? `line_${i}`,
    text: s.text ?? '',
    durationSec: s.durationSec ?? 2,
  }))

  const totalDuration = cuts.reduce((sum, c) => sum + (c.endSec - c.startSec), 0)

  const brief: RemixBrief = {
    totalDurationSec: totalDuration,
    cuts,
    script,
    modelAllocation: cuts.map((c) => ({
      cutId: c.cutId,
      model: 'seedance-1.5' as const,
      reason: 'default allocation',
    })),
    estimatedCostYuan: cuts.length * 0.3 + script.length * 0.02,
    estimatedTimeMin: Math.ceil(cuts.length * 2),
  }

  return { brief }
}

function buildRemixPrompt(input: RemixBriefInput): string {
  return `分析这个参考视频并生成复刻方案。
参考视频: ${input.referenceUrl}
目标品牌: ${input.targetBrand.brandName}
目标产品: ${input.targetProduct.name}

返回 JSON:
{
  "cuts": [{ "cutId": "cut_0", "startSec": 0, "endSec": 5, "motionType": "PAN", "motionPrompt": "slow pan right" }],
  "script": [{ "lineId": "line_0", "text": "文案内容", "durationSec": 2 }]
}
生成 4-8 个镜头，每个 3-5 秒。文案 5-8 句。`
}

function extractText(data: Record<string, unknown>): string {
  const candidates = (data as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }).candidates
  if (candidates?.[0]?.content?.parts?.[0]?.text) return candidates[0].content.parts[0].text
  const choices = (data as { choices?: Array<{ message?: { content?: string } }> }).choices
  if (choices?.[0]?.message?.content) return choices[0].message.content
  return '{}'
}
