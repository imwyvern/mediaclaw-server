import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Brand, CopyHistory, Organization, OrgApiKeyProvider, UsageHistoryType } from '@yikart/mongodb'
import { Model, Types } from 'mongoose'
import { ModelResolverService } from '../model-resolver/model-resolver.service'
import { ByokService } from '../settings/byok.service'
import { UsageService } from '../usage/usage.service'

export interface GeneratedCopy {
  title: string
  subtitle: string
  description: string
  hashtags: string[]
  blueWords: string[]
  commentGuide: string
  commentGuides: string[]
}

export interface GeneratedCopyRecord {
  copyHistoryId: string | null
  copy: GeneratedCopy
}

export interface GeneratedTextResult {
  text: string
  provider: CopyProvider
}

type CopyProvider = 'deepseek' | 'gemini' | 'openai' | 'heuristic'

interface CopyHistoryPayload extends GeneratedCopy {
  orgId?: string | null
  taskId?: string | null
  variantIndex?: number | null
  variantGroupId?: string | null
  variantGoal?: string
  dedupFingerprint?: string
}

interface CopyHistoryWriteOptions {
  replaceExistingForTask?: boolean
}

interface HistoricalCopyExample {
  title: string
  subtitle: string
  description: string
  hashtags: string[]
}

interface GeneratedCopyDraft {
  title?: unknown
  subtitle?: unknown
  description?: unknown
  hashtags?: unknown
  blueWords?: unknown
  commentGuide?: unknown
  commentGuides?: unknown
}

interface CopyTokenUsage {
  inputTokens: number
  outputTokens: number
  model: string
  cost: number
}

interface CopyLlmResult {
  draft: GeneratedCopyDraft | null
  tokenUsage: CopyTokenUsage
  provider: CopyProvider
}

interface CopyTextLlmResult {
  text: string
  tokenUsage: CopyTokenUsage
  provider: CopyProvider
}

interface DeepSeekResponse {
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
  model?: string
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string
      }>
    }
  }>
  modelVersion?: string
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
  }
}

interface OpenAiResponse {
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
  model?: string
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

interface CopyStrategyPromptHints {
  promptGuidance?: string
  recommendedTones?: string[]
  recommendedTitleLengthRange?: string | null
  optimalHashtagCount?: number
  blueWordPolicy?: string
}

interface CopyTrendSignals {
  trendingBlueWords: string[]
  commentGuideWords: string[]
}

interface GenerateBlueWordsOptions {
  trendingWords?: string[]
  maxWords?: number
}

interface CommentGuideOptions {
  guideWords?: string[]
  trendingBlueWords?: string[]
}

@Injectable()
export class CopyEngineService {
  private readonly logger = new Logger(CopyEngineService.name)

  constructor(
    @InjectModel(Brand.name) private readonly brandModel: Model<Brand>,
    @InjectModel(CopyHistory.name) private readonly copyHistoryModel: Model<CopyHistory>,
    @InjectModel(Organization.name) private readonly organizationModel: Model<Organization>,
    @Optional() private readonly usageService?: UsageService,
    @Optional() private readonly byokService?: ByokService,
    @Optional() private readonly modelResolverService?: ModelResolverService,
  ) {}

  async generateCopy(
    brandId: string | null | undefined,
    videoUrl: string,
    metadata: Record<string, any> = {},
  ): Promise<GeneratedCopy> {
    const result = await this.generateCopyRecord(brandId, videoUrl, metadata, {
      replaceExistingForTask: true,
    })

    return result.copy
  }

  async generateCopyRecord(
    brandId: string | null | undefined,
    videoUrl: string,
    metadata: Record<string, any> = {},
    options: CopyHistoryWriteOptions = {},
  ): Promise<GeneratedCopyRecord> {
    const normalizedBrandId = this.normalizeObjectIdString(brandId)
    const brand = normalizedBrandId
      ? await this.brandModel.findById(normalizedBrandId).exec()
      : null
    const resolvedOrgId = brand?.orgId?.toString() || this.readMetadataObjectId(metadata, 'orgId')

    const brandName = brand?.name || 'MediaClaw'
    const avoidKeywords = brand?.assets?.prohibitedWords || []
    const toneKeywords = this.filterProhibitedTerms(this.buildBrandKeywords(brand), avoidKeywords)
    const brandSlogans = this.filterProhibitedTerms(brand?.assets?.slogans || [], avoidKeywords)
    const scene = this.readMetadataString(metadata, 'scene')
      || this.readMetadataString(metadata, 'theme')
      || this.readMetadataString(metadata, 'campaign')
      || this.readMetadataString(metadata, 'platform')
      || '内容分发'
    const sourceHint = videoUrl
      ? `视频素材地址: ${videoUrl}`
      : this.readMetadataString(metadata, 'sourceHint') || '未提供视频素材地址'
    const dedup = resolvedOrgId
      ? await this.checkDedupHistory(resolvedOrgId, {
          title: `${brandName}${scene}`,
          subtitle: scene,
        })
      : { isDuplicate: false, matchCount: 0, matches: [] }
    const historyExamples = resolvedOrgId
      ? await this.getHistoricalExamples(resolvedOrgId)
      : []
    const strategyHints = resolvedOrgId
      ? await this.getCopyStrategyHints(resolvedOrgId)
      : null
    const trendSignals = resolvedOrgId
      ? await this.getCopyTrendSignals(resolvedOrgId)
      : {
          trendingBlueWords: [],
          commentGuideWords: [],
        }

    const llmResult = await this.generateWithProvider({
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
      brandSlogans,
      strategyHints,
      trendingBlueWords: trendSignals.trendingBlueWords,
      commentGuideWords: trendSignals.commentGuideWords,
      metadata,
    })

    let generated = this.normalizeGeneratedCopy({
      draft: llmResult.draft,
      brandName,
      scene,
      toneKeywords,
      avoidKeywords,
      dedupDuplicate: dedup.isDuplicate,
      trendingBlueWords: trendSignals.trendingBlueWords,
      commentGuideWords: trendSignals.commentGuideWords,
    })

    const uniqueCopy = resolvedOrgId
      ? await this.ensureDistinctFromRecentHistory(resolvedOrgId, generated, {
          brandName,
          scene,
          toneKeywords,
          avoidKeywords,
          trendingBlueWords: trendSignals.trendingBlueWords,
          commentGuideWords: trendSignals.commentGuideWords,
        })
      : {
          copy: generated,
          dedupFingerprint: this.buildDedupFingerprint(generated),
        }
    generated = uniqueCopy.copy

    await this.recordLlmUsage(
      llmResult,
      metadata,
      this.normalizeObjectIdString(brand?._id) || normalizedBrandId,
    )

    const copyHistory = await this.recordCopyHistory({
      orgId: resolvedOrgId,
      taskId: this.normalizeObjectIdString(metadata['taskId']),
      variantIndex: this.normalizeVariantIndex(metadata['variantIndex']),
      variantGroupId: this.readMetadataString(metadata, 'variantGroupId') || null,
      variantGoal: this.readMetadataString(metadata, 'variantGoal') || '',
      dedupFingerprint: uniqueCopy.dedupFingerprint,
      ...generated,
    }, options)

    return {
      copyHistoryId: this.normalizeObjectIdString(copyHistory?._id) || null,
      copy: generated,
    }
  }

  async rewriteCopyRecord(
    copyHistory: Pick<CopyHistory, 'title' | 'subtitle' | 'description' | 'hashtags' | 'blueWords' | 'commentGuide' | 'orgId' | 'taskId'>,
    brandId: string | null | undefined,
    instructions?: string,
    metadata: Record<string, any> = {},
    options: CopyHistoryWriteOptions = {},
  ): Promise<GeneratedCopyRecord> {
    const normalizedBrandId = this.normalizeObjectIdString(brandId)
    const brand = normalizedBrandId
      ? await this.brandModel.findById(normalizedBrandId).exec()
      : null
    const rewriteMetadata = {
      ...metadata,
      orgId: copyHistory.orgId?.toString() || this.readMetadataObjectId(metadata, 'orgId'),
      taskId: copyHistory.taskId?.toString() || this.readMetadataObjectId(metadata, 'taskId'),
    }
    const llmResult = await this.generateFromPrompt(
      this.buildRewritePrompt(copyHistory, instructions, rewriteMetadata),
      rewriteMetadata,
    )
    const toneKeywords = brand?.assets?.keywords?.length
      ? this.filterProhibitedTerms(this.buildBrandKeywords(brand), brand?.assets?.prohibitedWords || [])
      : (copyHistory.blueWords || []).map(item => item.replace(/^#+/, '')).filter(Boolean)
    const rewritten = this.normalizeGeneratedCopy({
      draft: llmResult.draft,
      brandName: brand?.name || 'MediaClaw',
      scene: instructions?.trim() || '文案改写',
      toneKeywords,
      avoidKeywords: brand?.assets?.prohibitedWords || [],
      dedupDuplicate: false,
      trendingBlueWords: [],
      commentGuideWords: [],
    })

    await this.recordLlmUsage(llmResult, rewriteMetadata, normalizedBrandId)
    const rewrittenHistory = await this.recordCopyHistory({
      orgId: rewriteMetadata['orgId'],
      taskId: rewriteMetadata['taskId'],
      ...rewritten,
    }, options)

    return {
      copyHistoryId: this.normalizeObjectIdString(rewrittenHistory?._id) || null,
      copy: rewritten,
    }
  }

  generateBlueWords(
    title: string,
    keywords: string[] = [],
    options: GenerateBlueWordsOptions = {},
  ) {
    const normalizedTitle = title.trim()
    if (!normalizedTitle) {
      throw new BadRequestException('title is required')
    }

    const keywordBlueWords = [
      ...(options.trendingWords || []),
      ...keywords,
    ]
      .map(keyword => keyword.trim())
      .filter(Boolean)
      .slice(0, Math.min(Math.max(options.maxWords || 3, 1), 5))
      .map(keyword => this.toBlueWord(keyword))
    const existingBlueWords = normalizedTitle.match(/#[^\s#]+/g) || []
    const blueWords = [...new Set([...existingBlueWords, ...keywordBlueWords])]
      .slice(0, Math.min(Math.max(options.maxWords || 3, 1), 5))
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

  generateCommentGuides(
    brand: string,
    content: string,
    options: CommentGuideOptions = {},
  ) {
    const safeBrand = brand.trim() || 'MediaClaw'
    const safeContent = content.trim() || '这条内容'
    const guideWords = (options.guideWords || [])
      .map(item => item.trim())
      .filter(Boolean)
      .slice(0, 3)
    const leadBlueWord = (options.trendingBlueWords || [])
      .map(item => item.replace(/^#+/, '').trim())
      .find(Boolean)
    const primaryWord = guideWords[0] || '模板'
    const secondaryWord = guideWords[1] || '案例'
    const tertiaryWord = guideWords[2] || '激进'
    const safeTopic = this.limitText(
      safeContent.replace(/\s+/g, ' ').slice(0, 24),
      24,
    )

    return [
      `评论“${primaryWord}”我把 ${safeBrand} 这条的完整拆解发你。`,
      `如果你也在做 ${safeTopic}，留言“${secondaryWord}”我继续补最能转化的版本。`,
      `想看 ${leadBlueWord || safeBrand} 下一条更${tertiaryWord}还是更稳？评论区直接告诉我。`,
    ]
  }

  generateABVariants(baseTitle: string, count = 3) {
    const normalizedTitle = baseTitle.trim()
    if (!normalizedTitle) {
      throw new BadRequestException('baseTitle is required')
    }

    const normalizedCount = Math.min(Math.max(Math.trunc(Number(count) || 3), 1), 3)
    const candidates = [
      `${normalizedTitle}，看完就能直接复用`,
      `为什么说${normalizedTitle}更容易起量`,
      `${normalizedTitle}，评论区领拆解模板`,
      `${normalizedTitle}，3 步抄到可发布版本`,
      `${normalizedTitle}，品牌号也能这样写`,
    ]

    return [...new Set(candidates)].slice(0, normalizedCount)
  }

  async generateText(
    prompt: string,
    metadata: Record<string, any> = {},
    options: {
      systemPrompt?: string
      temperature?: number
      fallbackText?: string
      usageSource?: string
      brandId?: string | null
    } = {},
  ): Promise<GeneratedTextResult> {
    const result = await this.generateTextFromPrompt(prompt, metadata, options)

    await this.recordLlmUsage(
      result,
      metadata,
      options.brandId || null,
      options.usageSource || 'copy-engine-text',
    )

    return {
      text: result.text || options.fallbackText?.trim() || '',
      provider: result.provider,
    }
  }

  async checkDedupHistory(orgId: string, content: string | { title?: string, subtitle?: string, description?: string }) {
    if (!Types.ObjectId.isValid(orgId)) {
      return {
        isDuplicate: false,
        matchCount: 0,
        matches: [],
        fingerprint: '',
      }
    }

    const fingerprint = this.buildDedupFingerprint(content)

    if (!fingerprint) {
      return {
        isDuplicate: false,
        matchCount: 0,
        matches: [],
        fingerprint: '',
      }
    }

    const recentHistory = await this.copyHistoryModel.find({
      orgId: new Types.ObjectId(orgId),
    })
      .sort({ createdAt: -1, _id: -1 })
      .limit(1000)
      .lean()
      .exec() as Array<Record<string, any>>

    const matches = recentHistory
      .map((item) => {
        const candidateFingerprint = this.readString(item['dedupFingerprint'])
          || this.buildDedupFingerprint({
            title: this.readString(item['title']),
            subtitle: this.readString(item['subtitle']),
            description: this.readString(item['description']),
          })
        const similarity = this.calculateTextSimilarity(
          fingerprint,
          candidateFingerprint,
        )
        const titleSimilarity = this.calculateTextSimilarity(
          this.normalizeFingerprintText(
            typeof content === 'string'
              ? content
              : this.readString(content.title),
          ),
          this.normalizeFingerprintText(this.readString(item['title'])),
        )

        return {
          item,
          similarity: Math.max(similarity, titleSimilarity),
        }
      })
      .filter(candidate => candidate.similarity >= 0.82)
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, 5)
      .map(item => ({
        id: item.item['_id'].toString(),
        taskId: item.item['taskId']?.toString?.() || null,
        title: this.readString(item.item['title']),
        subtitle: this.readString(item.item['subtitle']),
        createdAt: item.item['createdAt'],
        similarity: Number(item.similarity.toFixed(4)),
      }))

    return {
      isDuplicate: matches.length > 0,
      matchCount: matches.length,
      matches,
      fingerprint,
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
    brandSlogans: string[]
    strategyHints: CopyStrategyPromptHints | null
    trendingBlueWords: string[]
    commentGuideWords: string[]
    metadata: Record<string, any>
  }): Promise<CopyLlmResult> {
    const prompt = this.buildPrompt(input)

    return this.generateFromPrompt(prompt, input.metadata)
  }

  private async generateFromPrompt(
    prompt: string,
    metadata: Record<string, any>,
  ): Promise<CopyLlmResult> {
    const runtime = await this.resolveProviderConfig(metadata)

    try {
      switch (runtime.provider) {
        case 'deepseek':
          return await this.generateWithDeepSeek(prompt, metadata, runtime.model)
        case 'gemini':
          return await this.generateWithGemini(prompt, metadata, runtime.model)
        case 'openai':
          return await this.generateWithOpenAi(prompt, metadata, runtime.model)
        default:
          return this.createEmptyLlmResult('heuristic')
      }
    }
    catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown copy provider error'
      this.logger.warn(`文案 LLM 调用失败，降级为 heuristic: ${message}`)
      return this.createEmptyLlmResult('heuristic')
    }
  }

  private async generateTextFromPrompt(
    prompt: string,
    metadata: Record<string, any>,
    options: {
      systemPrompt?: string
      temperature?: number
      fallbackText?: string
    } = {},
  ): Promise<CopyTextLlmResult> {
    const runtime = await this.resolveProviderConfig(metadata)

    try {
      switch (runtime.provider) {
        case 'deepseek':
          return await this.generateTextWithDeepSeek(prompt, metadata, options, runtime.model)
        case 'gemini':
          return await this.generateTextWithGemini(prompt, metadata, options, runtime.model)
        case 'openai':
          return await this.generateTextWithOpenAi(prompt, metadata, options, runtime.model)
        default:
          return this.createEmptyTextLlmResult('heuristic', options.fallbackText)
      }
    }
    catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown text provider error'
      this.logger.warn(`文本 LLM 调用失败，降级为 heuristic: ${message}`)
      return this.createEmptyTextLlmResult('heuristic', options.fallbackText)
    }
  }

  private async resolveProviderConfig(metadata: Record<string, any>) {
    const orgId = this.readMetadataObjectId(metadata, 'orgId')
    const pipelineId = this.readMetadataObjectId(metadata, 'pipelineId')
    const requestedProvider = this.normalizeRequestedProvider(
      this.readMetadataString(metadata, 'copyProvider') || this.readMetadataString(metadata, 'provider'),
    )
    if (requestedProvider) {
      const forcedConfig = await this.resolveForcedProviderConfig(metadata, requestedProvider)
      if (forcedConfig) {
        return forcedConfig
      }
    }

    if (this.modelResolverService && orgId) {
      const resolved = await this.modelResolverService.resolveCapability(orgId, 'copy', pipelineId)
      const provider = this.mapProviderEnum(resolved.provider)
      if (provider !== 'heuristic') {
        const apiKey = await this.resolveApiKey(metadata, resolved.provider, this.fallbackEnvNames(resolved.provider))
        if (apiKey) {
          return {
            provider,
            model: resolved.runtimeModel,
          }
        }
      }
    }

    const configuredProvider = process.env['MEDIACLAW_COPY_PROVIDER']?.trim().toLowerCase()
    const deepseekKey = await this.resolveApiKey(
      metadata,
      OrgApiKeyProvider.DEEPSEEK,
      ['MEDIACLAW_DEEPSEEK_API_KEY', 'DEEPSEEK_API_KEY'],
    )
    const geminiKey = await this.resolveApiKey(
      metadata,
      OrgApiKeyProvider.GEMINI,
      ['MEDIACLAW_GEMINI_API_KEY', 'GEMINI_API_KEY'],
    )
    const openAiKey = await this.resolveApiKey(
      metadata,
      OrgApiKeyProvider.OPENAI,
      ['MEDIACLAW_OPENAI_API_KEY', 'OPENAI_API_KEY'],
    )
    if (configuredProvider === 'deepseek' && deepseekKey) {
      return {
        provider: 'deepseek' as const,
        model: process.env['MEDIACLAW_DEEPSEEK_MODEL']?.trim() || process.env['DEEPSEEK_MODEL']?.trim() || 'deepseek-chat',
      }
    }
    if (configuredProvider === 'gemini' && geminiKey) {
      return {
        provider: 'gemini' as const,
        model: process.env['MEDIACLAW_GEMINI_MODEL']?.trim() || process.env['GEMINI_MODEL']?.trim() || 'gemini-2.5-flash',
      }
    }
    if (configuredProvider === 'openai' && openAiKey) {
      return {
        provider: 'openai' as const,
        model: process.env['MEDIACLAW_OPENAI_MODEL']?.trim() || process.env['OPENAI_MODEL']?.trim() || 'gpt-4o',
      }
    }
    if (configuredProvider === 'heuristic') {
      return {
        provider: 'heuristic' as const,
        model: '',
      }
    }

    if (deepseekKey) {
      return {
        provider: 'deepseek' as const,
        model: process.env['MEDIACLAW_DEEPSEEK_MODEL']?.trim() || process.env['DEEPSEEK_MODEL']?.trim() || 'deepseek-chat',
      }
    }
    if (geminiKey) {
      return {
        provider: 'gemini' as const,
        model: process.env['MEDIACLAW_GEMINI_MODEL']?.trim() || process.env['GEMINI_MODEL']?.trim() || 'gemini-2.5-flash',
      }
    }
    if (openAiKey) {
      return {
        provider: 'openai' as const,
        model: process.env['MEDIACLAW_OPENAI_MODEL']?.trim() || process.env['OPENAI_MODEL']?.trim() || 'gpt-4o',
      }
    }

    return {
      provider: 'heuristic' as const,
      model: '',
    }
  }

  private async resolveForcedProviderConfig(
    metadata: Record<string, any>,
    provider: Exclude<CopyProvider, 'heuristic'>,
  ) {
    const providerEnum = this.mapCopyProviderToApiProvider(provider)
    const apiKey = await this.resolveApiKey(metadata, providerEnum, this.fallbackEnvNames(providerEnum))
    if (!apiKey) {
      return null
    }

    return {
      provider,
      model: this.defaultModelForProvider(provider),
    }
  }

  private normalizeRequestedProvider(value: string): Exclude<CopyProvider, 'heuristic'> | null {
    const normalized = value.trim().toLowerCase()
    if (!normalized || normalized === 'auto') {
      return null
    }

    if (normalized === 'deepseek' || normalized === 'gemini' || normalized === 'openai') {
      return normalized
    }

    return null
  }

  private mapCopyProviderToApiProvider(provider: Exclude<CopyProvider, 'heuristic'>) {
    switch (provider) {
      case 'deepseek':
        return OrgApiKeyProvider.DEEPSEEK
      case 'gemini':
        return OrgApiKeyProvider.GEMINI
      case 'openai':
        return OrgApiKeyProvider.OPENAI
      default:
        throw new Error(`Unsupported copy provider: ${provider}`)
    }
  }

  private defaultModelForProvider(provider: Exclude<CopyProvider, 'heuristic'>) {
    switch (provider) {
      case 'deepseek':
        return process.env['MEDIACLAW_DEEPSEEK_MODEL']?.trim() || process.env['DEEPSEEK_MODEL']?.trim() || 'deepseek-chat'
      case 'gemini':
        return process.env['MEDIACLAW_GEMINI_MODEL']?.trim() || process.env['GEMINI_MODEL']?.trim() || 'gemini-2.5-flash'
      case 'openai':
        return process.env['MEDIACLAW_OPENAI_MODEL']?.trim() || process.env['OPENAI_MODEL']?.trim() || 'gpt-4o'
      default:
        throw new Error(`Unsupported copy provider: ${provider}`)
    }
  }

  private buildPrompt(input: {
    brandName: string
    toneKeywords: string[]
    avoidKeywords: string[]
    scene: string
    sourceHint: string
    historyExamples: HistoricalCopyExample[]
    dedupMatches: Array<{ title: string, subtitle: string }>
    brandSlogans: string[]
    strategyHints: CopyStrategyPromptHints | null
    trendingBlueWords: string[]
    commentGuideWords: string[]
    metadata: Record<string, any>
  }) {
    const platform = this.readMetadataString(input.metadata, 'platform') || '通用短视频平台'
    const style = this.readMetadataString(input.metadata, 'style') || '自然转化'
    const styleGuide = this.resolveStyleGuide(style)
    const variantGoal = this.readMetadataString(input.metadata, 'variantGoal')
    const avoidTitles = this.readMetadataStringArray(input.metadata, 'avoidTitles')
    const platformRules = this.buildPlatformRules(platform)
    const examples = input.historyExamples.length > 0
      ? input.historyExamples.map(example =>
          `- 标题: ${example.title}; 字幕: ${example.subtitle}; 正文: ${example.description}; 标签: ${example.hashtags.join(' ')}`,
        ).join('\n')
      : '- 暂无历史高效文案'
    const dedupHints = input.dedupMatches.length > 0
      ? input.dedupMatches.map(item => `- ${item.title} / ${item.subtitle}`).join('\n')
      : '- 暂无重复风险'
    const variantHints = avoidTitles.length > 0
      ? avoidTitles.map(item => `- ${item}`).join('\n')
      : '- 暂无已生成标题'
    const strategyPrompt = this.buildStrategyPrompt(input.strategyHints)

    return [
      '你是 MediaClaw 的品牌短视频文案引擎，只能输出 JSON。',
      '输出字段必须包含: title, subtitle, description, hashtags, blueWords, commentGuides。',
      '约束: 标题 <=60字; 字幕 15-60字; description 30-120字; hashtags 5-10个; blueWords 1-3个; commentGuides 必须正好 3 条。',
      `品牌名称: ${input.brandName}`,
      `内容场景: ${input.scene}`,
      `创作风格: ${style}`,
      styleGuide ? `风格要求: ${styleGuide}` : '',
      variantGoal ? `变体目标: ${variantGoal}` : '',
      input.brandSlogans.length > 0 ? `品牌话术: ${input.brandSlogans.join('、')}` : '',
      `品牌关键词: ${input.toneKeywords.join('、') || '品牌感、转化、种草'}`,
      `禁用词: ${input.avoidKeywords.join('、') || '无'}`,
      `平台规则: ${platformRules}`,
      input.sourceHint,
      '历史高效文案参考:',
      examples,
      '需要避开的近似文案:',
      dedupHints,
      '本次还需避开已生成标题:',
      variantHints,
      input.trendingBlueWords.length > 0
        ? `近期高互动蓝词: ${input.trendingBlueWords.join('、')}`
        : '',
      input.commentGuideWords.length > 0
        ? `近期高互动评论引导词: ${input.commentGuideWords.join('、')}`
        : '',
      strategyPrompt ? '当前组织已验证的高表现文案策略:' : '',
      strategyPrompt,
      'hashtags 统一带 # 前缀，blueWords 更适合小红书互动语境。',
      '优先让 blueWords 兼顾近期起量蓝词，commentGuides 使用明确可执行的评论引导词。',
      '禁用词不能出现在 title、subtitle、description、hashtags、commentGuides 的任何位置。',
    ].filter(Boolean).join('\n')
  }

  private async getCopyStrategyHints(orgId: string): Promise<CopyStrategyPromptHints | null> {
    if (!Types.ObjectId.isValid(orgId)) {
      return null
    }

    const organization = await this.organizationModel.findById(
      new Types.ObjectId(orgId),
    ).lean().exec() as Record<string, any> | null

    if (!organization) {
      return null
    }

    const settings = this.asRecord(organization['settings'])
    const strategy = this.asRecord(settings?.['copyStrategy'])
    if (!strategy) {
      return null
    }

    return {
      promptGuidance: this.readString(strategy['promptGuidance']),
      recommendedTones: this.readStringArray(strategy['recommendedTones']),
      recommendedTitleLengthRange: this.readString(strategy['recommendedTitleLengthRange']) || null,
      optimalHashtagCount: Number(strategy['optimalHashtagCount'] || 0),
      blueWordPolicy: this.readString(strategy['blueWordPolicy']),
    }
  }

  private buildStrategyPrompt(strategyHints: CopyStrategyPromptHints | null) {
    if (!strategyHints) {
      return ''
    }

    const promptGuidance = strategyHints.promptGuidance?.trim()
    if (promptGuidance) {
      return promptGuidance
    }

    return [
      strategyHints.recommendedTitleLengthRange
        ? `标题长度优先控制在 ${strategyHints.recommendedTitleLengthRange}。`
        : '',
      (strategyHints.recommendedTones || []).length > 0
        ? `优先情绪语气: ${(strategyHints.recommendedTones || []).join('、')}。`
        : '',
      strategyHints.optimalHashtagCount
        ? `hashtags 优先控制在 ${strategyHints.optimalHashtagCount} 个左右。`
        : '',
      strategyHints.blueWordPolicy === 'prefer_blue_words'
        ? '蓝词应作为主要互动引导。'
        : strategyHints.blueWordPolicy
          ? '蓝词应克制使用，避免堆砌。'
          : '',
    ].filter(Boolean).join('\n')
  }

  private async generateWithDeepSeek(
    prompt: string,
    metadata: Record<string, any>,
    modelOverride?: string,
  ): Promise<CopyLlmResult> {
    const apiKey = await this.resolveApiKey(
      metadata,
      OrgApiKeyProvider.DEEPSEEK,
      ['MEDIACLAW_DEEPSEEK_API_KEY', 'DEEPSEEK_API_KEY'],
    )
    if (!apiKey) {
      return this.createEmptyLlmResult('heuristic')
    }

    const baseUrl = process.env['MEDIACLAW_DEEPSEEK_BASE_URL']?.trim() || 'https://api.deepseek.com'
    const model = modelOverride?.trim()
      || process.env['MEDIACLAW_DEEPSEEK_MODEL']?.trim()
      || process.env['DEEPSEEK_MODEL']?.trim()
      || 'deepseek-chat'
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

    const content = response.choices?.[0]?.message?.content || ''

    return {
      draft: content ? this.parseDraft(content) : null,
      tokenUsage: this.buildTokenUsage({
        inputTokens: response.usage?.prompt_tokens,
        outputTokens: response.usage?.completion_tokens,
        totalTokens: response.usage?.total_tokens,
        model: response.model || model,
        prompt,
        completion: content,
      }),
      provider: 'deepseek',
    }
  }

  private async generateWithGemini(
    prompt: string,
    metadata: Record<string, any>,
    modelOverride?: string,
  ): Promise<CopyLlmResult> {
    const apiKey = await this.resolveApiKey(
      metadata,
      OrgApiKeyProvider.GEMINI,
      ['MEDIACLAW_GEMINI_API_KEY', 'GEMINI_API_KEY'],
    )
    if (!apiKey) {
      return this.createEmptyLlmResult('heuristic')
    }

    const baseUrl = process.env['MEDIACLAW_GEMINI_BASE_URL']?.trim() || 'https://generativelanguage.googleapis.com/v1beta'
    const model = modelOverride?.trim()
      || process.env['MEDIACLAW_GEMINI_MODEL']?.trim()
      || process.env['GEMINI_MODEL']?.trim()
      || 'gemini-2.5-flash'
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

    const text = response.candidates?.[0]?.content?.parts?.[0]?.text || ''

    return {
      draft: text ? this.parseDraft(text) : null,
      tokenUsage: this.buildTokenUsage({
        inputTokens: response.usageMetadata?.promptTokenCount,
        outputTokens: response.usageMetadata?.candidatesTokenCount,
        totalTokens: response.usageMetadata?.totalTokenCount,
        model: response.modelVersion || model,
        prompt,
        completion: text,
      }),
      provider: 'gemini',
    }
  }

  private async generateWithOpenAi(
    prompt: string,
    metadata: Record<string, any>,
    modelOverride?: string,
  ): Promise<CopyLlmResult> {
    const apiKey = await this.resolveApiKey(
      metadata,
      OrgApiKeyProvider.OPENAI,
      ['MEDIACLAW_OPENAI_API_KEY', 'OPENAI_API_KEY'],
    )
    if (!apiKey) {
      return this.createEmptyLlmResult('heuristic')
    }

    const baseUrl = process.env['MEDIACLAW_OPENAI_BASE_URL']?.trim() || process.env['OPENAI_BASE_URL']?.trim() || 'https://api.openai.com/v1'
    const model = modelOverride?.trim()
      || process.env['MEDIACLAW_OPENAI_MODEL']?.trim()
      || process.env['OPENAI_MODEL']?.trim()
      || 'gpt-4o'
    const response = await this.requestJson<OpenAiResponse>(
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

    const content = response.choices?.[0]?.message?.content || ''

    return {
      draft: content ? this.parseDraft(content) : null,
      tokenUsage: this.buildTokenUsage({
        inputTokens: response.usage?.prompt_tokens,
        outputTokens: response.usage?.completion_tokens,
        totalTokens: response.usage?.total_tokens,
        model: response.model || model,
        prompt,
        completion: content,
      }),
      provider: 'openai',
    }
  }

  private async generateTextWithDeepSeek(
    prompt: string,
    metadata: Record<string, any>,
    options: {
      systemPrompt?: string
      temperature?: number
      fallbackText?: string
    } = {},
    modelOverride?: string,
  ): Promise<CopyTextLlmResult> {
    const apiKey = await this.resolveApiKey(
      metadata,
      OrgApiKeyProvider.DEEPSEEK,
      ['MEDIACLAW_DEEPSEEK_API_KEY', 'DEEPSEEK_API_KEY'],
    )
    if (!apiKey) {
      return this.createEmptyTextLlmResult('heuristic', options.fallbackText)
    }

    const baseUrl = process.env['MEDIACLAW_DEEPSEEK_BASE_URL']?.trim() || 'https://api.deepseek.com'
    const model = modelOverride?.trim()
      || process.env['MEDIACLAW_DEEPSEEK_MODEL']?.trim()
      || process.env['DEEPSEEK_MODEL']?.trim()
      || 'deepseek-chat'
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
            { role: 'system', content: options.systemPrompt?.trim() || 'Return plain text only.' },
            { role: 'user', content: prompt },
          ],
          temperature: typeof options.temperature === 'number' ? options.temperature : 0.7,
        }),
        timeoutMs: 60_000,
      },
    )

    const text = (response.choices?.[0]?.message?.content || '').trim()

    return {
      text: text || options.fallbackText?.trim() || '',
      tokenUsage: this.buildTokenUsage({
        inputTokens: response.usage?.prompt_tokens,
        outputTokens: response.usage?.completion_tokens,
        totalTokens: response.usage?.total_tokens,
        model: response.model || model,
        prompt,
        completion: text,
      }),
      provider: 'deepseek',
    }
  }

  private async generateTextWithGemini(
    prompt: string,
    metadata: Record<string, any>,
    options: {
      systemPrompt?: string
      temperature?: number
      fallbackText?: string
    } = {},
    modelOverride?: string,
  ): Promise<CopyTextLlmResult> {
    const apiKey = await this.resolveApiKey(
      metadata,
      OrgApiKeyProvider.GEMINI,
      ['MEDIACLAW_GEMINI_API_KEY', 'GEMINI_API_KEY'],
    )
    if (!apiKey) {
      return this.createEmptyTextLlmResult('heuristic', options.fallbackText)
    }

    const baseUrl = process.env['MEDIACLAW_GEMINI_BASE_URL']?.trim() || 'https://generativelanguage.googleapis.com/v1beta'
    const model = modelOverride?.trim()
      || process.env['MEDIACLAW_GEMINI_MODEL']?.trim()
      || process.env['GEMINI_MODEL']?.trim()
      || 'gemini-2.5-flash'
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
              parts: [{
                text: [
                  options.systemPrompt?.trim() || 'Return plain text only.',
                  prompt,
                ].filter(Boolean).join('\n\n'),
              }],
            },
          ],
          generationConfig: {
            temperature: typeof options.temperature === 'number' ? options.temperature : 0.7,
          },
        }),
        timeoutMs: 60_000,
      },
    )

    const text = (response.candidates?.[0]?.content?.parts?.[0]?.text || '').trim()

    return {
      text: text || options.fallbackText?.trim() || '',
      tokenUsage: this.buildTokenUsage({
        inputTokens: response.usageMetadata?.promptTokenCount,
        outputTokens: response.usageMetadata?.candidatesTokenCount,
        totalTokens: response.usageMetadata?.totalTokenCount,
        model: response.modelVersion || model,
        prompt,
        completion: text,
      }),
      provider: 'gemini',
    }
  }

  private async generateTextWithOpenAi(
    prompt: string,
    metadata: Record<string, any>,
    options: {
      systemPrompt?: string
      temperature?: number
      fallbackText?: string
    } = {},
    modelOverride?: string,
  ): Promise<CopyTextLlmResult> {
    const apiKey = await this.resolveApiKey(
      metadata,
      OrgApiKeyProvider.OPENAI,
      ['MEDIACLAW_OPENAI_API_KEY', 'OPENAI_API_KEY'],
    )
    if (!apiKey) {
      return this.createEmptyTextLlmResult('heuristic', options.fallbackText)
    }

    const baseUrl = process.env['MEDIACLAW_OPENAI_BASE_URL']?.trim() || process.env['OPENAI_BASE_URL']?.trim() || 'https://api.openai.com/v1'
    const model = modelOverride?.trim()
      || process.env['MEDIACLAW_OPENAI_MODEL']?.trim()
      || process.env['OPENAI_MODEL']?.trim()
      || 'gpt-4o'
    const response = await this.requestJson<OpenAiResponse>(
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
            { role: 'system', content: options.systemPrompt?.trim() || 'Return plain text only.' },
            { role: 'user', content: prompt },
          ],
          temperature: typeof options.temperature === 'number' ? options.temperature : 0.7,
        }),
        timeoutMs: 60_000,
      },
    )

    const text = (response.choices?.[0]?.message?.content || '').trim()

    return {
      text: text || options.fallbackText?.trim() || '',
      tokenUsage: this.buildTokenUsage({
        inputTokens: response.usage?.prompt_tokens,
        outputTokens: response.usage?.completion_tokens,
        totalTokens: response.usage?.total_tokens,
        model: response.model || model,
        prompt,
        completion: text,
      }),
      provider: 'openai',
    }
  }

  private async resolveApiKey(
    metadata: Record<string, any>,
    provider: OrgApiKeyProvider,
    fallbackEnvName: string | readonly string[],
  ) {
    const orgId = this.readMetadataObjectId(metadata, 'orgId')
    if (this.byokService) {
      const key = await this.byokService.getProviderRuntimeKey(orgId, provider, fallbackEnvName)
      if (key) {
        return key
      }
    }

    const envNames = Array.isArray(fallbackEnvName) ? fallbackEnvName : [fallbackEnvName]
    for (const envName of envNames) {
      const value = process.env[envName]?.trim()
      if (value) {
        return value
      }
    }

    return ''
  }

  private fallbackEnvNames(provider: OrgApiKeyProvider) {
    switch (provider) {
      case OrgApiKeyProvider.DEEPSEEK:
        return ['MEDIACLAW_DEEPSEEK_API_KEY', 'DEEPSEEK_API_KEY'] as const
      case OrgApiKeyProvider.GEMINI:
        return ['MEDIACLAW_GEMINI_API_KEY', 'GEMINI_API_KEY'] as const
      case OrgApiKeyProvider.OPENAI:
        return ['MEDIACLAW_OPENAI_API_KEY', 'OPENAI_API_KEY'] as const
      case OrgApiKeyProvider.VCE:
        return ['VCE_GEMINI_API_KEY', 'MEDIACLAW_VCE_API_KEY'] as const
      case OrgApiKeyProvider.KLING:
        return ['KLING_API_KEY', 'MEDIACLAW_KLING_API_KEY'] as const
      case OrgApiKeyProvider.TIKHUB:
        return ['TIKHUB_API_KEY', 'MEDIACLAW_TIKHUB_API_KEY'] as const
      default:
        return [] as const
    }
  }

  private mapProviderEnum(provider: OrgApiKeyProvider): CopyProvider {
    switch (provider) {
      case OrgApiKeyProvider.DEEPSEEK:
        return 'deepseek'
      case OrgApiKeyProvider.GEMINI:
        return 'gemini'
      case OrgApiKeyProvider.OPENAI:
        return 'openai'
      default:
        return 'heuristic'
    }
  }

  private normalizeGeneratedCopy(input: {
    draft: GeneratedCopyDraft | null
    brandName: string
    scene: string
    toneKeywords: string[]
    avoidKeywords: string[]
    dedupDuplicate: boolean
    trendingBlueWords: string[]
    commentGuideWords: string[]
  }): GeneratedCopy {
    const heuristic = this.buildHeuristicCopy(
      input.brandName,
      input.scene,
      input.toneKeywords,
      input.avoidKeywords,
      {
        trendingBlueWords: input.trendingBlueWords,
        commentGuideWords: input.commentGuideWords,
      },
    )

    const titleBase = this.filterProhibitedText(this.coerceText(input.draft?.title) || heuristic.title, input.avoidKeywords)
      || heuristic.title
    const subtitleBase = this.filterProhibitedText(this.coerceText(input.draft?.subtitle) || heuristic.subtitle, input.avoidKeywords)
      || heuristic.subtitle
    const descriptionBase = this.filterProhibitedText(this.coerceText(input.draft?.description) || heuristic.description, input.avoidKeywords)
      || heuristic.description
    const hashtagsBase = this.coerceStringArray(input.draft?.hashtags)
    const blueWordsBase = this.coerceStringArray(input.draft?.blueWords)
    const commentGuidesBase = this.coerceCommentGuides(input.draft) || heuristic.commentGuides

    let title = this.filterProhibitedText(this.limitText(titleBase, 60), input.avoidKeywords)
      || heuristic.title
    if (input.dedupDuplicate) {
      title = this.generateABVariants(title, 1)[0] || title
    }

    const blueWordSeeds = this.filterProhibitedTerms(
      blueWordsBase.length > 0
        ? [...input.trendingBlueWords, ...blueWordsBase]
        : input.toneKeywords.length > 0
          ? [...input.trendingBlueWords, ...input.toneKeywords]
          : [...input.trendingBlueWords, input.brandName, input.scene],
      input.avoidKeywords,
    )
    const blueWordResult = this.generateBlueWords(
      title,
      blueWordSeeds.length > 0 ? blueWordSeeds : [input.brandName],
      {
        trendingWords: input.trendingBlueWords,
      },
    )
    const subtitle = this.normalizeSubtitle(subtitleBase, input.brandName, input.scene, input.avoidKeywords)
    const description = this.normalizeDescription(
      descriptionBase,
      input.brandName,
      input.scene,
      input.toneKeywords,
      input.avoidKeywords,
    )
    const hashtags = this.normalizeHashtags(
      hashtagsBase.length > 0 ? hashtagsBase : heuristic.hashtags,
      input.brandName,
      input.toneKeywords,
      blueWordResult.blueWords,
      input.avoidKeywords,
    )
    const commentGuides = this.normalizeCommentGuides(
      commentGuidesBase,
      input.brandName,
      description,
      input.avoidKeywords,
      {
        guideWords: input.commentGuideWords,
        trendingBlueWords: input.trendingBlueWords,
      },
    )

    return {
      title: blueWordResult.title,
      subtitle,
      description,
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
    options: CopyTrendSignals = {
      trendingBlueWords: [],
      commentGuideWords: [],
    },
  ): GeneratedCopy {
    const primaryTone = toneKeywords[0] || '品牌感'
    const titleSeed = `${brandName}${primaryTone}短视频`
    const blueWordSeeds = this.filterProhibitedTerms(
      toneKeywords.length > 0 ? toneKeywords : [brandName, scene],
      avoidKeywords,
    )
    const blueWordResult = this.generateBlueWords(
      titleSeed,
      blueWordSeeds.length > 0 ? blueWordSeeds : [brandName],
      {
        trendingWords: options.trendingBlueWords,
      },
    )
    const subtitle = this.normalizeSubtitle(
      `${scene}场景成片已生成，突出${toneKeywords.slice(0, 2).join('、') || '品牌识别度'}`,
      brandName,
      scene,
      avoidKeywords,
    )
    const description = this.normalizeDescription(
      `${brandName}${scene}发布版文案已同步生成，重点突出${toneKeywords.slice(0, 3).join('、') || '品牌亮点'}，可直接继续审核或分发。`,
      brandName,
      scene,
      toneKeywords,
      avoidKeywords,
    )
    const commentGuides = avoidKeywords.length > 0
      ? [
          '评论区建议围绕真实体验和使用反馈展开，避免绝对化表达。',
          `如果你也在做 ${scene}，留言“案例”我继续补充合规版本。`,
          `想看 ${brandName} 下一条更强转化还是更强种草？直接留言告诉我。`,
        ]
      : this.generateCommentGuides(brandName, description, {
          guideWords: options.commentGuideWords,
          trendingBlueWords: options.trendingBlueWords,
        })

    return {
      title: blueWordResult.title,
      subtitle,
      description,
      hashtags: this.buildHashtags(brandName, toneKeywords, blueWordResult.blueWords),
      blueWords: blueWordResult.blueWords,
      commentGuide: commentGuides.join('\n'),
      commentGuides,
    }
  }

  private normalizeSubtitle(subtitle: string, brandName: string, scene: string, avoidKeywords: string[]) {
    let normalized = this.filterProhibitedText(subtitle.trim(), avoidKeywords)
    if (!normalized) {
      normalized = `${brandName}${scene}场景成片已生成，品牌信息与节奏已同步优化。`
    }

    while (normalized.length < 15) {
      normalized = `${normalized}${brandName}`
    }

    return this.limitText(normalized, 60)
  }

  private normalizeDescription(
    description: string,
    brandName: string,
    scene: string,
    keywords: string[],
    avoidKeywords: string[],
  ) {
    let normalized = this.filterProhibitedText(description.trim(), avoidKeywords)
    if (!normalized) {
      normalized = `${brandName}${scene}发布版文案已同步整理，重点围绕${keywords.slice(0, 3).join('、') || '品牌亮点'}展开，可直接进入审核和分发。`
    }

    while (normalized.length < 30) {
      normalized = `${normalized}${brandName}发布节奏已同步。`
    }

    return this.limitText(normalized, 120)
  }

  private normalizeHashtags(
    hashtags: string[],
    brandName: string,
    keywords: string[],
    blueWords: string[],
    avoidKeywords: string[],
  ) {
    const normalized = [...new Set([
      ...hashtags,
      ...this.buildHashtags(brandName, keywords, blueWords),
    ]
      .map(item => this.toBlueWord(item))
      .filter(Boolean)
      .filter(item => !this.containsProhibitedKeyword(item, avoidKeywords)))]

    const fallback = this.buildHashtags(
      brandName,
      [...keywords, brandName, '内容创作', '发布文案'],
      blueWords,
    ).filter(item => !this.containsProhibitedKeyword(item, avoidKeywords))

    for (const item of fallback) {
      if (normalized.length >= 5) {
        break
      }

      if (!normalized.includes(item)) {
        normalized.push(item)
      }
    }

    return normalized.slice(0, Math.min(Math.max(normalized.length, 5), 10))
  }

  private normalizeCommentGuides(
    commentGuides: string[],
    brandName: string,
    content: string,
    avoidKeywords: string[],
    options: CommentGuideOptions = {},
  ) {
    const normalized = commentGuides
      .map(item => this.filterProhibitedText(item.trim(), avoidKeywords))
      .filter(Boolean)

    const fallback = this.generateCommentGuides(brandName, content, options)
    while (normalized.length < 3) {
      normalized.push(this.filterProhibitedText(fallback[normalized.length] || fallback[0], avoidKeywords))
    }

    return normalized.slice(0, 3)
  }

  private createEmptyLlmResult(provider: CopyProvider): CopyLlmResult {
    return {
      draft: null,
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        model: '',
        cost: 0,
      },
      provider,
    }
  }

  private createEmptyTextLlmResult(provider: CopyProvider, fallbackText?: string): CopyTextLlmResult {
    return {
      text: fallbackText?.trim() || '',
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        model: '',
        cost: 0,
      },
      provider,
    }
  }

  private buildTokenUsage(input: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
    model?: string
    cost?: number
    prompt?: string
    completion?: string
  }): CopyTokenUsage {
    let inputTokens = this.normalizeTokenCount(input.inputTokens)
    let outputTokens = this.normalizeTokenCount(input.outputTokens)
    const totalTokens = this.normalizeTokenCount(input.totalTokens)

    if (inputTokens <= 0 && input.prompt) {
      inputTokens = this.estimateTokenCount(input.prompt)
    }

    if (outputTokens <= 0 && input.completion) {
      outputTokens = this.estimateTokenCount(input.completion)
    }

    if (totalTokens > 0 && inputTokens <= 0) {
      inputTokens = Math.max(totalTokens - outputTokens, 0)
    }

    if (totalTokens > 0 && outputTokens <= 0) {
      outputTokens = Math.max(totalTokens - inputTokens, 0)
    }

    return {
      inputTokens,
      outputTokens,
      model: input.model?.trim() || '',
      cost: this.normalizeCost(input.cost),
    }
  }

  private estimateTokenCount(text: string) {
    const normalized = text.trim()
    if (!normalized) {
      return 0
    }

    return Math.max(1, Math.ceil(normalized.length / 4))
  }

  private normalizeTokenCount(value: unknown) {
    const normalized = Number(value || 0)
    if (!Number.isFinite(normalized) || normalized <= 0) {
      return 0
    }

    return Math.trunc(normalized)
  }

  private normalizeCost(value: unknown) {
    const normalized = Number(value || 0)
    if (!Number.isFinite(normalized) || normalized <= 0) {
      return 0
    }

    return Number(normalized.toFixed(6))
  }

  private async recordLlmUsage(
    result: Pick<CopyLlmResult, 'tokenUsage' | 'provider'> | Pick<CopyTextLlmResult, 'tokenUsage' | 'provider'>,
    metadata: Record<string, any>,
    brandId: string | null,
    source = 'copy-engine',
  ) {
    if (!this.usageService) {
      return
    }

    const userId = this.readMetadataObjectId(metadata, 'userId')
    if (!userId) {
      return
    }

    const hasTokenUsage = result.tokenUsage.inputTokens > 0 || result.tokenUsage.outputTokens > 0
    if (!hasTokenUsage && result.provider === 'heuristic') {
      return
    }

    try {
      await this.usageService.recordTokenUsage(
        userId,
        this.readMetadataObjectId(metadata, 'orgId'),
        UsageHistoryType.COPY_GENERATION,
        result.tokenUsage,
        {
          taskId: this.readMetadataObjectId(metadata, 'taskId'),
          brandId,
          provider: result.provider,
          source,
        },
      )
    }
    catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown token usage error'
      this.logger.warn(`记录文案 token 用量失败: ${message}`)
    }
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
      .sort({ 'performance.views': -1, 'performance.ctr': -1, 'createdAt': -1 })
      .limit(5)
      .lean()
      .exec()

    return history.map(item => ({
      title: item.title || '',
      subtitle: item.subtitle || '',
      description: item.description || '',
      hashtags: item.hashtags || [],
    }))
  }

  private async getCopyTrendSignals(orgId: string): Promise<CopyTrendSignals> {
    if (!Types.ObjectId.isValid(orgId)) {
      return {
        trendingBlueWords: [],
        commentGuideWords: [],
      }
    }

    const history = await this.copyHistoryModel.find({
      orgId: new Types.ObjectId(orgId),
    })
      .sort({ 'variantPerformance.score': -1, 'performance.views': -1, 'performance.ctr': -1, createdAt: -1 })
      .limit(200)
      .lean()
      .exec() as Array<Record<string, any>>

    const blueWordScores = new Map<string, number>()
    const commentGuideWordScores = new Map<string, number>()

    for (const item of history) {
      const weight = this.resolveTrendWeight(item)
      const blueWordCandidates = this.mergeUniqueStrings(
        this.readStringArray(item['blueWords']).map(candidate => candidate.replace(/^#+/, '')),
        this.readStringArray(item['hashtags']).map(candidate => candidate.replace(/^#+/, '')),
      )

      for (const candidate of blueWordCandidates) {
        const normalized = candidate.replace(/^#+/, '').trim()
        if (!normalized || this.isGenericBlueWord(normalized)) {
          continue
        }

        blueWordScores.set(
          normalized,
          Number((blueWordScores.get(normalized) || 0) + weight),
        )
      }

      const guideSources = this.mergeUniqueStrings(
        this.readStringArray(item['commentGuides']),
        this.readString(item['commentGuide'])
          .split(/\n|[|；;]+/g)
          .map(candidate => candidate.trim())
          .filter(Boolean),
      )
      const guideWords = this.extractCommentGuideWords(guideSources)
      for (const word of guideWords) {
        commentGuideWordScores.set(
          word,
          Number((commentGuideWordScores.get(word) || 0) + weight),
        )
      }
    }

    return {
      trendingBlueWords: this.pickTopWeightedTerms(blueWordScores, 5).map(item => this.toBlueWord(item)),
      commentGuideWords: this.pickTopWeightedTerms(commentGuideWordScores, 6),
    }
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
      '#内容创作',
    ].filter(Boolean))].slice(0, 10)
  }

  private toBlueWord(value: string) {
    const normalizedValue = value.replace(/^#+/, '').replace(/\s+/g, '')
    return normalizedValue ? `#${normalizedValue}` : ''
  }

  private limitText(value: string, maxLength: number) {
    return value.trim().slice(0, maxLength)
  }

  private async recordCopyHistory(
    payload: CopyHistoryPayload,
    options: CopyHistoryWriteOptions = {},
  ) {
    if (!payload.orgId || !Types.ObjectId.isValid(payload.orgId)) {
      return null
    }

    const baseDocument = {
      orgId: new Types.ObjectId(payload.orgId),
      taskId: payload.taskId && Types.ObjectId.isValid(payload.taskId)
        ? new Types.ObjectId(payload.taskId)
        : null,
      title: payload.title,
      subtitle: payload.subtitle,
      description: payload.description,
      hashtags: payload.hashtags,
      blueWords: payload.blueWords,
      commentGuide: payload.commentGuide,
      commentGuides: payload.commentGuides,
      variantIndex: payload.variantIndex ?? null,
      variantGroupId: payload.variantGroupId?.trim() || '',
      variantGoal: payload.variantGoal?.trim() || '',
      dedupFingerprint: payload.dedupFingerprint || this.buildDedupFingerprint(payload),
      variantPerformance: {
        score: 0,
        bestPerformer: false,
      },
      performance: {
        views: 0,
        clicks: 0,
        ctr: 0,
      },
    }

    if (options.replaceExistingForTask && baseDocument.taskId) {
      return this.copyHistoryModel.findOneAndUpdate(
        { taskId: baseDocument.taskId },
        { $set: baseDocument },
        { upsert: true, new: true },
      ).exec()
    }

    return this.copyHistoryModel.create(baseDocument)
  }

  private buildRewritePrompt(
    copyHistory: Pick<CopyHistory, 'title' | 'subtitle' | 'description' | 'hashtags' | 'blueWords' | 'commentGuide'>,
    instructions?: string,
    metadata: Record<string, any> = {},
  ) {
    const normalizedInstructions = instructions?.trim()
      || '加强开头钩子、互动感和平台适配度，同时保留原有主题。'
    const platform = this.readMetadataString(metadata, 'platform')
    const style = this.readMetadataString(metadata, 'style')

    return [
      '你是 MediaClaw 的短视频文案改写引擎，只能输出 JSON。',
      '输出字段必须包含: title, subtitle, description, hashtags, blueWords, commentGuides。',
      `当前标题: ${copyHistory.title || '无'}`,
      `当前字幕: ${copyHistory.subtitle || '无'}`,
      `当前正文: ${copyHistory.description || '无'}`,
      `当前 hashtags: ${(copyHistory.hashtags || []).join(' ') || '无'}`,
      `当前 blueWords: ${(copyHistory.blueWords || []).join(' ') || '无'}`,
      `当前评论引导: ${(copyHistory.commentGuide || '').replace(/\n/g, ' | ') || '无'}`,
      platform ? `目标平台: ${platform}` : '',
      style ? `期望风格: ${style}` : '',
      `改写要求: ${normalizedInstructions}`,
      '保持主题不跑偏，优化表达效率、互动感和可发布度，并确保禁用词不会出现在任何字段。',
    ].filter(Boolean).join('\n')
  }

  private buildBrandKeywords(brand: Brand | null) {
    if (!brand) {
      return []
    }

    return [
      ...(brand.assets?.keywords || []),
      ...(brand.assets?.slogans || []),
      brand.industry || '',
      brand.name || '',
    ]
      .map(item => item.trim())
      .filter(Boolean)
  }

  private filterProhibitedTerms(terms: string[], avoidKeywords: string[]) {
    return [...new Set(
      terms
        .map(item => item.trim())
        .filter(Boolean)
        .filter(item => !this.containsProhibitedKeyword(item, avoidKeywords)),
    )]
  }

  private filterProhibitedText(text: string, avoidKeywords: string[]) {
    let normalized = text.trim()
    if (!normalized || avoidKeywords.length === 0) {
      return normalized
    }

    for (const keyword of avoidKeywords) {
      const safeKeyword = keyword.trim()
      if (!safeKeyword) {
        continue
      }

      normalized = normalized.replace(new RegExp(this.escapeRegex(safeKeyword), 'gi'), '')
    }

    return normalized
      .replace(/\s{2,}/g, ' ')
      .replace(/[，。！？；、,.!?;:\s]+$/g, '')
      .trim()
  }

  private containsProhibitedKeyword(value: string, avoidKeywords: string[]) {
    const normalized = value.trim().toLowerCase()
    if (!normalized) {
      return false
    }

    return avoidKeywords.some((keyword) => {
      const safeKeyword = keyword.trim().toLowerCase()
      return safeKeyword ? normalized.includes(safeKeyword) : false
    })
  }

  private async ensureDistinctFromRecentHistory(
    orgId: string,
    copy: GeneratedCopy,
    options: {
      brandName: string
      scene: string
      toneKeywords: string[]
      avoidKeywords: string[]
      trendingBlueWords: string[]
      commentGuideWords: string[]
    },
  ) {
    const initialCheck = await this.checkDedupHistory(orgId, copy)
    if (!initialCheck.isDuplicate) {
      return {
        copy,
        dedupFingerprint: initialCheck.fingerprint,
      }
    }

    const diversified = this.diversifyDuplicateCopy(copy, initialCheck.matches, options)
    const secondCheck = await this.checkDedupHistory(orgId, diversified)

    return {
      copy: diversified,
      dedupFingerprint: secondCheck.fingerprint || this.buildDedupFingerprint(diversified),
    }
  }

  private diversifyDuplicateCopy(
    copy: GeneratedCopy,
    matches: Array<{ title: string, subtitle: string }>,
    options: {
      brandName: string
      scene: string
      toneKeywords: string[]
      avoidKeywords: string[]
      trendingBlueWords: string[]
      commentGuideWords: string[]
    },
  ): GeneratedCopy {
    const matchTitles = matches.map(item => item.title)
    const variantTitle = this.generateABVariants(copy.title, 3)
      .find(candidate => !matchTitles.some(title =>
        this.calculateTextSimilarity(
          this.normalizeFingerprintText(candidate),
          this.normalizeFingerprintText(title),
        ) >= 0.9,
      ))
      || `${copy.title}，换个打法继续放大结果`
    const subtitle = this.normalizeSubtitle(
      `换个角度拆 ${options.scene}，${copy.subtitle}`,
      options.brandName,
      options.scene,
      options.avoidKeywords,
    )
    const description = this.normalizeDescription(
      `${copy.description} 这次改成 ${options.scene} 的落地版本，避免与历史文案重复。`,
      options.brandName,
      options.scene,
      options.toneKeywords,
      options.avoidKeywords,
    )
    const blueWordResult = this.generateBlueWords(
      variantTitle,
      this.mergeUniqueStrings(
        options.trendingBlueWords,
        copy.blueWords.map(item => item.replace(/^#+/, '')),
      ),
      {
        trendingWords: options.trendingBlueWords,
      },
    )
    const commentGuides = this.normalizeCommentGuides(
      copy.commentGuides,
      options.brandName,
      description,
      options.avoidKeywords,
      {
        guideWords: options.commentGuideWords,
        trendingBlueWords: options.trendingBlueWords,
      },
    )

    return {
      title: blueWordResult.title,
      subtitle,
      description,
      hashtags: this.normalizeHashtags(
        this.mergeUniqueStrings(copy.hashtags, options.trendingBlueWords),
        options.brandName,
        this.mergeUniqueStrings(options.toneKeywords, options.trendingBlueWords),
        blueWordResult.blueWords,
        options.avoidKeywords,
      ),
      blueWords: blueWordResult.blueWords,
      commentGuide: commentGuides.join('\n'),
      commentGuides,
    }
  }

  private buildDedupFingerprint(
    content: string | { title?: string, subtitle?: string, description?: string },
  ) {
    const normalized = typeof content === 'string'
      ? content
      : [content.title, content.subtitle, content.description]
          .map(item => this.readString(item))
          .filter(Boolean)
          .join(' ')

    return this.normalizeFingerprintText(normalized).slice(0, 240)
  }

  private normalizeFingerprintText(text: string) {
    return text
      .trim()
      .toLowerCase()
      .replace(/#[^\s#]+/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, '')
  }

  private calculateTextSimilarity(left: string, right: string) {
    if (!left || !right) {
      return 0
    }

    if (left === right) {
      return 1
    }

    const leftBigrams = this.buildBigrams(left)
    const rightBigrams = this.buildBigrams(right)
    if (leftBigrams.length === 0 || rightBigrams.length === 0) {
      return 0
    }

    const rightCount = new Map<string, number>()
    for (const token of rightBigrams) {
      rightCount.set(token, (rightCount.get(token) || 0) + 1)
    }

    let overlap = 0
    for (const token of leftBigrams) {
      const count = rightCount.get(token) || 0
      if (count > 0) {
        overlap += 1
        rightCount.set(token, count - 1)
      }
    }

    return (2 * overlap) / (leftBigrams.length + rightBigrams.length)
  }

  private buildBigrams(text: string) {
    const normalized = text.trim()
    if (normalized.length < 2) {
      return normalized ? [normalized] : []
    }

    const bigrams: string[] = []
    for (let index = 0; index < normalized.length - 1; index += 1) {
      bigrams.push(normalized.slice(index, index + 2))
    }

    return bigrams
  }

  private resolveTrendWeight(item: Record<string, any>) {
    const views = Number(item['performance']?.['views'] || 0)
    const ctr = Number(item['performance']?.['ctr'] || 0)
    const variantScore = Number(item['variantPerformance']?.['score'] || 0)
    const bestPerformer = Boolean(item['variantPerformance']?.['bestPerformer'])

    return Number((
      1
      + Math.min(Math.log10(views + 1), 5)
      + (ctr * 20)
      + (variantScore / 10)
      + (bestPerformer ? 1.5 : 0)
    ).toFixed(4))
  }

  private pickTopWeightedTerms(weightMap: Map<string, number>, limit: number) {
    return [...weightMap.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, limit)
      .map(item => item[0])
  }

  private extractCommentGuideWords(values: string[]) {
    const words = new Set<string>()
    const fallbacks = ['模板', '案例', '链接', '清单', '脚本', '方法']

    for (const value of values) {
      const normalized = value.trim()
      if (!normalized) {
        continue
      }

      for (const match of normalized.matchAll(/[“"']([^”"'\n]{1,8})[”"']/g)) {
        const candidate = this.readString(match[1])
        if (candidate) {
          words.add(candidate)
        }
      }

      for (const match of normalized.matchAll(/(?:留言|评论|回复|回|私信)\s*[“"']?([\p{L}\p{N}]{1,8})/gu)) {
        const candidate = this.readString(match[1])
        if (candidate) {
          words.add(candidate)
        }
      }
    }

    for (const fallback of fallbacks) {
      if (words.size >= 6) {
        break
      }

      words.add(fallback)
    }

    return [...words]
  }

  private isGenericBlueWord(value: string) {
    return ['短视频', '品牌营销', '内容增长', '内容创作'].includes(value)
  }

  private normalizeVariantIndex(value: unknown) {
    const normalized = Number(value)
    if (!Number.isFinite(normalized) || normalized <= 0) {
      return null
    }

    return Math.trunc(normalized)
  }

  private resolveStyleGuide(style: string) {
    switch (style.trim().toLowerCase()) {
      case '种草':
      case 'grass-seeding':
      case 'recommendation':
        return '像真人经验分享，强调真实体验、轻决策和收藏欲。'
      case '测评':
      case 'review':
        return '突出对比、结果和判断依据，语气客观但有结论。'
      case '促销':
      case 'promotion':
        return '强调利益点、限时感和转化动作，但不要硬广堆砌。'
      case '品牌故事':
      case 'brand_story':
      case 'brand-story':
        return '突出品牌理念、情绪价值和长期记忆点，表达更有叙事感。'
      default:
        return style.trim() ? `保持${style.trim()}的表达气质和平台适配。` : ''
    }
  }

  private escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  private readMetadataString(metadata: Record<string, any>, key: string) {
    const value = metadata[key]
    return typeof value === 'string' ? value.trim() : ''
  }

  private readMetadataObjectId(metadata: Record<string, any>, key: string) {
    return this.normalizeObjectIdString(metadata[key])
  }

  private readMetadataStringArray(metadata: Record<string, any>, key: string) {
    const value = metadata[key]
    if (!Array.isArray(value)) {
      return []
    }

    return value
      .map(item => typeof item === 'string' ? item.trim() : '')
      .filter(Boolean)
  }

  private asRecord(value: unknown): Record<string, any> | null {
    if (!value || Array.isArray(value) || typeof value !== 'object') {
      return null
    }

    return value as Record<string, any>
  }

  private readString(value: unknown) {
    return typeof value === 'string' ? value.trim() : ''
  }

  private readStringArray(value: unknown) {
    if (!Array.isArray(value)) {
      return []
    }

    return value
      .map(item => this.readString(item))
      .filter(Boolean)
  }

  private mergeUniqueStrings(primary: string[], secondary: string[]) {
    return [...new Set(
      [...primary, ...secondary]
        .map(item => this.readString(item))
        .filter(Boolean),
    )]
  }

  private normalizeObjectIdString(value: unknown) {
    if (!value) {
      return null
    }

    if (typeof value === 'string') {
      return Types.ObjectId.isValid(value) ? value : null
    }

    if (value instanceof Types.ObjectId) {
      return value.toString()
    }

    if (typeof (value as { toString?: () => string }).toString === 'function') {
      const normalized = (value as { toString: () => string }).toString()
      return Types.ObjectId.isValid(normalized) ? normalized : null
    }

    return null
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
