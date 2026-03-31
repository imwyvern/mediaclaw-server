import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { Brand, CopyHistory } from '@yikart/mongodb'
import { Model, Types } from 'mongoose'

export interface GeneratedCopy {
  title: string
  subtitle: string
  hashtags: string[]
  blueWords: string[]
  commentGuide: string
  commentGuides: string[]
}

interface CopyHistoryPayload extends GeneratedCopy {
  orgId?: string | null
  taskId?: string | null
}

interface HistoricalCopyExample {
  title: string
  subtitle: string
  hashtags: string[]
}

interface GeneratedCopyDraft {
  title?: unknown
  subtitle?: unknown
  hashtags?: unknown
  blueWords?: unknown
  commentGuide?: unknown
  commentGuides?: unknown
}

interface DeepSeekResponse {
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string
      }>
    }
  }>
}

@Injectable()
export class CopyEngineService {
  private readonly logger = new Logger(CopyEngineService.name)

  constructor(
    @InjectModel(Brand.name) private readonly brandModel: Model<Brand>,
    @InjectModel(CopyHistory.name) private readonly copyHistoryModel: Model<CopyHistory>,
  ) {}

  async generateCopy(
    brandId: string | null | undefined,
    videoUrl: string,
    metadata: Record<string, any> = {},
  ): Promise<GeneratedCopy> {
    const brand = brandId
      ? await this.brandModel.findById(brandId).exec()
      : null

    const brandName = brand?.name || 'MediaClaw'
    const toneKeywords = brand?.assets?.keywords || []
    const avoidKeywords = brand?.assets?.prohibitedWords || []
    const scene = this.readMetadataString(metadata, 'scene')
      || this.readMetadataString(metadata, 'campaign')
      || this.readMetadataString(metadata, 'platform')
      || '内容分发'
    const sourceHint = videoUrl ? `视频素材地址: ${videoUrl}` : '未提供视频素材地址'
    const dedup = brand?.orgId
      ? await this.checkDedupHistory(brand.orgId.toString(), {
          title: `${brandName}${scene}`,
          subtitle: scene,
        })
      : { isDuplicate: false, matchCount: 0, matches: [] }
    const historyExamples = brand?.orgId
      ? await this.getHistoricalExamples(brand.orgId.toString())
      : []

    const llmDraft = await this.generateWithProvider({
      brandName,
      toneKeywords,
      avoidKeywords,
      scene,
      sourceHint,
      historyExamples,
      dedupMatches: dedup.matches.map(match => ({
        title: match.title,
        subtitle: match.subtitle,
      })),
      metadata,
    })

    const generated = this.normalizeGeneratedCopy({
      draft: llmDraft,
      brandName,
      scene,
      toneKeywords,
      avoidKeywords,
      dedupDuplicate: dedup.isDuplicate,
    })

    await this.recordCopyHistory({
      orgId: brand?.orgId?.toString(),
      taskId: typeof metadata['taskId'] === 'string' ? metadata['taskId'] : null,
      ...generated,
    })

    return generated
  }

  generateBlueWords(title: string, keywords: string[] = []) {
    const normalizedTitle = title.trim()
    if (!normalizedTitle) {
      throw new BadRequestException('title is required')
    }

    const keywordBlueWords = keywords
      .map(keyword => keyword.trim())
      .filter(Boolean)
      .slice(0, 3)
      .map(keyword => this.toBlueWord(keyword))
    const existingBlueWords = normalizedTitle.match(/#[^\s#]+/g) || []
    const blueWords = [...new Set([...existingBlueWords, ...keywordBlueWords])].slice(0, 3)
    const missingBlueWords = blueWords.filter(word => !normalizedTitle.includes(word))

    return {
      title: missingBlueWords.length > 0
        ? `${normalizedTitle} ${missingBlueWords.join(' ')}`
        : normalizedTitle,
      blueWords,
    }
  }

  generateCommentGuide(brand: string, content: string) {
    return this.generateCommentGuides(brand, content)[0]
  }

  generateCommentGuides(brand: string, content: string) {
    const safeBrand = brand.trim() || 'MediaClaw'
    const safeContent = content.trim() || '这条内容'

    return [
      `${safeBrand}这条内容最适合哪类人群？留言“人群”我补完整拆解。`,
      `如果你也在做 ${safeContent}，评论区回“模板”我继续给你细化版本。`,
      `想看 ${safeBrand} 下一条更激进还是更稳的表达？留言“激进”或“稳”。`,
    ]
  }

  generateABVariants(baseTitle: string, count = 3) {
    const normalizedTitle = baseTitle.trim()
    if (!normalizedTitle) {
      throw new BadRequestException('baseTitle is required')
    }

    const normalizedCount = Math.min(Math.max(Math.trunc(Number(count) || 3), 1), 10)
    const candidates = [
      `${normalizedTitle}，看完就能直接复用`,
      `为什么说${normalizedTitle}更容易起量`,
      `${normalizedTitle}，评论区领拆解模板`,
      `${normalizedTitle}，3 步抄到可发布版本`,
      `${normalizedTitle}，品牌号也能这样写`,
    ]

    return [...new Set(candidates)].slice(0, normalizedCount)
  }

  async checkDedupHistory(orgId: string, content: string | { title?: string, subtitle?: string }) {
    if (!Types.ObjectId.isValid(orgId)) {
      return {
        isDuplicate: false,
        matchCount: 0,
        matches: [],
      }
    }

    const normalizedContent = typeof content === 'string'
      ? content.trim()
      : [content.title, content.subtitle].filter(Boolean).join(' ').trim()

    if (!normalizedContent) {
      return {
        isDuplicate: false,
        matchCount: 0,
        matches: [],
      }
    }

    const exactMatches = await this.copyHistoryModel.find({
      orgId: new Types.ObjectId(orgId),
      title: new RegExp(`^${this.escapeRegex(normalizedContent)}$`, 'i'),
    }).limit(5).lean().exec()

    const textMatches = await this.copyHistoryModel.find({
      orgId: new Types.ObjectId(orgId),
      $text: { $search: normalizedContent.replace(/#/g, ' ') },
    }).limit(5).lean().exec()

    const matches = [...exactMatches, ...textMatches]
      .filter((item, index, self) =>
        self.findIndex(candidate => candidate._id.toString() === item._id.toString()) === index,
      )
      .map(item => ({
        id: item._id.toString(),
        taskId: item.taskId?.toString() || null,
        title: item.title,
        subtitle: item.subtitle,
        createdAt: item.createdAt,
      }))

    return {
      isDuplicate: matches.length > 0,
      matchCount: matches.length,
      matches,
    }
  }

  private async generateWithProvider(input: {
    brandName: string
    toneKeywords: string[]
    avoidKeywords: string[]
    scene: string
    sourceHint: string
    historyExamples: HistoricalCopyExample[]
    dedupMatches: Array<{ title: string, subtitle: string }>
    metadata: Record<string, any>
  }): Promise<GeneratedCopyDraft | null> {
    const provider = this.resolveProvider()
    const prompt = this.buildPrompt(input)

    try {
      switch (provider) {
        case 'deepseek':
          return await this.generateWithDeepSeek(prompt)
        case 'gemini':
          return await this.generateWithGemini(prompt)
        default:
          return null
      }
    }
    catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown copy provider error'
      this.logger.warn(`文案 LLM 调用失败，降级为 heuristic: ${message}`)
      return null
    }
  }

  private resolveProvider() {
    const configuredProvider = process.env['MEDIACLAW_COPY_PROVIDER']?.trim().toLowerCase()
    if (configuredProvider === 'deepseek' && process.env['MEDIACLAW_DEEPSEEK_API_KEY']?.trim()) {
      return 'deepseek'
    }
    if (configuredProvider === 'gemini' && process.env['MEDIACLAW_GEMINI_API_KEY']?.trim()) {
      return 'gemini'
    }
    if (configuredProvider === 'heuristic') {
      return 'heuristic'
    }

    if (process.env['MEDIACLAW_DEEPSEEK_API_KEY']?.trim()) {
      return 'deepseek'
    }
    if (process.env['MEDIACLAW_GEMINI_API_KEY']?.trim()) {
      return 'gemini'
    }

    return 'heuristic'
  }

  private buildPrompt(input: {
    brandName: string
    toneKeywords: string[]
    avoidKeywords: string[]
    scene: string
    sourceHint: string
    historyExamples: HistoricalCopyExample[]
    dedupMatches: Array<{ title: string, subtitle: string }>
    metadata: Record<string, any>
  }) {
    const platform = this.readMetadataString(input.metadata, 'platform') || '通用短视频平台'
    const platformRules = this.buildPlatformRules(platform)
    const examples = input.historyExamples.length > 0
      ? input.historyExamples.map(example =>
          `- 标题: ${example.title}; 字幕: ${example.subtitle}; 标签: ${example.hashtags.join(' ')}`,
        ).join('\n')
      : '- 暂无历史高效文案'
    const dedupHints = input.dedupMatches.length > 0
      ? input.dedupMatches.map(item => `- ${item.title} / ${item.subtitle}`).join('\n')
      : '- 暂无重复风险'

    return [
      '你是 MediaClaw 的品牌短视频文案引擎，只能输出 JSON。',
      '输出字段必须包含: title, subtitle, hashtags, blueWords, commentGuides。',
      '约束: 标题 <=60字; 字幕 15-60字; hashtags 5-10个; blueWords 1-3个; commentGuides 必须正好 3 条。',
      `品牌名称: ${input.brandName}`,
      `内容场景: ${input.scene}`,
      `品牌关键词: ${input.toneKeywords.join('、') || '品牌感、转化、种草'}`,
      `禁用词: ${input.avoidKeywords.join('、') || '无'}`,
      `平台规则: ${platformRules}`,
      input.sourceHint,
      '历史高效文案参考:',
      examples,
      '需要避开的近似文案:',
      dedupHints,
      'hashtags 统一带 # 前缀，blueWords 更适合小红书互动语境。',
    ].join('\n')
  }

  private async generateWithDeepSeek(prompt: string): Promise<GeneratedCopyDraft | null> {
    const apiKey = process.env['MEDIACLAW_DEEPSEEK_API_KEY']?.trim()
    if (!apiKey) {
      return null
    }

    const baseUrl = process.env['MEDIACLAW_DEEPSEEK_BASE_URL']?.trim() || 'https://api.deepseek.com'
    const model = process.env['MEDIACLAW_DEEPSEEK_MODEL']?.trim() || 'deepseek-chat'
    const response = await this.requestJson<DeepSeekResponse>(
      `${baseUrl.replace(/\/+$/, '')}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'Return valid JSON only.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.8,
          response_format: { type: 'json_object' },
        }),
        timeoutMs: 60_000,
      },
    )

    const content = response.choices?.[0]?.message?.content
    return content ? this.parseDraft(content) : null
  }

  private async generateWithGemini(prompt: string): Promise<GeneratedCopyDraft | null> {
    const apiKey = process.env['MEDIACLAW_GEMINI_API_KEY']?.trim()
    if (!apiKey) {
      return null
    }

    const baseUrl = process.env['MEDIACLAW_GEMINI_BASE_URL']?.trim() || 'https://generativelanguage.googleapis.com/v1beta'
    const model = process.env['MEDIACLAW_GEMINI_MODEL']?.trim() || 'gemini-2.5-flash'
    const response = await this.requestJson<GeminiResponse>(
      `${baseUrl.replace(/\/+$/, '')}/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.8,
          },
        }),
        timeoutMs: 60_000,
      },
    )

    const text = response.candidates?.[0]?.content?.parts?.[0]?.text
    return text ? this.parseDraft(text) : null
  }

  private normalizeGeneratedCopy(input: {
    draft: GeneratedCopyDraft | null
    brandName: string
    scene: string
    toneKeywords: string[]
    avoidKeywords: string[]
    dedupDuplicate: boolean
  }): GeneratedCopy {
    const heuristic = this.buildHeuristicCopy(
      input.brandName,
      input.scene,
      input.toneKeywords,
      input.avoidKeywords,
    )

    const titleBase = this.coerceText(input.draft?.title) || heuristic.title
    const subtitleBase = this.coerceText(input.draft?.subtitle) || heuristic.subtitle
    const hashtagsBase = this.coerceStringArray(input.draft?.hashtags)
    const blueWordsBase = this.coerceStringArray(input.draft?.blueWords)
    const commentGuidesBase = this.coerceCommentGuides(input.draft) || heuristic.commentGuides

    let title = this.limitText(titleBase, 60)
    if (input.dedupDuplicate) {
      title = this.generateABVariants(title, 1)[0] || title
    }

    const blueWordResult = this.generateBlueWords(title, blueWordsBase.length > 0 ? blueWordsBase : input.toneKeywords)
    const subtitle = this.normalizeSubtitle(subtitleBase, input.brandName, input.scene)
    const hashtags = this.normalizeHashtags(
      hashtagsBase.length > 0 ? hashtagsBase : heuristic.hashtags,
      input.brandName,
      input.toneKeywords,
      blueWordResult.blueWords,
    )
    const commentGuides = this.normalizeCommentGuides(
      commentGuidesBase,
      input.brandName,
      subtitle,
    )

    return {
      title: blueWordResult.title,
      subtitle,
      hashtags,
      blueWords: blueWordResult.blueWords,
      commentGuide: commentGuides.join('\n'),
      commentGuides,
    }
  }

  private buildHeuristicCopy(
    brandName: string,
    scene: string,
    toneKeywords: string[],
    avoidKeywords: string[],
  ): GeneratedCopy {
    const primaryTone = toneKeywords[0] || '品牌感'
    const titleSeed = `${brandName}${primaryTone}短视频`
    const blueWordResult = this.generateBlueWords(titleSeed, toneKeywords)
    const subtitle = this.normalizeSubtitle(
      `${scene}场景成片已生成，突出${toneKeywords.slice(0, 2).join('、') || '品牌识别度'}`,
      brandName,
      scene,
    )
    const commentGuides = avoidKeywords.length > 0
      ? [
          `评论区建议围绕体验和反馈展开，避免提及：${avoidKeywords.join('、')}。`,
          `如果你也在做 ${scene}，留言“案例”我继续补充合规版本。`,
          `想看 ${brandName} 下一条更强转化还是更强种草？直接留言告诉我。`,
        ]
      : this.generateCommentGuides(brandName, subtitle)

    return {
      title: blueWordResult.title,
      subtitle,
      hashtags: this.buildHashtags(brandName, toneKeywords, blueWordResult.blueWords),
      blueWords: blueWordResult.blueWords,
      commentGuide: commentGuides.join('\n'),
      commentGuides,
    }
  }

  private normalizeSubtitle(subtitle: string, brandName: string, scene: string) {
    let normalized = subtitle.trim()
    if (!normalized) {
      normalized = `${brandName}${scene}场景成片已生成，品牌信息与节奏已同步优化。`
    }

    while (normalized.length < 15) {
      normalized = `${normalized}${brandName}`
    }

    return this.limitText(normalized, 60)
  }

  private normalizeHashtags(
    hashtags: string[],
    brandName: string,
    keywords: string[],
    blueWords: string[],
  ) {
    const normalized = [...new Set([
      ...hashtags,
      ...this.buildHashtags(brandName, keywords, blueWords),
    ].map(item => this.toBlueWord(item)).filter(Boolean))]

    return normalized.slice(0, Math.max(5, Math.min(normalized.length, 10)))
  }

  private normalizeCommentGuides(commentGuides: string[], brandName: string, content: string) {
    const normalized = commentGuides
      .map(item => item.trim())
      .filter(Boolean)

    const fallback = this.generateCommentGuides(brandName, content)
    while (normalized.length < 3) {
      normalized.push(fallback[normalized.length] || fallback[0])
    }

    return normalized.slice(0, 3)
  }

  private coerceText(value: unknown) {
    return typeof value === 'string' ? value.trim() : ''
  }

  private coerceStringArray(value: unknown) {
    if (!Array.isArray(value)) {
      return []
    }

    return value
      .map(item => typeof item === 'string' ? item.trim() : '')
      .filter(Boolean)
  }

  private coerceCommentGuides(draft: GeneratedCopyDraft | null) {
    const arrayValue = this.coerceStringArray(draft?.commentGuides)
    if (arrayValue.length > 0) {
      return arrayValue
    }

    const guideText = this.coerceText(draft?.commentGuide)
    if (!guideText) {
      return []
    }

    return guideText
      .split(/\n|[|；;]+/g)
      .map(item => item.trim())
      .filter(Boolean)
  }

  private parseDraft(text: string): GeneratedCopyDraft | null {
    try {
      return JSON.parse(text) as GeneratedCopyDraft
    }
    catch {
      const match = text.match(/\{[\s\S]*\}/)
      if (!match) {
        return null
      }

      try {
        return JSON.parse(match[0]) as GeneratedCopyDraft
      }
      catch {
        return null
      }
    }
  }

  private async getHistoricalExamples(orgId: string): Promise<HistoricalCopyExample[]> {
    if (!Types.ObjectId.isValid(orgId)) {
      return []
    }

    const history = await this.copyHistoryModel.find({
      orgId: new Types.ObjectId(orgId),
    })
      .sort({ 'performance.views': -1, 'performance.ctr': -1, createdAt: -1 })
      .limit(5)
      .lean()
      .exec()

    return history.map(item => ({
      title: item.title || '',
      subtitle: item.subtitle || '',
      hashtags: item.hashtags || [],
    }))
  }

  private buildPlatformRules(platform: string) {
    switch (platform.trim().toLowerCase()) {
      case 'xiaohongshu':
      case 'rednote':
      case '小红书':
        return '适合生活方式和种草表达，标题要自然，有互动感，蓝词更重要。'
      case 'douyin':
      case '抖音':
        return '前 8-12 个字要有钩子，语气更直接，适合转化和停留。'
      case 'kuaishou':
      case '快手':
        return '表达更口语化，强调真实体验和结果，不要太花。'
      default:
        return '适配通用短视频平台，兼顾信息密度、互动感和转化。'
    }
  }

  private buildHashtags(brandName: string, keywords: string[], blueWords: string[]) {
    return [...new Set([
      this.toBlueWord(brandName.replace(/\s+/g, '')),
      ...keywords.slice(0, 6).map(keyword => this.toBlueWord(keyword)),
      ...blueWords,
      '#短视频',
      '#品牌营销',
      '#内容增长',
    ].filter(Boolean))].slice(0, 10)
  }

  private toBlueWord(value: string) {
    const normalizedValue = value.replace(/^#+/, '').replace(/\s+/g, '')
    return normalizedValue ? `#${normalizedValue}` : ''
  }

  private limitText(value: string, maxLength: number) {
    return value.trim().slice(0, maxLength)
  }

  private async recordCopyHistory(payload: CopyHistoryPayload) {
    if (!payload.orgId || !Types.ObjectId.isValid(payload.orgId)) {
      return
    }

    const baseDocument = {
      orgId: new Types.ObjectId(payload.orgId),
      taskId: payload.taskId && Types.ObjectId.isValid(payload.taskId)
        ? new Types.ObjectId(payload.taskId)
        : null,
      title: payload.title,
      subtitle: payload.subtitle,
      hashtags: payload.hashtags,
      blueWords: payload.blueWords,
      commentGuide: payload.commentGuide,
      performance: {
        views: 0,
        clicks: 0,
        ctr: 0,
      },
    }

    if (baseDocument.taskId) {
      await this.copyHistoryModel.findOneAndUpdate(
        { taskId: baseDocument.taskId },
        { $set: baseDocument },
        { upsert: true, new: true },
      ).exec()
      return
    }

    await this.copyHistoryModel.create(baseDocument)
  }

  private escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  private readMetadataString(metadata: Record<string, any>, key: string) {
    const value = metadata[key]
    return typeof value === 'string' ? value.trim() : ''
  }

  private async requestJson<T>(
    url: string,
    options: {
      method: 'GET' | 'POST'
      headers?: Record<string, string>
      body?: string
      timeoutMs?: number
    },
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const target = new URL(url)
      const request = (target.protocol === 'https:' ? httpsRequest : httpRequest)(
        target,
        {
          method: options.method,
          headers: options.headers,
        },
        (response) => {
          const chunks: Buffer[] = []
          response.on('data', (chunk: Buffer | string) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
          })
          response.on('end', () => {
            const statusCode = response.statusCode || 0
            const bodyText = Buffer.concat(chunks).toString()
            if (statusCode < 200 || statusCode >= 300) {
              reject(new Error(`HTTP ${statusCode}: ${bodyText || target.toString()}`))
              return
            }

            try {
              resolve(JSON.parse(bodyText) as T)
            }
            catch (error) {
              reject(error)
            }
          })
        },
      )

      if (options.timeoutMs) {
        request.setTimeout(options.timeoutMs, () => {
          request.destroy(new Error(`Request timed out: ${url}`))
        })
      }

      request.on('error', reject)
      if (options.body) {
        request.write(options.body)
      }
      request.end()
    })
  }
}
