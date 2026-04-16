import type {
  ContentPlannerInput,
  ContentPlannerOutput,
  WeeklyPlanItem,
} from '@yikart/mediaclaw-shared-kernel'

/**
 * 内容策划 Tool — LLM 生成周计划
 */
export async function contentPlanner(
  input: ContentPlannerInput,
): Promise<ContentPlannerOutput> {
  const apiKey = process.env['GEMINI_API_KEY'] ?? process.env['OPENAI_API_KEY']
  if (!apiKey) throw new Error('GEMINI_API_KEY 或 OPENAI_API_KEY 未配置')

  const prompt = buildPlannerPrompt(input)
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
  const parsed = JSON.parse(text) as { weeklyPlan?: WeeklyPlanItem[]; summary?: string }

  return {
    weeklyPlan: parsed.weeklyPlan ?? [],
    monthlyCalendarSummary: parsed.summary,
  }
}

function buildPlannerPrompt(input: ContentPlannerInput): string {
  const brand = input.brand.brandName
  const products = input.products.map((p) => p.name).join('、')
  const budget = input.budgetRemaining
  const perf = input.recentPerformance.map((p) => `${p.contentType}: ${p.avgViews} views, ${(p.avgEngagementRate * 100).toFixed(1)}% engagement`).join('; ')

  return `你是短视频内容策划专家。为品牌"${brand}"制定下周内容计划。
产品：${products}
剩余额度：${budget} 条
近 30 天效果：${perf}
${input.competitorReport ? `竞品洞察：${input.competitorReport.opportunity}` : ''}

返回 JSON 格式：
{
  "weeklyPlan": [
    { "day": "周一", "contentType": "种草", "platform": "douyin", "reason": "..." },
    ...
  ],
  "summary": "月度策略摘要"
}
每天 1-2 条，总数不超过 ${budget} 条。platform 只能是 douyin/xhs/kuaishou/bilibili。`
}

function extractText(data: Record<string, unknown>): string {
  const candidates = (data as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }).candidates
  if (candidates?.[0]?.content?.parts?.[0]?.text) return candidates[0].content.parts[0].text
  const choices = (data as { choices?: Array<{ message?: { content?: string } }> }).choices
  if (choices?.[0]?.message?.content) return choices[0].message.content
  return '{}'
}
