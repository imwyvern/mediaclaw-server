import { Injectable, Logger } from '@nestjs/common'

export interface AiJudgeResult {
  level: 1 | 2 | 3 | 4 | 5
  score: number
  reason: string
}

interface ChatCompletionResponse {
  choices: Array<{
    message: {
      content: string
    }
  }>
}

const JUDGE_SYSTEM_PROMPT = `你是一个视频内容查重专家。你需要对比两张视频封面/帧图片，判断它们是否属于重复或高度相似的内容。

评分标准（0-100分）：
- 0-20分（等级1 - 不同）：完全不同的内容，不同的主题、场景、人物
- 21-40分（等级2 - 相似）：有一些相似元素，但主题或内容不同
- 41-60分（等级3 - 需关注）：主题相似，可能是同类内容但不同视频
- 61-80分（等级4 - 高度相似）：非常相似的内容，可能是同一视频的不同版本或翻拍
- 81-100分（等级5 - 重复）：基本确定是相同或几乎完全相同的内容

请严格按以下 JSON 格式输出，不要包含其他内容：
{"score": <0-100>, "level": <1-5>, "reason": "<简要说明判断依据>"}`

@Injectable()
export class AiJudgeService {
  private readonly logger = new Logger(AiJudgeService.name)
  private readonly defaultModel = 'doubao-2.0-pro'
  private readonly defaultBaseUrl = 'https://ark.cn-beijing.volces.com/api/v3'
  private readonly requestTimeoutMs = 30000

  async judge(sourceImageUrl: string, candidateImageUrl: string): Promise<AiJudgeResult | null> {
    const apiKey = this.getApiKey()
    if (!apiKey) {
      this.logger.warn('AI Judge API key not configured, skipping multimodal comparison')
      return null
    }

    const model = process.env['DOUBAO_PRO_MODEL'] || this.defaultModel
    const baseUrl = (process.env['DOUBAO_PRO_BASE_URL'] || this.defaultBaseUrl).replace(/\/+$/, '')

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs)

      try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: JUDGE_SYSTEM_PROMPT },
              {
                role: 'user',
                content: [
                  { type: 'text', text: '请对比以下两张图片的相似度：' },
                  { type: 'image_url', image_url: { url: sourceImageUrl } },
                  { type: 'image_url', image_url: { url: candidateImageUrl } },
                ],
              },
            ],
            temperature: 0.1,
            max_tokens: 256,
          }),
          signal: controller.signal,
        })

        const rawText = await response.text()
        if (!response.ok) {
          this.logger.error(`AI Judge API error ${response.status}: ${rawText.slice(0, 200)}`)
          return null
        }

        const data = JSON.parse(rawText) as ChatCompletionResponse
        const content = data.choices?.[0]?.message?.content
        if (!content) {
          this.logger.error('AI Judge returned empty response')
          return null
        }

        return this.parseJudgeResponse(content)
      }
      finally {
        clearTimeout(timeout)
      }
    }
    catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        this.logger.error(`AI Judge request timed out after ${this.requestTimeoutMs}ms`)
      }
      else {
        this.logger.error(`AI Judge request failed: ${(error as Error).message}`)
      }

      return null
    }
  }

  private parseJudgeResponse(content: string): AiJudgeResult {
    try {
      const jsonMatch = content.match(/\{[^}]+\}/)
      if (!jsonMatch) {
        this.logger.warn(`AI Judge response has no JSON: ${content.slice(0, 100)}`)
        return { level: 1, score: 0, reason: content.slice(0, 200) }
      }

      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
      const score = Math.min(100, Math.max(0, Number(parsed['score']) || 0))
      const level = this.scoreToLevel(score)

      return {
        level,
        score,
        reason: String(parsed['reason'] || ''),
      }
    }
    catch {
      this.logger.warn(`Failed to parse AI Judge response: ${content.slice(0, 100)}`)
      return { level: 1, score: 0, reason: content.slice(0, 200) }
    }
  }

  private scoreToLevel(score: number): 1 | 2 | 3 | 4 | 5 {
    if (score >= 81)
      return 5
    if (score >= 61)
      return 4
    if (score >= 41)
      return 3
    if (score >= 21)
      return 2
    return 1
  }

  private getApiKey(): string {
    return (
      process.env['DOUBAO_PRO_API_KEY']
      || process.env['VOLCENGINE_API_KEY']
      || ''
    ).trim()
  }
}
