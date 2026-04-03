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
  ViralContent,
} from '@yikart/mongodb'
import { Model, Types } from 'mongoose'
import { ContentRemixService } from '../discovery/content-remix.service'

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

interface CreateTemplateInput {
  templateId?: string
  name?: string
  description?: string
  categories?: string[]
  styles?: string[]
  durationRange?: [number, number]
  costPerVideo?: number
  qualityStars?: number
  limitations?: string[]
  verifiedClients?: string[]
  defaultParams?: Record<string, unknown>
  status?: string
  type?: string
  isPublic?: boolean
  createdBy: string
}

interface UpdateTemplateInput {
  name?: string
  description?: string
  categories?: string[]
  styles?: string[]
  durationRange?: [number, number]
  costPerVideo?: number
  qualityStars?: number
  limitations?: string[]
  verifiedClients?: string[]
  defaultParams?: Record<string, unknown>
  status?: string
  type?: string
  isPublic?: boolean
}

interface ReferenceAnalysis {
  videoUrl: string
  category: string
  style: string
  duration: number
  keyElements: string[]
  suggestedTemplateType: PipelineType
  analysisSource: 'content_remix' | 'pending_manual'
  matchedContentId: string | null
  note: string
}

type TemplateRecord = Record<string, any> & {
  _id: { toString(): string }
}

type ViralContentRecord = Record<string, any> & {
  _id: { toString(): string }
}

const TEMPLATE_SEEDS = [
  {
    templateId: 'b7-ai-live',
    name: 'B7 AI Live',
    description: '适合轻量商品直播感短视频的低成本模板。',
    categories: ['美妆', '食品', '日用品'],
    styles: ['产品展示', '微动', '场景化'],
    durationRange: [10, 25] as [number, number],
    costPerVideo: 19.5,
    qualityStars: 3,
    limitations: ['适合轻商品镜头', '复杂口播需要额外调参'],
    verifiedClients: [],
    defaultParams: {
      duration: 15,
      aspectRatio: '9:16',
      subtitleStyle: {},
      musicStyle: 'light-pop',
      extra: {},
    },
    type: PipelineType.SEEDING,
    status: PipelineTemplateStatus.ACTIVE,
    isPublic: true,
    createdBy: 'system',
  },
  {
    templateId: 'b9-product-showcase',
    name: 'B9 Product Showcase',
    description: '高还原产品展示和开箱对标模板。',
    categories: ['美妆', '食品', '饮料'],
    styles: ['对标复刻', '产品展示', '开箱'],
    durationRange: [15, 45] as [number, number],
    costPerVideo: 58,
    qualityStars: 5,
    limitations: ['成本较高', '需要更完整的商品素材'],
    verifiedClients: [],
    defaultParams: {
      duration: 30,
      aspectRatio: '9:16',
      subtitleStyle: {},
      musicStyle: 'showcase',
      extra: {},
    },
    type: PipelineType.NEW_PRODUCT,
    status: PipelineTemplateStatus.ACTIVE,
    isPublic: true,
    createdBy: 'system',
  },
  {
    templateId: 'b10-explainer',
    name: 'B10 Explainer',
    description: '适合教程、规则讲解、知识型内容的低成本模板。',
    categories: ['教学', '科普', '酒吧'],
    styles: ['科普教学', '规则讲解', '教程'],
    durationRange: [20, 90] as [number, number],
    costPerVideo: 1,
    qualityStars: 4,
    limitations: ['强依赖清晰脚本', '真人出镜感较弱'],
    verifiedClients: [],
    defaultParams: {
      duration: 45,
      aspectRatio: '9:16',
      subtitleStyle: {},
      musicStyle: 'explainer',
      extra: {},
    },
    type: PipelineType.BRAND_STORY,
    status: PipelineTemplateStatus.ACTIVE,
    isPublic: true,
    createdBy: 'system',
  },
]

@Injectable()
export class PipelineMatchService implements OnModuleInit {
  private readonly logger = new Logger(PipelineMatchService.name)

  constructor(
    @InjectModel(PipelineTemplate.name)
    private readonly pipelineTemplateModel: Model<PipelineTemplate>,
    @InjectModel(ViralContent.name)
    private readonly viralContentModel: Model<ViralContent>,
    private readonly contentRemixService: ContentRemixService,
  ) {}

  async onModuleInit() {
    await this.ensureSeedTemplates()
  }

  async matchPipeline(input: MatchPipelineRequest) {
    const referenceAnalysis = input.referenceVideoUrl
      ? await this.analyzeReferenceVideo(input.referenceVideoUrl)
      : null
    const request = this.normalizeMatchRequest(input, referenceAnalysis)
    const templates = await this.pipelineTemplateModel.find({
      status: { $ne: PipelineTemplateStatus.DEPRECATED },
    }).lean().exec() as TemplateRecord[]

    const results = templates
      .map((template) => {
        const categoryMatch = this.calculateCategoryMatch(request, template)
        const styleMatch = this.calculateStyleMatch(request, template)
        const budgetFit = this.calculateBudgetFit(request, template)
        const durationFit = this.calculateDurationFit(request, template)
        const matchScore = Number((
          categoryMatch.score * 40
          + styleMatch.score * 30
          + budgetFit.score * 15
          + durationFit.score * 15
        ).toFixed(2))

        return {
          templateId: template['templateId'] || template['_id'].toString(),
          name: template['name'],
          matchScore,
          matchLevel: this.resolveMatchLevel(matchScore),
          matchDetails: {
            categoryMatch,
            styleMatch,
            budgetFit,
            durationFit,
          },
          adjustments: this.buildAdjustments(request, template),
          costPerVideo: Number(template['costPerVideo'] || 0),
          qualityStars: Number(template['qualityStars'] || 0),
        }
      })
      .sort((left, right) => right.matchScore - left.matchScore)

    return {
      request,
      referenceAnalysis,
      results,
      suggestion: results[0] && results[0].matchScore < 60
        ? this.suggestNewPipeline(request, results)
        : null,
    }
  }

  async analyzeReferenceVideo(videoUrl: string): Promise<ReferenceAnalysis> {
    const normalizedUrl = this.normalizeRequiredString(videoUrl, 'videoUrl')
    const matchedContent = await this.findReferenceContent(normalizedUrl)
    if (!matchedContent) {
      return this.buildPendingManualReferenceAnalysis(normalizedUrl)
    }

    return this.buildReferenceAnalysisFromContent(normalizedUrl, matchedContent)
  }

  suggestNewPipeline(request: MatchPipelineRequest, matchResults: Array<Record<string, any>>) {
    const topResult = matchResults[0] || null
    const requiredChanges = topResult && Array.isArray(topResult['adjustments']) && topResult['adjustments'].length > 0
      ? topResult['adjustments']
      : ['缺少可复用模板，需要新建基础管线']
    const estimatedDevDays = Math.max(1, Math.min(requiredChanges.length, 5))

    return {
      baseTemplateId: topResult?.['templateId'] || null,
      requiredChanges,
      estimatedDevTime: `${estimatedDevDays}d`,
      estimatedCost: Number((
        Number(topResult?.['costPerVideo'] || 20)
        + requiredChanges.length * 8
      ).toFixed(2)),
    }
  }

  async listTemplates(filters: TemplateFilters = {}) {
    const query: Record<string, unknown> = {}
    const normalizedStatus = this.normalizeTemplateStatus(filters.status, false)
    const normalizedType = this.normalizePipelineType(filters.type, false)

    if (normalizedStatus) {
      query['status'] = normalizedStatus
    }
    if (normalizedType) {
      query['type'] = normalizedType
    }

    const templates = await this.pipelineTemplateModel.find(query)
      .sort({ qualityStars: -1, costPerVideo: 1, createdAt: -1 })
      .lean()
      .exec() as TemplateRecord[]

    const categoryKeyword = this.normalizeKeyword(filters.category)
    const styleKeyword = this.normalizeKeyword(filters.style)
    const keyword = this.normalizeKeyword(filters.keyword)

    return templates
      .filter((template) => {
        if (categoryKeyword && !this.containsKeywordInList(template['categories'], categoryKeyword)) {
          return false
        }
        if (styleKeyword && !this.containsKeywordInList(template['styles'], styleKeyword)) {
          return false
        }
        if (!keyword) {
          return true
        }

        return [
          template['templateId'],
          template['name'],
          template['description'],
        ].some(item => this.normalizeKeyword(item).includes(keyword))
      })
      .map(template => this.toTemplateResponse(template))
  }

  async createTemplate(input: CreateTemplateInput) {
    const name = this.normalizeRequiredString(input.name, 'name')
    const templateId = await this.resolveUniqueTemplateId(input.templateId, name)
    const createdBy = this.normalizeRequiredString(input.createdBy, 'createdBy')

    const created = await this.pipelineTemplateModel.create({
      templateId,
      name,
      description: this.normalizeOptionalString(input.description),
      categories: this.normalizeStringList(input.categories),
      styles: this.normalizeStringList(input.styles),
      durationRange: this.normalizeDurationRange(input.durationRange),
      costPerVideo: this.normalizeNumber(input.costPerVideo),
      qualityStars: this.normalizeQualityStars(input.qualityStars),
      limitations: this.normalizeStringList(input.limitations),
      verifiedClients: this.normalizeStringList(input.verifiedClients),
      defaultParams: this.normalizeDefaultParams(input.defaultParams),
      status: this.normalizeTemplateStatus(input.status) || PipelineTemplateStatus.ACTIVE,
      type: this.normalizePipelineType(input.type) || this.inferPipelineTypeFromTemplate(input),
      isPublic: Boolean(input.isPublic),
      createdBy,
      usageCount: 0,
      steps: [],
    })

    return this.toTemplateResponse(created.toObject())
  }

  async updateTemplate(id: string, input: UpdateTemplateInput) {
    const query = this.buildTemplateLookupQuery(id)
    const existing = await this.pipelineTemplateModel.findOne(query).lean().exec() as TemplateRecord | null
    if (!existing) {
      throw new NotFoundException('Pipeline template not found')
    }

    const updatePayload: Record<string, unknown> = {}

    if ('name' in input) {
      updatePayload['name'] = this.normalizeRequiredString(input.name, 'name')
    }
    if ('description' in input) {
      updatePayload['description'] = this.normalizeOptionalString(input.description)
    }
    if ('categories' in input) {
      updatePayload['categories'] = this.normalizeStringList(input.categories)
    }
    if ('styles' in input) {
      updatePayload['styles'] = this.normalizeStringList(input.styles)
    }
    if ('durationRange' in input) {
      updatePayload['durationRange'] = this.normalizeDurationRange(input.durationRange)
    }
    if ('costPerVideo' in input) {
      updatePayload['costPerVideo'] = this.normalizeNumber(input.costPerVideo)
    }
    if ('qualityStars' in input) {
      updatePayload['qualityStars'] = this.normalizeQualityStars(input.qualityStars)
    }
    if ('limitations' in input) {
      updatePayload['limitations'] = this.normalizeStringList(input.limitations)
    }
    if ('verifiedClients' in input) {
      updatePayload['verifiedClients'] = this.normalizeStringList(input.verifiedClients)
    }
    if ('defaultParams' in input) {
      updatePayload['defaultParams'] = this.normalizeDefaultParams(input.defaultParams)
    }
    if ('status' in input) {
      updatePayload['status'] = this.normalizeTemplateStatus(input.status) || PipelineTemplateStatus.ACTIVE
    }
    if ('type' in input) {
      updatePayload['type'] = this.normalizePipelineType(input.type) || existing['type']
    }
    if ('isPublic' in input && typeof input.isPublic === 'boolean') {
      updatePayload['isPublic'] = input.isPublic
    }

    const updated = await this.pipelineTemplateModel.findOneAndUpdate(
      query,
      { $set: updatePayload },
      { new: true },
    ).lean().exec() as TemplateRecord | null

    if (!updated) {
      throw new NotFoundException('Pipeline template not found')
    }

    return this.toTemplateResponse(updated)
  }

  private async ensureSeedTemplates() {
    for (const seed of TEMPLATE_SEEDS) {
      await this.pipelineTemplateModel.findOneAndUpdate(
        { templateId: seed.templateId },
        {
          $set: {
            ...seed,
            categories: this.normalizeStringList(seed.categories),
            styles: this.normalizeStringList(seed.styles),
            limitations: this.normalizeStringList(seed.limitations),
            verifiedClients: this.normalizeStringList(seed.verifiedClients),
            durationRange: this.normalizeDurationRange(seed.durationRange),
            defaultParams: this.normalizeDefaultParams(seed.defaultParams),
          },
          $setOnInsert: {
            usageCount: 0,
            steps: [],
          },
        },
        { upsert: true },
      ).exec()
    }

    this.logger.log(`Pipeline template seeds ensured: ${TEMPLATE_SEEDS.length}`)
  }

  private normalizeMatchRequest(
    input: MatchPipelineRequest,
    referenceAnalysis: ReferenceAnalysis | null,
  ) {
    return {
      referenceVideoUrl: this.normalizeOptionalString(input.referenceVideoUrl),
      category: this.normalizeOptionalString(input.category) || referenceAnalysis?.category || '',
      style: this.normalizeOptionalString(input.style) || referenceAnalysis?.style || '',
      duration: this.normalizeNumber(input.duration) || Number(referenceAnalysis?.duration || 0),
      budget: this.normalizeNumber(input.budget),
      description: this.normalizeOptionalString(input.description),
    }
  }

  private calculateCategoryMatch(request: Record<string, any>, template: TemplateRecord) {
    const requestedCategory = this.normalizeOptionalString(request['category'])
    const templateCategories = this.normalizeStringList(template['categories'])

    if (!requestedCategory || templateCategories.length === 0) {
      return {
        requested: requestedCategory || null,
        matched: false,
        score: 0.5,
      }
    }

    const exactMatch = templateCategories.some(
      category => category.toLowerCase() === requestedCategory.toLowerCase(),
    )
    if (exactMatch) {
      return {
        requested: requestedCategory,
        matched: true,
        score: 1,
      }
    }

    const partialMatch = templateCategories.some(
      category => category.includes(requestedCategory) || requestedCategory.includes(category),
    )
    return {
      requested: requestedCategory,
      matched: partialMatch,
      score: partialMatch ? 0.7 : 0,
    }
  }

  private calculateStyleMatch(request: Record<string, any>, template: TemplateRecord) {
    const requestedStyle = this.normalizeOptionalString(request['style'])
    const templateStyles = this.normalizeStringList(template['styles'])

    if (!requestedStyle || templateStyles.length === 0) {
      return {
        requested: requestedStyle || null,
        matched: false,
        score: 0.5,
      }
    }

    const exactMatch = templateStyles.some(
      style => style.toLowerCase() === requestedStyle.toLowerCase(),
    )
    if (exactMatch) {
      return {
        requested: requestedStyle,
        matched: true,
        score: 1,
      }
    }

    const partialMatch = templateStyles.some(
      style => style.includes(requestedStyle) || requestedStyle.includes(style),
    )
    return {
      requested: requestedStyle,
      matched: partialMatch,
      score: partialMatch ? 0.7 : 0,
    }
  }

  private calculateBudgetFit(request: Record<string, any>, template: TemplateRecord) {
    const budget = Number(request['budget'] || 0)
    const templateCost = Number(template['costPerVideo'] || 0)

    if (budget <= 0 || templateCost <= 0) {
      return {
        requested: budget || null,
        estimated: templateCost || null,
        score: 0.5,
      }
    }

    if (templateCost <= budget) {
      return {
        requested: budget,
        estimated: templateCost,
        score: 1,
      }
    }

    const overflowRatio = (templateCost - budget) / Math.max(budget, 1)
    return {
      requested: budget,
      estimated: templateCost,
      score: Math.max(0, Number((1 - overflowRatio).toFixed(2))),
    }
  }

  private calculateDurationFit(request: Record<string, any>, template: TemplateRecord) {
    const duration = Number(request['duration'] || 0)
    const range = Array.isArray(template['durationRange']) ? template['durationRange'] : []

    if (duration <= 0 || range.length < 2) {
      return {
        requested: duration || null,
        range: range.length === 2 ? range : null,
        score: 0.5,
      }
    }

    const minDuration = Number(range[0] || 0)
    const maxDuration = Number(range[1] || 0)
    if (duration >= minDuration && duration <= maxDuration) {
      return {
        requested: duration,
        range: [minDuration, maxDuration],
        score: 1,
      }
    }

    const nearest = duration < minDuration ? minDuration : maxDuration
    const tolerance = Math.max(5, Math.abs(maxDuration - minDuration) || Math.round(duration * 0.25))
    const distance = Math.abs(duration - nearest)
    return {
      requested: duration,
      range: [minDuration, maxDuration],
      score: Math.max(0, Number((1 - distance / tolerance).toFixed(2))),
    }
  }

  private buildAdjustments(request: Record<string, any>, template: TemplateRecord) {
    const adjustments: string[] = []
    const categories = this.normalizeStringList(template['categories'])
    const styles = this.normalizeStringList(template['styles'])
    const durationRange = Array.isArray(template['durationRange']) ? template['durationRange'] : []
    const requestedCategory = this.normalizeOptionalString(request['category'])
    const requestedStyle = this.normalizeOptionalString(request['style'])
    const requestedDuration = Number(request['duration'] || 0)
    const requestedBudget = Number(request['budget'] || 0)
    const templateCost = Number(template['costPerVideo'] || 0)

    if (requestedCategory && categories.length > 0 && !categories.some(
      category => category.toLowerCase() === requestedCategory.toLowerCase(),
    )) {
      adjustments.push(`补充 ${requestedCategory} 品类素材映射`)
    }
    if (requestedStyle && styles.length > 0 && !styles.some(
      style => style.toLowerCase() === requestedStyle.toLowerCase(),
    )) {
      adjustments.push(`增加 ${requestedStyle} 风格参数调优`)
    }
    if (requestedDuration > 0 && durationRange.length === 2) {
      const minDuration = Number(durationRange[0] || 0)
      const maxDuration = Number(durationRange[1] || 0)
      if (requestedDuration < minDuration || requestedDuration > maxDuration) {
        adjustments.push(`时长从 ${minDuration}-${maxDuration}s 调整到 ${requestedDuration}s`)
      }
    }
    if (requestedBudget > 0 && templateCost > requestedBudget) {
      adjustments.push('预算超出，需要裁剪镜头或切换低成本素材')
    }

    return adjustments
  }

  private resolveMatchLevel(matchScore: number) {
    if (matchScore > 80) {
      return 'direct_match'
    }
    if (matchScore >= 60) {
      return 'needs_param_tuning'
    }
    return 'new_pipeline_needed'
  }

  private toTemplateResponse(template: TemplateRecord) {
    return {
      id: template['_id'].toString(),
      templateId: template['templateId'] || template['_id'].toString(),
      name: template['name'],
      description: template['description'] || '',
      categories: template['categories'] || [],
      styles: template['styles'] || [],
      durationRange: template['durationRange'] || null,
      costPerVideo: Number(template['costPerVideo'] || 0),
      qualityStars: Number(template['qualityStars'] || 0),
      limitations: template['limitations'] || [],
      verifiedClients: template['verifiedClients'] || [],
      defaultParams: template['defaultParams'] || {},
      status: template['status'] || PipelineTemplateStatus.ACTIVE,
      type: template['type'],
      isPublic: Boolean(template['isPublic']),
      createdBy: template['createdBy'],
      usageCount: Number(template['usageCount'] || 0),
      capabilityTags: this.buildCapabilityTags(template),
      createdAt: template['createdAt'] || null,
      updatedAt: template['updatedAt'] || null,
    }
  }

  private buildCapabilityTags(template: TemplateRecord) {
    const tags = [
      ...this.normalizeStringList(template['categories']),
      ...this.normalizeStringList(template['styles']),
      template['status'] || PipelineTemplateStatus.ACTIVE,
      template['qualityStars'] ? `${template['qualityStars']}星` : '',
    ].filter(Boolean)

    return Array.from(new Set(tags))
  }

  private async resolveUniqueTemplateId(templateId: string | undefined, name: string) {
    const baseId = this.normalizeOptionalString(templateId) || this.slugify(name)
    if (!baseId) {
      throw new BadRequestException('templateId is required')
    }

    const existing = await this.pipelineTemplateModel.findOne({ templateId: baseId }).lean().exec()
    if (existing) {
      throw new BadRequestException('templateId already exists')
    }

    return baseId
  }

  private normalizeDefaultParams(value: Record<string, unknown> | undefined) {
    const source = value || {}
    const duration = this.normalizeNumber(source['duration']) || 15
    const aspectRatio = this.normalizeOptionalString(source['aspectRatio']) || '9:16'
    const subtitleStyle = this.asRecord(source['subtitleStyle']) || {}
    const musicStyle = this.normalizeOptionalString(source['musicStyle'])
    const extra = {
      ...(this.asRecord(source['extra']) || {}),
    }

    for (const [key, currentValue] of Object.entries(source)) {
      if (['duration', 'aspectRatio', 'subtitleStyle', 'musicStyle', 'extra'].includes(key)) {
        continue
      }
      extra[key] = currentValue
    }

    return {
      duration,
      aspectRatio,
      subtitleStyle,
      musicStyle,
      extra,
    }
  }

  private normalizeDurationRange(value: [number, number] | undefined) {
    if (!Array.isArray(value) || value.length < 2) {
      return undefined
    }

    const first = this.normalizeNumber(value[0])
    const second = this.normalizeNumber(value[1])
    if (first <= 0 || second <= 0) {
      return undefined
    }

    return first <= second ? [first, second] as [number, number] : [second, first] as [number, number]
  }

  private normalizeQualityStars(value: unknown) {
    const normalized = Math.round(this.normalizeNumber(value))
    if (normalized <= 0) {
      return 0
    }
    return Math.min(Math.max(normalized, 1), 5)
  }

  private normalizeNumber(value: unknown) {
    const normalized = Number(value || 0)
    return Number.isFinite(normalized) ? normalized : 0
  }

  private normalizeOptionalString(value: unknown) {
    return typeof value === 'string' ? value.trim() : ''
  }

  private normalizeRequiredString(value: unknown, field: string) {
    const normalized = this.normalizeOptionalString(value)
    if (!normalized) {
      throw new BadRequestException(`${field} is required`)
    }
    return normalized
  }

  private normalizeStringList(value: unknown) {
    if (!Array.isArray(value)) {
      return []
    }

    return Array.from(new Set(value
      .map(item => typeof item === 'string' ? item.trim() : '')
      .filter(Boolean)))
  }

  private normalizeTemplateStatus(value: unknown, defaultToActive = true) {
    const normalized = this.normalizeOptionalString(value).toLowerCase()
    if (!normalized) {
      return defaultToActive ? PipelineTemplateStatus.ACTIVE : null
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

    throw new BadRequestException('Invalid template status')
  }

  private normalizePipelineType(value: unknown, throwOnInvalid = true) {
    const normalized = this.normalizeOptionalString(value).toLowerCase()
    if (!normalized) {
      return null
    }

    for (const candidate of Object.values(PipelineType)) {
      if (candidate === normalized) {
        return candidate
      }
    }

    if (throwOnInvalid) {
      throw new BadRequestException('Invalid pipeline type')
    }
    return null
  }

  private inferPipelineType(category: string, style: string) {
    const tokens = `${category} ${style}`.toLowerCase()
    if (tokens.includes('教程') || tokens.includes('教学') || tokens.includes('讲解') || tokens.includes('explain')) {
      return PipelineType.BRAND_STORY
    }
    if (tokens.includes('新品') || tokens.includes('开箱') || tokens.includes('product')) {
      return PipelineType.NEW_PRODUCT
    }
    if (tokens.includes('直播') || tokens.includes('live')) {
      return PipelineType.SEEDING
    }
    return PipelineType.PROMO
  }

  private inferPipelineTypeFromTemplate(input: CreateTemplateInput) {
    return this.inferPipelineType(
      this.normalizeStringList(input.categories).join(' '),
      this.normalizeStringList(input.styles).join(' '),
    )
  }

  private buildTemplateLookupQuery(id: string) {
    const normalized = this.normalizeRequiredString(id, 'templateId')
    if (Types.ObjectId.isValid(normalized)) {
      return {
        $or: [
          { _id: new Types.ObjectId(normalized) },
          { templateId: normalized },
        ],
      }
    }

    return { templateId: normalized }
  }

  private normalizeKeyword(value: unknown) {
    return this.normalizeOptionalString(value).toLowerCase()
  }

  private containsKeywordInList(list: unknown, keyword: string) {
    return this.normalizeStringList(list).some(item => item.toLowerCase().includes(keyword))
  }

  private slugify(value: string) {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9一-龥]+/g, '-')
      .replace(/^-+|-+$/g, '')
  }

  private pickFirstMatching(source: string, groups: string[][]) {
    for (const group of groups) {
      const matched = group.find(item => source.includes(item.toLowerCase()))
      if (matched) {
        return matched
      }
    }

    return ''
  }

  private extractDurationFromUrl(source: string) {
    const matched = source.match(/(\d{1,3})s/)
    if (!matched) {
      return 30
    }

    const duration = Number(matched[1] || 30)
    return Number.isFinite(duration) ? duration : 30
  }

  private async findReferenceContent(videoUrl: string): Promise<ViralContentRecord | null> {
    const normalizedUrl = this.normalizeOptionalString(videoUrl)
    if (!normalizedUrl) {
      return null
    }

    const normalizedUrlWithoutQuery = this.stripUrlSearchAndHash(normalizedUrl)
    const videoId = this.extractVideoIdFromUrl(normalizedUrl)
    const orConditions: Array<Record<string, unknown>> = []

    if (normalizedUrl) {
      orConditions.push({ contentUrl: normalizedUrl })
    }
    if (normalizedUrlWithoutQuery && normalizedUrlWithoutQuery !== normalizedUrl) {
      orConditions.push({ contentUrl: normalizedUrlWithoutQuery })
    }
    if (videoId) {
      orConditions.push({ videoId })
    }

    if (orConditions.length === 0) {
      return null
    }

    return this.viralContentModel.findOne({ $or: orConditions })
      .sort({ viralScore: -1, discoveredAt: -1 })
      .lean()
      .exec() as Promise<ViralContentRecord | null>
  }

  private async buildReferenceAnalysisFromContent(
    videoUrl: string,
    content: ViralContentRecord,
  ): Promise<ReferenceAnalysis> {
    const analysis = this.asRecord(
      await this.contentRemixService.analyzeViralElements(content['_id'].toString()),
    ) || {}
    const category = this.resolveCategoryFromContent(content, analysis)
    const style = this.resolveStyleFromContent(content, analysis)
    const keyElements = Array.from(new Set([
      ...this.normalizeStringList(content['keywords']).slice(0, 3),
      ...this.normalizeStringList(analysis['hooks']).slice(0, 2),
      ...this.normalizeStringList(analysis['visualMotifs']).slice(0, 2),
      ...this.normalizeStringList(analysis['copyStyle']).slice(0, 1),
    ])).slice(0, 6)
    const note = this.normalizeOptionalString(analysis['summary'])
      || `已基于素材库内容 ${content['_id'].toString()} 完成参考视频分析`

    return {
      videoUrl,
      category,
      style,
      duration: this.extractDurationFromUrl(videoUrl.toLowerCase()),
      keyElements,
      suggestedTemplateType: this.inferPipelineType(category, style),
      analysisSource: 'content_remix',
      matchedContentId: content['_id'].toString(),
      note,
    }
  }

  private buildPendingManualReferenceAnalysis(videoUrl: string): ReferenceAnalysis {
    return {
      videoUrl,
      category: '',
      style: '',
      duration: this.extractDurationFromUrl(videoUrl.toLowerCase()),
      keyElements: [],
      suggestedTemplateType: PipelineType.PROMO,
      analysisSource: 'pending_manual',
      matchedContentId: null,
      note: '未在爆款素材库中找到可复用的参考视频分析，请人工补充拆解后再进行精确模板匹配。',
    }
  }

  private resolveCategoryFromContent(
    content: ViralContentRecord,
    analysis: Record<string, unknown>,
  ) {
    const contentIndustry = this.normalizeOptionalString(content['industry'])
    if (contentIndustry) {
      return contentIndustry
    }

    const categoryTokens = [
      this.normalizeOptionalString(content['title']),
      ...this.normalizeStringList(content['keywords']),
      ...this.normalizeStringList(analysis['hooks']),
      ...this.normalizeStringList(analysis['tagStrategy']),
      this.normalizeOptionalString(analysis['summary']),
    ].join(' ').toLowerCase()

    return this.pickFirstMatching(categoryTokens, [
      ['makeup', 'lipstick', 'skincare', 'beauty', '美妆'],
      ['food', 'snack', 'drink', '食品', '饮料'],
      ['tutorial', 'guide', 'explain', '教学', '教程', '规则'],
      ['bar', 'cocktail', '酒吧'],
    ]) || '通用'
  }

  private resolveStyleFromContent(
    content: ViralContentRecord,
    analysis: Record<string, unknown>,
  ) {
    const styleTokens = [
      this.normalizeOptionalString(content['title']),
      ...this.normalizeStringList(content['keywords']),
      ...this.normalizeStringList(analysis['visualMotifs']),
      ...this.normalizeStringList(analysis['copyStyle']),
      ...this.normalizeStringList(analysis['structureBreakdown']),
      this.normalizeOptionalString(analysis['summary']),
    ].join(' ').toLowerCase()

    return this.pickFirstMatching(styleTokens, [
      ['unbox', '开箱'],
      ['live', '直播', 'scene', '场景'],
      ['tutorial', 'guide', '教程', '讲解'],
      ['showcase', 'product', '产品'],
    ]) || '产品展示'
  }

  private stripUrlSearchAndHash(value: string) {
    try {
      const url = new URL(value)
      url.search = ''
      url.hash = ''
      return url.toString().replace(/\/+$/, '')
    }
    catch {
      return value.split(/[?#]/)[0]?.replace(/\/+$/, '') || value
    }
  }

  private extractVideoIdFromUrl(value: string) {
    try {
      const url = new URL(value)
      const queryKeys = ['videoId', 'video_id', 'itemId', 'item_id', 'aweme_id', 'vid', 'id']
      for (const key of queryKeys) {
        const candidate = this.normalizeOptionalString(url.searchParams.get(key))
        if (candidate) {
          return candidate
        }
      }

      const segments = url.pathname.split('/').map(item => item.trim()).filter(Boolean)
      const lastSegment = segments.at(-1) || ''
      return /^[a-z0-9_-]{5,}$/i.test(lastSegment) ? lastSegment : ''
    }
    catch {
      return ''
    }
  }

  private asRecord(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
  }
}
