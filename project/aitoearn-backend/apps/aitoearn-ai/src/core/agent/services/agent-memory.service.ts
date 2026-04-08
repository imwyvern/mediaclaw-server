import { Injectable } from '@nestjs/common'
import {
  AgentMemoryPolicy,
  AgentMemorySummary,
} from '../agent-orchestration.types'

const PLATFORM_PATTERNS: Array<{ name: string, keywords: string[] }> = [
  { name: 'XHS', keywords: ['小红书', 'xiaohongshu', 'rednote', 'xhs'] },
  { name: 'DOUYIN', keywords: ['抖音', 'douyin'] },
  { name: 'TIKTOK', keywords: ['tiktok'] },
  { name: 'BILIBILI', keywords: ['bilibili', '哔哩哔哩', 'b站'] },
  { name: 'YOUTUBE', keywords: ['youtube', '油管'] },
  { name: 'INSTAGRAM', keywords: ['instagram', 'ins'] },
  { name: 'FACEBOOK', keywords: ['facebook'] },
  { name: 'THREADS', keywords: ['threads'] },
  { name: 'TWITTER', keywords: ['twitter', 'x.com'] },
  { name: 'PINTEREST', keywords: ['pinterest'] },
  { name: 'KWAI', keywords: ['kwai', '快手'] },
  { name: 'WXGZH', keywords: ['微信公众号', '微信', 'wxgzh'] },
]

@Injectable()
export class AgentMemoryService {
  public summarize(params: {
    prompt: unknown
    memoryPolicy: AgentMemoryPolicy
    historicalMessages?: Array<Record<string, unknown>>
  }): AgentMemorySummary {
    const { prompt, memoryPolicy, historicalMessages = [] } = params
    const promptText = this.toPlainText(prompt)
    const scopedMessages = memoryPolicy === 'stateless' ? [] : historicalMessages
    const historicalTexts = scopedMessages
      .map(message => this.extractHistoricalEntry(message))
      .filter((entry): entry is { role: string, text: string } => Boolean(entry?.text))

    const combinedText = [promptText, ...historicalTexts.map(entry => entry.text)].join('\n')

    return {
      policy: memoryPolicy,
      latestUserIntent: promptText || this.getLatestUserIntent(historicalTexts),
      preferredPlatforms: this.detectPlatforms(combinedText),
      brandKeywords: this.detectBrandKeywords(combinedText),
      pendingActions: this.detectPendingActions(promptText || combinedText),
      recentContext: historicalTexts.slice(-4).map(entry => `${entry.role}: ${this.truncate(entry.text, 120)}`),
    }
  }

  public toPlainText(input: unknown): string {
    if (typeof input === 'string') {
      return input.trim()
    }

    if (Array.isArray(input)) {
      return input
        .map(item => this.toPlainText(item))
        .filter(Boolean)
        .join('\n')
        .trim()
    }

    if (!input || typeof input !== 'object') {
      return ''
    }

    const value = input as Record<string, unknown>

    if (typeof value['text'] === 'string') {
      return value['text'].trim()
    }

    if (typeof value['content'] === 'string') {
      return value['content'].trim()
    }

    if (value['content']) {
      return this.toPlainText(value['content'])
    }

    if (value['source']) {
      return this.toPlainText(value['source'])
    }

    if (value['message']) {
      return this.toPlainText(value['message'])
    }

    if (value['result']) {
      return this.toPlainText(value['result'])
    }

    if (typeof value['description'] === 'string') {
      return value['description'].trim()
    }

    if (Array.isArray(value['tags'])) {
      return value['tags'].map(tag => this.toPlainText(tag)).filter(Boolean).join(' ')
    }

    return ''
  }

  private extractHistoricalEntry(message: Record<string, unknown>): { role: string, text: string } | undefined {
    const type = typeof message['type'] === 'string' ? message['type'] : 'system'
    const rawText = this.toPlainText(message['message'] ?? message['content'] ?? message['result'] ?? message)
    const text = rawText.trim()

    if (!text) {
      return undefined
    }

    const role = type === 'user'
      ? 'user'
      : type === 'assistant'
        ? 'assistant'
        : type === 'result'
          ? 'result'
          : 'system'

    return { role, text }
  }

  private getLatestUserIntent(historicalEntries: Array<{ role: string, text: string }>): string {
    const latestUserEntry = [...historicalEntries].reverse().find(entry => entry.role === 'user')
    return latestUserEntry?.text ?? ''
  }

  private detectPlatforms(text: string): string[] {
    const normalizedText = text.toLowerCase()
    return PLATFORM_PATTERNS
      .filter(platform => platform.keywords.some(keyword => normalizedText.includes(keyword)))
      .map(platform => platform.name)
  }

  private detectBrandKeywords(text: string): string[] {
    const matches = new Set<string>()
    const brandPattern = /(品牌名?|brand)\s*[:：]\s*([\w\u4E00-\u9FA5-]{2,30})/gi
    const hashtagPattern = /#([\w\u4E00-\u9FA5-]{2,30})/g

    for (const match of text.matchAll(brandPattern)) {
      if (match[2]) {
        matches.add(match[2])
      }
    }

    for (const match of text.matchAll(hashtagPattern)) {
      if (match[1]) {
        matches.add(match[1])
      }
    }

    return Array.from(matches).slice(0, 5)
  }

  private detectPendingActions(text: string): string[] {
    const normalizedText = text.toLowerCase()
    const actions = new Set<string>()

    if (this.includesAny(normalizedText, ['策划', 'plan', 'strategy', '选题', '竞品', '脚本'])) {
      actions.add('内容策划')
    }
    if (this.includesAny(normalizedText, ['生成', 'produce', 'create', 'video', 'image', '文案', '素材', '改写', '适配'])) {
      actions.add('内容生产')
    }
    if (this.includesAny(normalizedText, ['发布', 'publish', 'distribution', 'deliver', '分发', '交付', '推送'])) {
      actions.add('发布交付')
    }
    if (this.includesAny(normalizedText, ['分析', 'analytics', 'analysis', 'report', 'trend', 'data', '复盘', '效果'])) {
      actions.add('效果分析')
    }

    if (actions.size === 0 && text.trim()) {
      actions.add('继续当前任务')
    }

    return Array.from(actions)
  }

  private truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text
    }

    return `${text.slice(0, maxLength - 3)}...`
  }

  private includesAny(text: string, keywords: string[]): boolean {
    return keywords.some(keyword => text.includes(keyword))
  }
}
