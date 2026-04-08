import { AIMessage, BaseMessage } from '@langchain/core/messages'
import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { MultiServerMCPClient } from '@langchain/mcp-adapters'
import { Injectable, Logger } from '@nestjs/common'
import { AccountType, AppException, CreditsType, ResponseCode, UserType } from '@yikart/common'
import { CreditsHelperService } from '@yikart/helpers'
import { AiLogChannel, AiLogRepository, AiLogStatus, AiLogType, BrandRepository, Material, MaterialAdaptationRepository, MaterialRepository, PipelineRepository, VideoTaskRepository } from '@yikart/mongodb'
import { createAgent } from 'langchain'
import { Types } from 'mongoose'
import { config } from '../../config'
import { calculatePricingPoints, ChatPricing, TokenUsageDetails } from '../ai/pricing/pricing-calculator'
import { buildConfigOnlySchema, buildDynamicOutputSchema, buildStyleDrivenPlatformOptions, checkPlatformLimits, PLATFORM_RESTRICTIONS, PLATFORMS_REQUIRING_CONFIG, resolvePipelineStyleGuide } from './material-adaptation.constants'
import { AdaptMaterialDto, PlatformOptions, UpdateMaterialAdaptationDto } from './material-adaptation.dto'
import { MaterialAdaptationVo } from './material-adaptation.vo'

interface AdaptationBrandContext {
  id: string
  name: string
  industry: string
  logoUrl: string
  colors: string[]
  fonts: string[]
  slogans: string[]
  keywords: string[]
  prohibitedWords: string[]
  referenceImages: string[]
  preferredDuration: number | null
  aspectRatio: string
  subtitleStyle: Record<string, unknown>
  referenceVideoUrl: string
}

interface AdaptationPipelineContext {
  id: string
  name: string
  type: string
  description: string
  preferredDuration: number | null
  aspectRatio: string
  tone: string
  visualStyle: string
  preferredStyles: string[]
  avoidStyles: string[]
  subtitlePreferences: Record<string, unknown>
  styleRewrite: Record<string, unknown>
  brandAssets: {
    logo: string
    colors: string[]
    fonts: string[]
  }
  warmUpStatus: string
}

interface AdaptationCopyContext {
  copyStyle: string
  copyModel: string
}

interface AdaptationContextSnapshot {
  brand: AdaptationBrandContext | null
  pipeline: AdaptationPipelineContext | null
  copy: AdaptationCopyContext | null
}

@Injectable()
export class MaterialAdaptationService {
  private readonly logger = new Logger(MaterialAdaptationService.name)

  constructor(
    private readonly brandRepository: BrandRepository,
    private readonly pipelineRepository: PipelineRepository,
    private readonly videoTaskRepository: VideoTaskRepository,
    private readonly materialRepository: MaterialRepository,
    private readonly materialAdaptationRepository: MaterialAdaptationRepository,
    private readonly creditsHelper: CreditsHelperService,
    private readonly aiLogRepo: AiLogRepository,
  ) { }

  private async createMcpClient(headers: Record<string, string>) {
    const client = new MultiServerMCPClient({
      publish: {
        transport: 'http',
        url: `${config.serverClient.baseUrl}/publish/mcp`,
        headers,
      },
    })
    return client
  }

  async adaptMaterial(dto: AdaptMaterialDto, headers?: Record<string, string>): Promise<MaterialAdaptationVo[]> {
    const material = await this.materialRepository.getInfo(dto.materialId)
    if (!material) {
      throw new AppException(ResponseCode.MaterialNotFound)
    }

    const materialOptions = this.extractPlatformOptions(material.option)
    const context = await this.resolveAdaptationContext(material, dto)
    const useContextualRewrite = this.shouldUseContextualRewrite(context)

    const existingAdaptations = dto.forceRegenerate
      ? []
      : await this.materialAdaptationRepository.listByMaterialId(dto.materialId)
    const existingPlatformMap = new Map(existingAdaptations.map(a => [a.platform, a]))

    const platformsToGenerate = [...new Set(dto.platforms)].filter(p => dto.forceRegenerate || !existingPlatformMap.has(p))

    if (platformsToGenerate.length === 0) {
      return dto.platforms.map(p => MaterialAdaptationVo.create(existingPlatformMap.get(p)!))
    }

    if (useContextualRewrite) {
      this.logger.debug(
        {
          materialId: dto.materialId,
          platformsToGenerate,
          brandId: context.brand?.id || null,
          pipelineId: context.pipeline?.id || null,
          forceRegenerate: dto.forceRegenerate,
        },
        'Adapting material with brand and pipeline context',
      )

      const rewrittenResults = await this.handleNonCompliantPlatforms(
        material,
        platformsToGenerate,
        materialOptions,
        headers,
        context,
      )

      const contextualMap = new Map(rewrittenResults.map(item => [item.platform, item]))
      return dto.platforms.map((platform) => {
        const existing = existingPlatformMap.get(platform)
        if (existing) {
          return MaterialAdaptationVo.create(existing)
        }

        const result = contextualMap.get(platform)
        if (!result) {
          throw new AppException(ResponseCode.MaterialAdaptationFailed, { platform })
        }
        return result
      })
    }

    // 按限制符合性分类
    const { compliantPlatforms, nonCompliantPlatforms } = this.categorizeByCompliance(
      material,
      platformsToGenerate,
    )

    this.logger.debug(
      { materialId: dto.materialId, compliantPlatforms, nonCompliantPlatforms },
      'Categorized platforms by compliance',
    )

    const results = new Map<string, MaterialAdaptationVo>()

    // 处理符合限制的平台（只需生成配置，不需要转换内容）
    if (compliantPlatforms.length > 0) {
      const compliantResults = await this.handleCompliantPlatforms(
        material,
        compliantPlatforms,
        materialOptions,
        headers,
        context,
      )
      compliantResults.forEach(r => results.set(r.platform, r))
    }

    // 处理不符合限制的平台
    if (nonCompliantPlatforms.length > 0) {
      const nonCompliantResults = await this.handleNonCompliantPlatforms(
        material,
        nonCompliantPlatforms,
        materialOptions,
        headers,
        context,
      )
      nonCompliantResults.forEach(r => results.set(r.platform, r))
    }

    // 合并结果
    return dto.platforms.map((p) => {
      const existing = existingPlatformMap.get(p)
      if (existing) {
        return MaterialAdaptationVo.create(existing)
      }
      const result = results.get(p)
      if (!result) {
        throw new AppException(ResponseCode.MaterialAdaptationFailed, { platform: p })
      }
      return result
    })
  }

  /**
   * 按限制符合性分类平台
   */
  private categorizeByCompliance(
    material: Material,
    platforms: AccountType[],
  ): { compliantPlatforms: AccountType[], nonCompliantPlatforms: AccountType[] } {
    const content = {
      title: material.title,
      desc: material.desc,
      topics: material.topics,
    }

    const compliantPlatforms: AccountType[] = []
    const nonCompliantPlatforms: AccountType[] = []

    for (const platform of platforms) {
      if (checkPlatformLimits(platform, content)) {
        compliantPlatforms.push(platform)
      }
      else {
        nonCompliantPlatforms.push(platform)
      }
    }

    return { compliantPlatforms, nonCompliantPlatforms }
  }

  /**
   * 处理符合限制的平台：内容直接复制，必要时生成配置
   */
  private async handleCompliantPlatforms(
    material: Material,
    platforms: AccountType[],
    materialOptions: PlatformOptions | undefined,
    headers?: Record<string, string>,
    context?: AdaptationContextSnapshot,
  ): Promise<MaterialAdaptationVo[]> {
    // 检查哪些平台需要 AI 生成配置
    const platformsNeedingConfig = platforms.filter(p => PLATFORMS_REQUIRING_CONFIG.includes(p))

    let configResults: Record<string, Record<string, unknown>> = {}
    if (platformsNeedingConfig.length > 0) {
      configResults = await this.generateConfigsOnly(material, platformsNeedingConfig, headers, context)
    }

    // 存储结果
    const results: MaterialAdaptationVo[] = []
    for (const platform of platforms) {
      const platformOptionsResult = this.mergePlatformOptions(
        platform,
        material,
        context,
        materialOptions,
        configResults[platform as string],
      )

      const saved = await this.materialAdaptationRepository.upsertByMaterialIdAndPlatform(
        material.id,
        material.userId,
        platform,
        {
          title: material.title,
          desc: material.desc,
          topics: material.topics || [],
          platformOptions: platformOptionsResult,
        },
      )
      results.push(MaterialAdaptationVo.create(saved))
    }
    return results
  }

  /**
   * 只生成配置（简化的 AI 调用）
   */
  private async generateConfigsOnly(
    material: Material,
    platforms: AccountType[],
    headers?: Record<string, string>,
    context?: AdaptationContextSnapshot,
  ): Promise<Record<string, Record<string, unknown>>> {
    const mcpClient = await this.createMcpClient(headers || {})
    const modelName = 'gemini-3-flash-preview'
    const startedAt = new Date()

    try {
      const tools = (await mcpClient.getTools()).filter((tool) => {
        return ['getYoutubeContentCategories', 'getBilibiliContentCategories'].includes(tool.getName())
      })

      const model = new ChatGoogleGenerativeAI({
        model: modelName,
        apiKey: config.ai.gemini.apiKey,
        baseUrl: config.ai.gemini.baseUrl,
      })

      // 只生成配置的 schema
      const configSchema = buildConfigOnlySchema(platforms)

      const agent = createAgent({
        model,
        tools,
        responseFormat: configSchema,
      })

      const prompt = this.buildConfigOnlyPrompt(material, platforms, context)

      this.logger.debug({ materialId: material.id, platforms }, 'Generating configs only with MCP tools')

      const response = await agent.invoke({
        messages: [prompt],
      })

      this.logger.debug({ messages: response.messages }, 'Configs generated successfully')

      // 记录用量和扣费
      const usage = this.extractUsageFromMessages(response.messages)
      const pricing = this.getModelPricing(modelName)
      if (pricing) {
        const points = calculatePricingPoints(pricing, usage)
        const duration = Date.now() - startedAt.getTime()

        await this.creditsHelper.deductCredits({
          userId: material.userId,
          amount: points,
          type: CreditsType.AiService,
          description: 'Material Adaptation (Config Only)',
          metadata: {
            materialId: material.id,
            platforms,
            configOnly: true,
            brandId: context?.brand?.id || null,
            pipelineId: context?.pipeline?.id || null,
          },
        })

        await this.aiLogRepo.create({
          userId: material.userId,
          userType: UserType.User,
          type: AiLogType.Agent,
          model: modelName,
          channel: AiLogChannel.Gemini,
          startedAt,
          duration,
          points,
          request: {
            materialId: material.id,
            platforms,
            configOnly: true,
            brandId: context?.brand?.id || null,
            pipelineId: context?.pipeline?.id || null,
          },
          response: response.structuredResponse,
          status: AiLogStatus.Success,
        })
      }

      // 提取配置结果
      const result: Record<string, Record<string, unknown>> = {}
      for (const platform of platforms) {
        const platformResult = response.structuredResponse[platform]
        if (platformResult?.option) {
          result[platform] = platformResult.option
        }
      }
      return result
    }
    catch (error) {
      this.logger.error({ error, materialId: material.id, platforms }, 'Failed to generate configs')

      await this.aiLogRepo.create({
        userId: material.userId,
        userType: UserType.User,
        type: AiLogType.Agent,
        model: modelName,
        channel: AiLogChannel.Gemini,
        startedAt,
        duration: Date.now() - startedAt.getTime(),
        points: 0,
        request: {
          materialId: material.id,
          platforms,
          configOnly: true,
          brandId: context?.brand?.id || null,
          pipelineId: context?.pipeline?.id || null,
        },
        response: undefined,
        status: AiLogStatus.Failed,
      })

      throw new AppException(ResponseCode.MaterialAdaptationFailed)
    }
    finally {
      await mcpClient.close()
    }
  }

  /**
   * 构建只生成配置的 prompt
   */
  private buildConfigOnlyPrompt(
    material: Material,
    platforms: AccountType[],
    context?: AdaptationContextSnapshot,
  ): string {
    const optionRulesText = this.buildOptionRulesText(platforms, material, context)

    return `
## 任务
根据以下内容，为指定平台生成合适的发布配置。

## 原始内容
- 标题: ${material.title || '(无标题)'}
- 描述: ${material.desc || '(无描述)'}
- 话题: ${material.topics?.join(', ') || '(无话题)'}

## 目标平台
${platforms.join(', ')}

${this.buildContextPromptSections(material, context)}

## 配置要求
${optionRulesText}

注意：只需要生成平台配置（option），不需要转换内容。
`
  }

  /**
   * 处理不符合限制的平台：完整 AI 转换
   */
  private async handleNonCompliantPlatforms(
    material: Material,
    platforms: AccountType[],
    materialOptions: PlatformOptions | undefined,
    headers?: Record<string, string>,
    context?: AdaptationContextSnapshot,
  ): Promise<MaterialAdaptationVo[]> {
    const mcpClient = await this.createMcpClient(headers || {})
    const modelName = 'gemini-3-flash-preview'
    const startedAt = new Date()

    try {
      const tools = (await mcpClient.getTools()).filter((tool) => {
        return ['getYoutubeContentCategories', 'getBilibiliContentCategories', 'publishRestrictions'].includes(tool.getName())
      })

      const model = new ChatGoogleGenerativeAI({
        model: modelName,
        apiKey: config.ai.gemini.apiKey,
        baseUrl: config.ai.gemini.baseUrl,
      })

      const outputSchema = buildDynamicOutputSchema(platforms)

      const agent = createAgent({
        model,
        tools,
        responseFormat: outputSchema,
      })

      const prompt = this.buildAdaptationPrompt(material, platforms, context)

      this.logger.debug({ materialId: material.id, platforms }, 'Adapting material with MCP tools')

      const response = await agent.invoke({
        messages: [prompt],
      })

      this.logger.debug({ messages: response.messages }, 'Material adapted successfully')

      const usage = this.extractUsageFromMessages(response.messages)
      const pricing = this.getModelPricing(modelName)
      if (pricing) {
        const points = calculatePricingPoints(pricing, usage)
        const duration = Date.now() - startedAt.getTime()

        await this.creditsHelper.deductCredits({
          userId: material.userId,
          amount: points,
          type: CreditsType.AiService,
          description: 'Material Adaptation',
          metadata: {
            materialId: material.id,
            platforms,
            brandId: context?.brand?.id || null,
            pipelineId: context?.pipeline?.id || null,
          },
        })

        await this.aiLogRepo.create({
          userId: material.userId,
          userType: UserType.User,
          type: AiLogType.Agent,
          model: modelName,
          channel: AiLogChannel.Gemini,
          startedAt,
          duration,
          points,
          request: {
            materialId: material.id,
            platforms,
            brandId: context?.brand?.id || null,
            pipelineId: context?.pipeline?.id || null,
          },
          response: response.structuredResponse,
          status: AiLogStatus.Success,
        })
      }

      const result = response.structuredResponse

      const results: MaterialAdaptationVo[] = []
      for (const platform of platforms) {
        const platformResult = result[platform]

        const platformOptionsResult = this.mergePlatformOptions(
          platform,
          material,
          context,
          materialOptions,
          platformResult?.option,
        )

        const adaptation = await this.materialAdaptationRepository.upsertByMaterialIdAndPlatform(
          material.id,
          material.userId,
          platform,
          {
            title: platformResult?.title,
            desc: platformResult?.desc,
            topics: platformResult?.topics || [],
            platformOptions: platformOptionsResult,
          },
        )
        results.push(MaterialAdaptationVo.create(adaptation))
      }

      return results
    }
    catch (error) {
      this.logger.error({ error, materialId: material.id, platforms }, 'Failed to adapt material')

      await this.aiLogRepo.create({
        userId: material.userId,
        userType: UserType.User,
        type: AiLogType.Agent,
        model: modelName,
        channel: AiLogChannel.Gemini,
        startedAt,
        duration: Date.now() - startedAt.getTime(),
        points: 0,
        request: {
          materialId: material.id,
          platforms,
          brandId: context?.brand?.id || null,
          pipelineId: context?.pipeline?.id || null,
        },
        response: undefined,
        status: AiLogStatus.Failed,
      })

      throw new AppException(ResponseCode.MaterialAdaptationFailed)
    }
    finally {
      await mcpClient.close()
    }
  }

  private mergePlatformOptions(
    platform: string,
    material: Material,
    context?: AdaptationContextSnapshot,
    existingOptions?: PlatformOptions,
    aiGeneratedOption?: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    const platformKey = platform.toLowerCase() as keyof PlatformOptions
    const existingOption = existingOptions?.[platformKey]
    const styleDrivenOption = buildStyleDrivenPlatformOptions({
      platform,
      materialType: material.type === 'video' ? 'video' : 'article',
      aspectRatio: this.resolvePreferredAspectRatio(context),
      preferredDuration: this.resolvePreferredDuration(context),
      preferredStyles: this.resolvePreferredStyles(context),
      pipelineType: context?.pipeline?.type,
    })

    const mergedOption = {
      ...styleDrivenOption,
      ...aiGeneratedOption,
      ...existingOption,
    }

    if (platform === AccountType.TIKTOK) {
      return {
        tiktok: {
          ...mergedOption,
          comment_disabled: false,
          duet_disabled: false,
          stitch_disabled: false,
        },
      }
    }

    if (Object.keys(mergedOption).length > 0) {
      return { [platformKey]: mergedOption }
    }

    return undefined
  }

  async updateByMaterialIdAndPlatform(
    userId: string,
    materialId: string,
    platform: string,
    dto: UpdateMaterialAdaptationDto,
  ): Promise<MaterialAdaptationVo> {
    const existing = await this.materialAdaptationRepository.getByMaterialIdAndPlatform(materialId, platform)
    if (!existing || existing.userId !== userId) {
      throw new AppException(ResponseCode.MaterialAdaptationNotFound)
    }

    const updated = await this.materialAdaptationRepository.updateByMaterialIdAndPlatform(materialId, platform, dto)
    return MaterialAdaptationVo.create(updated!)
  }

  async deleteByMaterialIdAndPlatform(userId: string, materialId: string, platform: string): Promise<void> {
    const existing = await this.materialAdaptationRepository.getByMaterialIdAndPlatform(materialId, platform)
    if (!existing || existing.userId !== userId) {
      throw new AppException(ResponseCode.MaterialAdaptationNotFound)
    }

    await this.materialAdaptationRepository.deleteByMaterialIdAndPlatform(materialId, platform)
  }

  async deleteManyByMaterialId(userId: string, materialId: string): Promise<void> {
    const material = await this.materialRepository.getInfo(materialId)
    if (!material || material.userId !== userId) {
      throw new AppException(ResponseCode.MaterialNotFound)
    }

    await this.materialAdaptationRepository.deleteManyByMaterialId(materialId)
  }

  async getByMaterialIdAndPlatform(
    materialId: string,
    platform: AccountType,
    headers: Record<string, string>,
    input?: Pick<AdaptMaterialDto, 'brandId' | 'pipelineId' | 'forceRegenerate'>,
  ): Promise<MaterialAdaptationVo> {
    const existing = input?.forceRegenerate
      ? null
      : await this.materialAdaptationRepository.getByMaterialIdAndPlatform(materialId, platform)
    if (existing && !input?.forceRegenerate) {
      return MaterialAdaptationVo.create(existing)
    }

    const adaptations = await this.adaptMaterial({
      materialId,
      platforms: [platform],
      brandId: input?.brandId,
      pipelineId: input?.pipelineId,
      forceRegenerate: input?.forceRegenerate ?? false,
    }, headers)
    return adaptations[0]
  }

  async listByMaterialId(materialId: string): Promise<MaterialAdaptationVo[]> {
    const adaptations = await this.materialAdaptationRepository.listByMaterialId(materialId)
    return adaptations.map(a => MaterialAdaptationVo.create(a))
  }

  private buildAdaptationPrompt(
    material: Material,
    platforms: AccountType[],
    context?: AdaptationContextSnapshot,
  ): string {
    const platformRulesText = platforms
      .map(p => `- **${p}**: ${PLATFORM_RESTRICTIONS.get(p) || ''}`)
      .join('\n')

    const optionRulesText = this.buildOptionRulesText(platforms, material, context)

    return `
## 任务
将以下草稿内容适配到多个社交媒体平台。

## 核心要求（最重要）
1. **保持原意** - 必须保持原始内容的核心含义和意图不变，不得改变原意、添加新信息或删除关键信息
2. **保持风格** - 必须保持原始内容的写作风格、语气和表达方式，只在必要时进行微调以适应平台规则

## 原始内容
- 标题: ${material.title || '(无标题)'}
- 描述: ${material.desc || '(无描述)'}
- 话题: ${material.topics?.join(', ') || '(无话题)'}

${this.buildContextPromptSections(material, context)}

## 平台规则
${platformRulesText}

## 适配要求
1. **保持原意** - 核心信息和意图必须与原始内容一致
2. **保持风格** - 保留原始的写作风格和语气，但必须应用品牌资产和管线风格约束
3. **遵守限制** - 严格遵守各平台字符限制
4. **优化格式** - 仅在必要时调整格式以适应平台
5. **话题标签** - 生成适合各平台的话题标签（不含#前缀）
6. **品牌一致性** - 优先体现品牌关键词、Slogan 和色彩/视觉方向，不得使用禁用词
7. **风格一致性** - 若存在管线偏好，优先遵循管线节奏、语气和 CTA 方式，而不是输出通用平台文案

## 平台配置（option）
为每个平台生成合适的发布配置，使用工具获取可用的分类/分区信息：
${optionRulesText}
`
  }

  private buildOptionRulesText(
    platforms: string[],
    material: Material,
    context?: AdaptationContextSnapshot,
  ): string {
    const rules: string[] = []

    for (const platform of platforms) {
      const styleDrivenDefaults = buildStyleDrivenPlatformOptions({
        platform,
        materialType: material.type === 'video' ? 'video' : 'article',
        aspectRatio: this.resolvePreferredAspectRatio(context),
        preferredDuration: this.resolvePreferredDuration(context),
        preferredStyles: this.resolvePreferredStyles(context),
        pipelineType: context?.pipeline?.type,
      })
      const defaultsText = styleDrivenDefaults
        ? `；若无更强业务约束，优先采用默认值 ${JSON.stringify(styleDrivenDefaults)}`
        : ''

      switch (platform) {
        case AccountType.BILIBILI:
          rules.push(`- **BILIBILI**: 调用 getBilibiliContentCategories 获取分区列表，根据内容选择合适的 tid；copyright 默认 1（原创），no_reprint 默认 0（允许转载）${defaultsText}`)
          break
        case AccountType.YOUTUBE:
          rules.push(`- **YOUTUBE**: 调用 getYoutubeContentCategories 获取分类列表，根据内容选择合适的 categoryId；privacyStatus 默认 public，license 默认 youtube${defaultsText}`)
          break
        case AccountType.TIKTOK:
          rules.push(`- **TIKTOK**: privacy_level 根据内容选择（PUBLIC_TO_EVERYONE/MUTUAL_FOLLOW_FRIENDS/SELF_ONLY）${defaultsText}`)
          break
        case AccountType.FACEBOOK:
          rules.push(`- **FACEBOOK**: content_category 根据内容形式选择（post/reel/story）${defaultsText}`)
          break
        case AccountType.INSTAGRAM:
          rules.push(`- **INSTAGRAM**: content_category 根据内容形式选择（post/reel/story）${defaultsText}`)
          break
        case AccountType.THREADS:
          rules.push(`- **THREADS**: location_id 可为空${defaultsText}`)
          break
      }
    }

    return rules.join('\n')
  }

  private async resolveAdaptationContext(
    material: Material,
    dto: Pick<AdaptMaterialDto, 'brandId' | 'pipelineId'>,
  ): Promise<AdaptationContextSnapshot> {
    const taskLink = await this.resolveTaskLink(material.taskId)
    const brandId = this.normalizeOptionalString(dto.brandId) || taskLink.brandId
    const pipelineId = this.normalizeOptionalString(dto.pipelineId) || taskLink.pipelineId
    const [brand, pipeline] = await Promise.all([
      this.loadBrandContext(brandId),
      this.loadPipelineContext(pipelineId),
    ])
    const copyContext = this.loadCopyContext(material)

    return {
      brand,
      pipeline,
      copy: copyContext,
    }
  }

  private async resolveTaskLink(taskId?: string): Promise<{ brandId: string, pipelineId: string }> {
    const normalizedTaskId = this.normalizeOptionalString(taskId)
    if (!normalizedTaskId || !Types.ObjectId.isValid(normalizedTaskId)) {
      return { brandId: '', pipelineId: '' }
    }

    const task = await this.videoTaskRepository.getById(normalizedTaskId)

    return {
      brandId: task?.brandId?.toString?.() || '',
      pipelineId: task?.pipelineId?.toString?.() || '',
    }
  }

  private async loadBrandContext(brandId?: string): Promise<AdaptationBrandContext | null> {
    const normalizedBrandId = this.normalizeOptionalString(brandId)
    if (!normalizedBrandId || !Types.ObjectId.isValid(normalizedBrandId)) {
      return null
    }

    const brand = await this.brandRepository.getActiveById(normalizedBrandId)

    if (!brand) {
      return null
    }

    const assets = this.asRecord(brand['assets'])
    const videoStyle = this.asRecord(brand['videoStyle'])

    return {
      id: brand['_id']?.toString?.() || normalizedBrandId,
      name: this.normalizeOptionalString(brand['name']),
      industry: this.normalizeOptionalString(brand['industry']),
      logoUrl: this.normalizeOptionalString(assets['logoUrl']),
      colors: this.normalizeStringList(assets['colors']),
      fonts: this.normalizeStringList(assets['fonts']),
      slogans: this.normalizeStringList(assets['slogans']),
      keywords: this.normalizeStringList(assets['keywords']),
      prohibitedWords: this.normalizeStringList(assets['prohibitedWords']),
      referenceImages: this.normalizeStringList(assets['referenceImages']),
      preferredDuration: this.normalizePositiveNumber(videoStyle['preferredDuration'], null),
      aspectRatio: this.normalizeOptionalString(videoStyle['aspectRatio']),
      subtitleStyle: this.asRecord(videoStyle['subtitleStyle']),
      referenceVideoUrl: this.normalizeOptionalString(videoStyle['referenceVideoUrl']),
    }
  }

  private async loadPipelineContext(pipelineId?: string): Promise<AdaptationPipelineContext | null> {
    const normalizedPipelineId = this.normalizeOptionalString(pipelineId)
    if (!normalizedPipelineId || !Types.ObjectId.isValid(normalizedPipelineId)) {
      return null
    }

    const pipeline = await this.pipelineRepository.getById(normalizedPipelineId)

    if (!pipeline) {
      return null
    }

    const styleConfig = this.asRecord(pipeline['styleConfig'])
    const preferences = this.asRecord(pipeline['preferences'])
    const styleConfigBrandAssets = this.asRecord(styleConfig['brandAssets'])

    return {
      id: pipeline['_id']?.toString?.() || normalizedPipelineId,
      name: this.normalizeOptionalString(pipeline['name']),
      type: this.normalizeOptionalString(pipeline['type']),
      description: this.normalizeOptionalString(pipeline['description']),
      preferredDuration: this.normalizePositiveNumber(
        preferences['preferredDuration'],
        this.normalizePositiveNumber(styleConfig['duration'], null),
      ),
      aspectRatio: this.normalizeOptionalString(preferences['aspectRatio'])
        || this.normalizeOptionalString(styleConfig['aspectRatio']),
      tone: this.normalizeOptionalString(styleConfig['tone']),
      visualStyle: this.normalizeOptionalString(styleConfig['visualStyle']),
      preferredStyles: this.normalizeStringList(preferences['preferredStyles']),
      avoidStyles: this.normalizeStringList(preferences['avoidStyles']),
      subtitlePreferences: this.asRecord(preferences['subtitlePreferences']),
      styleRewrite: this.asRecord(styleConfig['styleRewrite']),
      brandAssets: {
        logo: this.normalizeOptionalString(styleConfigBrandAssets['logo']),
        colors: this.normalizeStringList(styleConfigBrandAssets['colors']),
        fonts: this.normalizeStringList(styleConfigBrandAssets['fonts']),
      },
      warmUpStatus: this.normalizeOptionalString(this.asRecord(pipeline['warmUp'])['status']),
    }
  }

  private loadCopyContext(material: Material): AdaptationCopyContext | null {
    const copy = this.asRecord(this.asRecord(material.option)['copy'])
    const copyStyle = this.normalizeOptionalString(copy['copyStyle'])
    const copyModel = this.normalizeOptionalString(copy['copyModel'])

    if (!copyStyle && !copyModel) {
      return null
    }

    return {
      copyStyle,
      copyModel,
    }
  }

  private shouldUseContextualRewrite(context: AdaptationContextSnapshot): boolean {
    return Boolean(context.brand || context.pipeline || context.copy?.copyStyle)
  }

  private buildContextPromptSections(material: Material, context?: AdaptationContextSnapshot): string {
    const sections: string[] = [
      '## 素材形态',
      `- 类型: ${material.type === 'video' ? '视频草稿' : '图文草稿'}`,
      `- 当前平台候选: ${(material.accountTypes || []).join(', ') || '(未设置)'}`,
    ]

    if (context?.brand) {
      const brand = context.brand
      sections.push('## 品牌资产约束')
      sections.push(`- 品牌: ${brand.name || '(未命名品牌)'}`)
      sections.push(`- 行业: ${brand.industry || '(未设置)'}`)
      sections.push(`- Logo: ${brand.logoUrl || '(未上传)'}`)
      sections.push(`- 品牌色: ${brand.colors.join(', ') || '(未设置)'}`)
      sections.push(`- 字体: ${brand.fonts.join(', ') || '(未设置)'}`)
      sections.push(`- Slogan: ${brand.slogans.join(' / ') || '(未设置)'}`)
      sections.push(`- 品牌关键词: ${brand.keywords.join(', ') || '(未设置)'}`)
      sections.push(`- 禁用词: ${brand.prohibitedWords.join(', ') || '(无)'}`)
      sections.push(`- 参考素材: Logo ${brand.logoUrl ? '已提供' : '未提供'}，参考图 ${brand.referenceImages.length} 张`)
    }

    if (context?.pipeline) {
      const pipeline = context.pipeline
      const guide = resolvePipelineStyleGuide(pipeline.type)
      sections.push('## 管线风格配置')
      sections.push(`- 管线: ${pipeline.name || '(未命名管线)'}`)
      sections.push(`- 类型: ${pipeline.type || '(未设置)'}`)
      sections.push(`- 预热状态: ${pipeline.warmUpStatus || '(未知)'}`)
      sections.push(`- 时长/比例: ${pipeline.preferredDuration || '(未设置)'}s / ${pipeline.aspectRatio || '(未设置)'}`)
      sections.push(`- Tone: ${pipeline.tone || '(未设置)'}`)
      sections.push(`- Visual Style: ${pipeline.visualStyle || '(未设置)'}`)
      sections.push(`- Preferred Styles: ${pipeline.preferredStyles.join(', ') || '(未设置)'}`)
      sections.push(`- Avoid Styles: ${pipeline.avoidStyles.join(', ') || '(未设置)'}`)
      if (guide) {
        sections.push(`- 风格模板: ${guide.label}，语气=${guide.tone}，节奏=${guide.pacing}`)
        sections.push(`- 叙事策略: ${guide.narrative}`)
        sections.push(`- CTA 方式: ${guide.callToAction}`)
      }
    }

    if (context?.copy) {
      sections.push('## 已有文案偏好')
      sections.push(`- 文案风格: ${context.copy.copyStyle || '(未设置)'}`)
      sections.push(`- 文案模型: ${context.copy.copyModel || '(未设置)'}`)
    }

    return sections.join('\n')
  }

  private resolvePreferredDuration(context?: AdaptationContextSnapshot): number | null {
    return context?.pipeline?.preferredDuration
      ?? context?.brand?.preferredDuration
      ?? null
  }

  private resolvePreferredAspectRatio(context?: AdaptationContextSnapshot): string {
    return context?.pipeline?.aspectRatio
      || context?.brand?.aspectRatio
      || ''
  }

  private resolvePreferredStyles(context?: AdaptationContextSnapshot): string[] {
    return [
      ...(context?.pipeline?.preferredStyles || []),
      ...(context?.copy?.copyStyle ? [context.copy.copyStyle] : []),
    ]
  }

  private extractPlatformOptions(option?: Record<string, unknown>): PlatformOptions | undefined {
    const normalized = this.asRecord(option)
    return Object.keys(normalized).length > 0
      ? normalized as PlatformOptions
      : undefined
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {}
  }

  private normalizeOptionalString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
  }

  private normalizeStringList(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return []
    }

    return [...new Set(
      value
        .map(item => (typeof item === 'string' ? item.trim() : ''))
        .filter((item): item is string => Boolean(item)),
    )]
  }

  private normalizePositiveNumber(value: unknown, fallback: number | null): number | null {
    const normalized = Number(value)
    if (Number.isFinite(normalized) && normalized > 0) {
      return normalized
    }

    return fallback
  }

  private extractUsageFromMessages(messages: BaseMessage[]): {
    input_tokens: number
    output_tokens: number
    input_token_details?: TokenUsageDetails
    output_token_details?: TokenUsageDetails
  } {
    let inputTokens = 0
    let outputTokens = 0
    const inputTokenDetails: TokenUsageDetails = {}
    const outputTokenDetails: TokenUsageDetails = {}

    const mergeTokenDetails = (target: TokenUsageDetails, source?: TokenUsageDetails) => {
      if (!source) {
        return
      }

      target.text = (target.text || 0) + (source.text || 0)
      target.image = (target.image || 0) + (source.image || 0)
      target.audio = (target.audio || 0) + (source.audio || 0)
      target.video = (target.video || 0) + (source.video || 0)
    }

    for (const msg of messages) {
      if (AIMessage.isInstance(msg)) {
        const usage = msg.usage_metadata
        if (usage) {
          inputTokens += usage.input_tokens || 0
          outputTokens += usage.output_tokens || 0
          mergeTokenDetails(inputTokenDetails, usage.input_token_details as TokenUsageDetails | undefined)
          mergeTokenDetails(outputTokenDetails, usage.output_token_details as TokenUsageDetails | undefined)
        }
      }
    }
    return {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      input_token_details: Object.values(inputTokenDetails).some(v => (v || 0) > 0) ? inputTokenDetails : undefined,
      output_token_details: Object.values(outputTokenDetails).some(v => (v || 0) > 0) ? outputTokenDetails : undefined,
    }
  }

  private getModelPricing(modelName: string): ChatPricing | null {
    const chatModel = config.ai.models.chat.find(m => m.name === modelName)
    if (!chatModel) {
      return null
    }
    return chatModel.pricing as ChatPricing
  }
}
