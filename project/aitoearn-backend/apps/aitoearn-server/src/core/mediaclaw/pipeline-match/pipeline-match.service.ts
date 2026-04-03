import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import {
  PipelineTemplate,
  PipelineTemplateStatus,
  PipelineType,
} from '@yikart/mongodb'
import { Model, Types } from 'mongoose'

type TemplateRecord = Record<string, any>

interface MatchPipelineRequest {
  referenceVideoUrl?: string
  category?: string
  style?: string
  duration?: number
  budget?: number
  description?: string
}

interface TemplateFilters {
  status?: string
  category?: string
  style?: string
  type?: string
  keyword?: string
}

interface TemplateMutationInput {
  templateId?: string
  name?: string
  description?: string
  categories?: string[]
  styles?: string[]
  durationRange?: number[]
  costPerVideo?: number
  qualityStars?: number
  limitations?: string[]
  verifiedClients?: string[]
  defaultParams?: Record<string, unknown>
  steps?: Array<{ name?: string, config?: Record<string, unknown>, order?: number }>
  status?: string
  type?: string
  isPublic?: boolean
  createdBy?: string
  usageCount?: number
}

interface MatchResult {
  id: string
  templateId: string
  name: string
  type: PipelineType
  matchScore: number
  matchLevel: 'direct_match' | 'needs_param_tuning' | 'new_pipeline_needed'
  matchDetails: {
    category: number
    style: number
    budget: number
    duration: number
  }
  adjustments: string[]
  description: string
  categories: string[]
  styles: string[]
  durationRange: number[]
  costPerVideo: number
  qualityStars: number
}

@Injectable()
export class PipelineMatchService implements OnModuleInit {
  private readonly logger = new Logger(PipelineMatchService.name)

  constructor(
    @InjectModel(PipelineTemplate.name)
    private readonly pipelineTemplateModel: Model<PipelineTemplate>,
  ) {}

  async onModuleInit() {
    try {
      await this.seedTemplates()
    }
    catch (error) {
      this.logger.warn(`Failed to seed pipeline templates: ${error instanceof Error ? error.message : 'unknown_error'}`)
    }
  }

  async matchPipeline(request: MatchPipelineRequest) {
    const referenceAnalysis = request.referenceVideoUrl
      ? await this.analyzeReferenceVideo(request.referenceVideoUrl)
      : null
    const normalizedRequest = this.normalizeMatchRequest(request, referenceAnalysis)
    const templates = await this.pipelineTemplateModel.find({
      status: { $ne: PipelineTemplateStatus.DEPRECATED },
    }).lean().exec() as TemplateRecord[]

    const results = templates
      .map(template => this.scoreTemplate(template, normalizedRequest))
      .sort((left, right) => right.matchScore - left.matchScore)

    const bestMatch = results[0] || null

    return {
      request: normalizedRequest,
      referenceAnalysis,
      total: results.length,
      bestMatch,
      results,
      suggestion: !bestMatch || bestMatch.matchScore < 60
        ? this.suggestNewPipeline(normalizedRequest, results)
        : null,
    }
  }

  async analyzeReferenceVideo(videoUrl: string) {
    const normalizedUrl = this.readString(videoUrl)
    if (!normalizedUrl) {
      throw new BadRequestException('videoUrl is required')
    }

    const urlHint = normalizedUrl.toLowerCase()
    const category = this.pickFirstMatch(urlHint, [
      ['beauty', 'makeup', 'lipstick', 'skincare', '美妆'],
      ['food', 'snack', '食品'],
      ['drink', 'beverage', '饮料'],
      ['teach', 'tutorial', 'course', '教学'],
      ['bar', 'cocktail', '酒吧'],
    ]) || '通用'
    const style = this.pickFirstMatch(urlHint, [
      ['unbox', '开箱'],
      ['live', '直播', 'scene', '场景化'],
      ['explain', 'tutorial', 'guide', 'rules', '科普教学'],
      ['product', 'showcase', '产品展示'],
    ]) || '产品展示'
    const duration = this.extractDurationHint(urlHint) || 30

    return {
      videoUrl: normalizedUrl,
      category,
      style,
      duration,
      keyElements: [category, style, 'cta ending'],
      suggestedTemplateType: style === '科普教学'
        ? 'b10-explainer'
        : style === '开箱'
          ? 'b9-product-showcase'
          : 'b7-ai-live',
      note: 'TODO: integrate with ContentRemixAgent for real reference video analysis',
    }
  }

  suggestNewPipeline(request: MatchPipelineRequest, matchResults: MatchResult[]) {
    const bestMatch = matchResults[0] || null

    return {
      baseTemplateId: bestMatch?.templateId || 'b10-explainer',
      requiredChanges: [
        request.category ? `补充品类能力: ${request.category}` : '补充品类标签',
        request.style ? `补充风格能力: ${request.style}` : '补充风格标签',
        request.duration ? `支持 ${request.duration}s 时长` : '增加更多时长档位',
      ],
      estimatedDevTime: bestMatch && bestMatch.matchScore >= 40 ? '1-2 days' : '3-5 days',
      estimatedCost: request.budget && request.budget > 0
        ? Math.max(request.budget, bestMatch?.costPerVideo || 1)
        : bestMatch?.costPerVideo || 19.5,
    }
  }

  async listTemplates(filters: TemplateFilters = {}) {
    const query: Record<string, unknown> = {}
    const normalizedStatus = this.normalizeTemplateStatus(filters.status)
    const normalizedType = this.normalizePipelineType(filters.type, false)

    if (normalizedStatus) {
      query['status'] = normalizedStatus
    }
    if (normalizedType) {
      query['type'] = normalizedType
    }

    const items = await this.pipelineTemplateModel.find(query)
      .sort({ qualityStars: -1, usageCount: -1, createdAt: -1 })
      .lean()
      .exec() as TemplateRecord[]

    const normalizedCategory = this.normalizeKeyword(filters.category)
    const normalizedStyle = this.normalizeKeyword(filters.style)
    const normalizedKeyword = this.normalizeKeyword(filters.keyword)

    return items
      .filter((item) => {
        if (normalizedCategory && !this.matchesKeywordList(item['categories'], normalizedCategory)) {
          return false
        }
        if (normalizedStyle && !this.matchesKeywordList(item['styles'], normalizedStyle)) {
          return false
        }
        if (!normalizedKeyword) {
          return true
        }

        return [
          item['templateId'],
          item['name'],
          item['description'],
        ].some(candidate => this.normalizeKeyword(candidate).includes(normalizedKeyword))
      })
      .map(item => this.toTemplateResponse(item))
  }

  async createTemplate(data: TemplateMutationInput) {
    const payload = this.normalizeTemplateMutation(data, true)

    const existing = await this.pipelineTemplateModel.findOne({ templateId: payload.templateId }).lean().exec()
    if (existing) {
      throw new BadRequestException('templateId already exists')
    }

    const created = await this.pipelineTemplateModel.create(payload)
    return this.toTemplateResponse(created.toObject())
  }

  async updateTemplate(id: string, data: TemplateMutationInput) {
    const existing = await this.findTemplateByIdOrTemplateId(id)
    if (!existing) {
      throw new NotFoundException('Pipeline template not found')
    }

    const updates = this.normalizeTemplateMutation({
      ...existing,
      ...data,
      createdBy: existing['createdBy'] || 'system',
    }, false)

    const updated = await this.pipelineTemplateModel.findByIdAndUpdate(
      existing['_id'],
      { $set: updates },
      { new: true },
    ).lean().exec() as TemplateRecord | null

    if (!updated) {
      throw new NotFoundException('Pipeline template not found')
    }

    return this.toTemplateResponse(updated)
  }

  private async seedTemplates() {
    const seedTemplates: Array<{
      templateId: string
      name: string
      description: string
      categories: string[]
      styles: string[]
      durationRange: [number, number]
      costPerVideo: number
      qualityStars: number
      limitations: string[]
      verifiedClients: string[]
      defaultParams: {
        duration: number
        aspectRatio: string
        subtitleStyle: Record<string, unknown>
        musicStyle: string
        extra: Record<string, unknown>
      }
      status: PipelineTemplateStatus
      type: PipelineType
      isPublic: boolean
      createdBy: string
      usageCount: number
      steps: Array<{ name: string, order: number, config: Record<string, unknown> }>
    }> = [
      {
        templateId: 'b7-ai-live',
        name: 'B7 AI Live',
        description: '低成本 AI 直播感产品讲解模板，适合快速批量起量。',
        categories: ['美妆', '食品', '日用品'],
        styles: ['产品展示', '微动', '场景化'],
        durationRange: [15, 45],
        costPerVideo: 19.5,
        qualityStars: 3,
        limitations: ['镜头语言较轻量', '不适合高质感棚拍'],
        verifiedClients: [],
        defaultParams: {
          duration: 30,
          aspectRatio: '9:16',
          subtitleStyle: { tone: '直播感' },
          musicStyle: 'light-pop',
          extra: {},
        },
        status: PipelineTemplateStatus.ACTIVE,
        type: PipelineType.PROMO,
        isPublic: true,
        createdBy: 'system:pipeline-match',
        usageCount: 0,
        steps: [
          { name: 'script', order: 1, config: { mode: 'ai-live' } },
          { name: 'avatar', order: 2, config: { motion: 'micro' } },
          { name: 'render', order: 3, config: { ratio: '9:16' } },
        ],
      },
      {
        templateId: 'b9-product-showcase',
        name: 'B9 Product Showcase',
        description: '高质量产品展示与对标复刻模板，适合重点商品打磨。',
        categories: ['美妆', '食品', '饮料'],
        styles: ['对标复刻', '产品展示', '开箱'],
        durationRange: [20, 60],
        costPerVideo: 58,
        qualityStars: 5,
        limitations: ['制作成本较高', '需要更完整素材包'],
        verifiedClients: [],
        defaultParams: {
          duration: 35,
          aspectRatio: '9:16',
          subtitleStyle: { tone: 'premium' },
          musicStyle: 'cinematic-pop',
          extra: {},
        },
        status: PipelineTemplateStatus.ACTIVE,
        type: PipelineType.NEW_PRODUCT,
        isPublic: true,
        createdBy: 'system:pipeline-match',
        usageCount: 0,
        steps: [
          { name: 'benchmark-analysis', order: 1, config: { mode: 'replica' } },
          { name: 'product-packshot', order: 2, config: { lighting: 'studio' } },
          { name: 'render', order: 3, config: { ratio: '9:16' } },
        ],
      },
      {
        templateId: 'b10-explainer',
        name: 'B10 Explainer',
        description: '低成本规则讲解与教程模板，适合知识型和说明型内容。',
        categories: ['教学', '科普', '酒吧'],
        styles: ['科普教学', '规则讲解', '教程'],
        durationRange: [30, 120],
        costPerVideo: 1,
        qualityStars: 4,
        limitations: ['视觉张力有限', '依赖脚本结构清晰度'],
        verifiedClients: [],
        defaultParams: {
          duration: 45,
          aspectRatio: '9:16',
          subtitleStyle: { tone: 'clean' },
          musicStyle: 'minimal',
          extra: {},
        },
        status: PipelineTemplateStatus.ACTIVE,
        type: PipelineType.BRAND_STORY,
        isPublic: true,
        createdBy: 'system:pipeline-match',
        usageCount: 0,
        steps: [
          { name: 'outline', order: 1, config: { mode: 'explainer' } },
          { name: 'script', order: 2, config: { emphasis: 'education' } },
          { name: 'render', order: 3, config: { subtitle: 'guided' } },
        ],
      },
    ]

    await this.pipelineTemplateModel.bulkWrite(
      seedTemplates.map(template => ({
        updateOne: {
          filter: { templateId: template.templateId },
          update: {
            $set: {
              templateId: template.templateId,
              name: template.name,
              description: template.description,
              categories: template.categories,
              styles: template.styles,
              durationRange: template.durationRange,
              costPerVideo: template.costPerVideo,
              qualityStars: template.qualityStars,
              limitations: template.limitations,
              verifiedClients: template.verifiedClients,
              defaultParams: template.defaultParams,
              status: template.status,
              type: template.type,
              isPublic: template.isPublic,
              steps: template.steps,
            },
            $setOnInsert: {
              createdBy: template.createdBy,
              usageCount: template.usageCount,
            },
          },
          upsert: true,
        },
      })),
    )
  }

  private scoreTemplate(template: TemplateRecord, request: MatchPipelineRequest): MatchResult {
    const categoryScore = this.scoreCategory(template, request)
    const styleScore = this.scoreStyle(template, request)
    const budgetScore = this.scoreBudget(template, request)
    const durationScore = this.scoreDuration(template, request)
    const matchScore = Number((categoryScore + styleScore + budgetScore + durationScore).toFixed(2))
    const matchLevel = matchScore > 80
      ? 'direct_match'
      : matchScore >= 60
        ? 'needs_param_tuning'
        : 'new_pipeline_needed'

    return {
      id: template['_id'].toString(),
      templateId: this.readString(template['templateId']) || template['_id'].toString(),
      name: this.readString(template['name']),
      type: template['type'] as PipelineType,
      matchScore,
      matchLevel,
      matchDetails: {
        category: categoryScore,
        style: styleScore,
        budget: budgetScore,
        duration: durationScore,
      },
      adjustments: this.buildAdjustments(template, request),
      description: this.readString(template['description']),
      categories: this.readStringList(template['categories']),
      styles: this.readStringList(template['styles']),
      durationRange: this.normalizeDurationRange(template['durationRange']),
      costPerVideo: this.toPositiveNumber(template['costPerVideo']),
      qualityStars: this.toPositiveNumber(template['qualityStars']),
    }
  }

  private buildAdjustments(template: TemplateRecord, request: MatchPipelineRequest) {
    const adjustments: string[] = []
    const costPerVideo = this.toPositiveNumber(template['costPerVideo'])
    const durationRange = this.normalizeDurationRange(template['durationRange'])

    if (request.budget && costPerVideo > request.budget) {
      adjustments.push(`预算偏低，建议从 ${costPerVideo} 调整到 ${request.budget} 以上或降低模板质量配置`)
    }

    if (request.duration && durationRange.length === 2) {
      if (request.duration < durationRange[0]) {
        adjustments.push(`时长偏短，建议将脚本压缩到 ${durationRange[0]}s 以上的结构`)
      }
      if (request.duration > durationRange[1]) {
        adjustments.push(`时长偏长，建议拆分为 ${durationRange[1]}s 内的分段表达`)
      }
    }

    if (request.style && !this.matchesKeywordList(template['styles'], this.normalizeKeyword(request.style))) {
      adjustments.push(`需补充风格调参以适配 ${request.style}`)
    }

    if (request.category && !this.matchesKeywordList(template['categories'], this.normalizeKeyword(request.category))) {
      adjustments.push(`需补充 ${request.category} 品类知识和素材规范`)
    }

    return adjustments
  }

  private scoreCategory(template: TemplateRecord, request: MatchPipelineRequest) {
    const requestedCategory = this.normalizeKeyword(request.category)
    if (!requestedCategory) {
      return 24
    }

    return this.matchesKeywordList(template['categories'], requestedCategory) ? 40 : 0
  }

  private scoreStyle(template: TemplateRecord, request: MatchPipelineRequest) {
    const requestedStyle = this.normalizeKeyword(request.style)
    if (!requestedStyle) {
      return 18
    }

    return this.matchesKeywordList(template['styles'], requestedStyle) ? 30 : 0
  }

  private scoreBudget(template: TemplateRecord, request: MatchPipelineRequest) {
    const budget = this.toPositiveNumber(request.budget)
    const costPerVideo = this.toPositiveNumber(template['costPerVideo'])

    if (!budget || !costPerVideo) {
      return 9
    }

    if (costPerVideo <= budget) {
      return 15
    }

    const ratio = budget / costPerVideo
    if (ratio >= 0.8) {
      return 10
    }
    if (ratio >= 0.5) {
      return 6
    }
    return 0
  }

  private scoreDuration(template: TemplateRecord, request: MatchPipelineRequest) {
    const duration = this.toPositiveNumber(request.duration)
    const durationRange = this.normalizeDurationRange(template['durationRange'])

    if (!duration || durationRange.length !== 2) {
      return 9
    }

    if (duration >= durationRange[0] && duration <= durationRange[1]) {
      return 15
    }

    const distance = duration < durationRange[0]
      ? durationRange[0] - duration
      : duration - durationRange[1]

    if (distance <= 10) {
      return 10
    }
    if (distance <= 20) {
      return 6
    }
    return 0
  }

  private async findTemplateByIdOrTemplateId(id: string) {
    const normalizedId = this.readString(id)
    if (!normalizedId) {
      throw new BadRequestException('template id is required')
    }

    if (Types.ObjectId.isValid(normalizedId)) {
      const byObjectId = await this.pipelineTemplateModel.findById(new Types.ObjectId(normalizedId)).lean().exec()
      if (byObjectId) {
        return byObjectId as TemplateRecord
      }
    }

    return this.pipelineTemplateModel.findOne({ templateId: normalizedId }).lean().exec() as Promise<TemplateRecord | null>
  }

  private normalizeMatchRequest(
    request: MatchPipelineRequest,
    referenceAnalysis?: {
      category?: string
      style?: string
      duration?: number
    } | null,
  ): MatchPipelineRequest {
    return {
      referenceVideoUrl: this.readString(request.referenceVideoUrl),
      category: this.readString(request.category) || this.readString(referenceAnalysis?.category),
      style: this.readString(request.style) || this.readString(referenceAnalysis?.style),
      duration: this.toPositiveNumber(request.duration) || this.toPositiveNumber(referenceAnalysis?.duration) || undefined,
      budget: this.toPositiveNumber(request.budget) || undefined,
      description: this.readString(request.description),
    }
  }

  private normalizeTemplateMutation(data: TemplateMutationInput, requireTemplateId: boolean) {
    const templateId = this.readString(data.templateId)
    const name = this.readString(data.name)
    const createdBy = this.readString(data.createdBy) || 'system'

    if (requireTemplateId && !templateId) {
      throw new BadRequestException('templateId is required')
    }
    if (!name) {
      throw new BadRequestException('name is required')
    }

    return {
      templateId,
      name,
      description: this.readString(data.description),
      categories: this.readStringList(data.categories),
      styles: this.readStringList(data.styles),
      durationRange: this.normalizeDurationRange(data.durationRange),
      costPerVideo: this.toPositiveNumber(data.costPerVideo),
      qualityStars: this.normalizeQualityStars(data.qualityStars),
      limitations: this.readStringList(data.limitations),
      verifiedClients: this.readStringList(data.verifiedClients),
      defaultParams: this.normalizeDefaultParams(data.defaultParams),
      steps: this.normalizeSteps(data.steps),
      status: this.normalizeTemplateStatus(data.status) || PipelineTemplateStatus.ACTIVE,
      type: this.normalizePipelineType(data.type, true) || PipelineType.PROMO,
      isPublic: data.isPublic ?? true,
      createdBy,
      usageCount: Number.isFinite(Number(data.usageCount)) && Number(data.usageCount) >= 0
        ? Number(data.usageCount)
        : 0,
    }
  }

  private normalizeDefaultParams(value: Record<string, unknown> | undefined) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    const extra = source['extra'] && typeof source['extra'] === 'object' && !Array.isArray(source['extra'])
      ? source['extra'] as Record<string, unknown>
      : {}

    return {
      duration: this.toPositiveNumber(source['duration']) || 15,
      aspectRatio: this.readString(source['aspectRatio']) || '9:16',
      subtitleStyle: source['subtitleStyle'] && typeof source['subtitleStyle'] === 'object' && !Array.isArray(source['subtitleStyle'])
        ? source['subtitleStyle']
        : {},
      musicStyle: this.readString(source['musicStyle']),
      extra,
    }
  }

  private normalizeSteps(value: TemplateMutationInput['steps']) {
    if (!Array.isArray(value)) {
      return []
    }

    return value
      .map((item, index) => ({
        name: this.readString(item?.name),
        config: item?.config && typeof item.config === 'object' && !Array.isArray(item.config)
          ? item.config
          : {},
        order: Number.isFinite(Number(item?.order)) ? Number(item?.order) : index + 1,
      }))
      .filter(item => item.name)
  }

  private normalizeDurationRange(value: unknown) {
    if (!Array.isArray(value) || value.length < 2) {
      return []
    }

    const first = this.toPositiveNumber(value[0])
    const second = this.toPositiveNumber(value[1])
    if (!first || !second) {
      return []
    }

    return first <= second ? [first, second] : [second, first]
  }

  private normalizeQualityStars(value: unknown) {
    const numeric = this.toPositiveNumber(value)
    if (!numeric) {
      return 0
    }
    return Math.min(Math.max(Math.round(numeric), 1), 5)
  }

  private normalizeTemplateStatus(value?: string) {
    const normalized = this.readString(value).toLowerCase()
    if (!normalized) {
      return null
    }

    if (normalized === PipelineTemplateStatus.ACTIVE) {
      return PipelineTemplateStatus.ACTIVE
    }
    if (normalized === PipelineTemplateStatus.DRAFT) {
      return PipelineTemplateStatus.DRAFT
    }
    if (normalized === PipelineTemplateStatus.DEPRECATED) {
      return PipelineTemplateStatus.DEPRECATED
    }

    throw new BadRequestException('Invalid pipeline template status')
  }

  private normalizePipelineType(value?: string, strict = true) {
    const normalized = this.readString(value).toLowerCase()
    if (!normalized) {
      return null
    }

    const supportedTypes = new Set(Object.values(PipelineType))
    if (supportedTypes.has(normalized as PipelineType)) {
      return normalized as PipelineType
    }

    if (strict) {
      throw new BadRequestException('Invalid pipeline type')
    }

    return null
  }

  private toTemplateResponse(item: TemplateRecord) {
    return {
      id: item['_id'].toString(),
      templateId: this.readString(item['templateId']) || item['_id'].toString(),
      name: this.readString(item['name']),
      description: this.readString(item['description']),
      type: item['type'] || PipelineType.PROMO,
      categories: this.readStringList(item['categories']),
      styles: this.readStringList(item['styles']),
      durationRange: this.normalizeDurationRange(item['durationRange']),
      costPerVideo: this.toPositiveNumber(item['costPerVideo']),
      qualityStars: this.toPositiveNumber(item['qualityStars']),
      limitations: this.readStringList(item['limitations']),
      verifiedClients: this.readStringList(item['verifiedClients']),
      defaultParams: item['defaultParams'] || {},
      steps: Array.isArray(item['steps']) ? item['steps'] : [],
      status: item['status'] || PipelineTemplateStatus.ACTIVE,
      isPublic: Boolean(item['isPublic']),
      createdBy: this.readString(item['createdBy']),
      usageCount: Number(item['usageCount'] || 0),
      createdAt: item['createdAt'] || null,
      updatedAt: item['updatedAt'] || null,
    }
  }

  private matchesKeywordList(values: unknown, keyword: string) {
    const normalizedValues = this.readStringList(values).map(item => this.normalizeKeyword(item))
    return normalizedValues.some(item => item.includes(keyword) || keyword.includes(item))
  }

  private pickFirstMatch(value: string, groups: string[][]) {
    for (const group of groups) {
      if (group.some(token => value.includes(token.toLowerCase()))) {
        return group[group.length - 1]
      }
    }

    return ''
  }

  private extractDurationHint(value: string) {
    const matched = value.match(/(\d{1,3})(?:s|sec|seconds)/)
    if (!matched) {
      return 0
    }

    return this.toPositiveNumber(matched[1])
  }

  private normalizeKeyword(value: unknown) {
    return this.readString(value).toLowerCase()
  }

  private readStringList(value: unknown) {
    if (!Array.isArray(value)) {
      return []
    }

    return Array.from(new Set(
      value
        .map(item => this.readString(item))
        .filter(Boolean),
    ))
  }

  private readString(value: unknown) {
    return typeof value === 'string' ? value.trim() : ''
  }

  private toPositiveNumber(value: unknown) {
    const numeric = Number(value || 0)
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return 0
    }
    return Number(numeric.toFixed(2))
  }
}
