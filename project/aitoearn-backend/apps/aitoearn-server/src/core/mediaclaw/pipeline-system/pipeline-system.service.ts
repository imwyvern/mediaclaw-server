import { InjectQueue } from '@nestjs/bullmq'
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import {
  Pipeline,
  PipelineStatus,
  PipelineTemplate,
  PipelineType,
  VideoTask,
  VideoTaskStatus,
  VideoTaskType,
} from '@yikart/mongodb'
import { Queue } from 'bullmq'
import { Model, Types } from 'mongoose'
import { PipelineService } from '../pipeline/pipeline.service'
import { VIDEO_WORKER_QUEUE, VIDEO_WORKER_STEPS, VideoWorkerJobData } from '../worker/worker.constants'

interface PipelineTemplateStepInput {
  name: string
  config?: Record<string, any>
  order?: number
}

interface CreateTemplateInput {
  templateId?: string
  name: string
  type?: PipelineType
  description?: string
  categories?: string[]
  styles?: string[]
  steps?: PipelineTemplateStepInput[]
  defaultParams?: {
    duration?: number
    aspectRatio?: string
    subtitleStyle?: Record<string, any>
    musicStyle?: string
  }
  isPublic?: boolean
  createdBy: string
}

interface ListTemplateFilters {
  type?: PipelineType
  isPublic?: boolean
  keyword?: string
  presetOnly?: boolean
  requestedBy?: string
}

interface ApplyTemplateOverrides {
  name?: string
  description?: string
  styleConfig?: Record<string, any>
  distributionRules?: Record<string, any>
  groupBinding?: Record<string, any>
  routingConfigId?: string
  subtitleStyle?: Record<string, any>
  musicStyle?: string
  preferredStyles?: string[]
  avoidStyles?: string[]
  schedule?: Record<string, any>
  preference?: string
}

interface LearnPreferenceInput {
  source?: string
  preference?: string
  preferredStyles?: string[]
  avoidStyles?: string[]
  subtitleStyle?: Record<string, any>
  score?: number
  notes?: string
  rejectionReason?: string
}

const SYSTEM_PIPELINE_TEMPLATES: Array<{
  templateId: string
  name: string
  description: string
  type: PipelineType
  categories: string[]
  styles: string[]
  defaultParams: {
    duration: number
    aspectRatio: string
    subtitleStyle: Record<string, any>
    musicStyle: string
  }
  steps: PipelineTemplateStepInput[]
}> = [
  {
    templateId: 'preset-seeding-line',
    name: '种草线',
    description: '适合生活化安利、体验分享和轻转化内容。',
    type: PipelineType.SEEDING,
    categories: ['种草', '口碑', '生活方式'],
    styles: ['口语化', '生活化', '轻转化'],
    defaultParams: {
      duration: 15,
      aspectRatio: '9:16',
      subtitleStyle: { emphasis: 'hook-first' },
      musicStyle: 'light-pop',
    },
    steps: [
      { name: 'brief', order: 1, config: { focus: 'selling-points' } },
      { name: 'copy', order: 2, config: { tone: 'spoken' } },
      { name: 'render', order: 3, config: { aspectRatio: '9:16' } },
      { name: 'distribution', order: 4, config: { summary: 'seed-dispatch' } },
    ],
  },
  {
    templateId: 'preset-review-line',
    name: '测评线',
    description: '适合对比、测评和使用场景验证内容。',
    type: PipelineType.REVIEW,
    categories: ['测评', '对比', '体验'],
    styles: ['可信背书', '对比分析', '结果导向'],
    defaultParams: {
      duration: 30,
      aspectRatio: '9:16',
      subtitleStyle: { emphasis: 'fact-first' },
      musicStyle: 'steady-review',
    },
    steps: [
      { name: 'brief', order: 1, config: { focus: 'comparison' } },
      { name: 'script', order: 2, config: { structure: 'pain-solution-proof' } },
      { name: 'render', order: 3, config: { pacing: 'steady' } },
      { name: 'distribution', order: 4, config: { summary: 'review-dispatch' } },
    ],
  },
  {
    templateId: 'preset-new-product-line',
    name: '新品宣传线',
    description: '适合新品上市、卖点首发和活动造势。',
    type: PipelineType.NEW_PRODUCT,
    categories: ['新品', '上市', '首发'],
    styles: ['新品首发', '高光卖点', '节奏偏快'],
    defaultParams: {
      duration: 20,
      aspectRatio: '9:16',
      subtitleStyle: { emphasis: 'launch-highlight' },
      musicStyle: 'launch-energy',
    },
    steps: [
      { name: 'brief', order: 1, config: { focus: 'launch' } },
      { name: 'copy', order: 2, config: { CTA: 'preheat' } },
      { name: 'render', order: 3, config: { pacing: 'fast' } },
      { name: 'distribution', order: 4, config: { summary: 'new-product-dispatch' } },
    ],
  },
  {
    templateId: 'preset-brand-story-line',
    name: '品牌故事线',
    description: '适合讲品牌理念、创始故事和信任沉淀。',
    type: PipelineType.BRAND_STORY,
    categories: ['品牌故事', '理念', '信任'],
    styles: ['叙事', '情绪递进', '品牌表达'],
    defaultParams: {
      duration: 45,
      aspectRatio: '9:16',
      subtitleStyle: { emphasis: 'storytelling' },
      musicStyle: 'warm-story',
    },
    steps: [
      { name: 'brief', order: 1, config: { focus: 'narrative' } },
      { name: 'script', order: 2, config: { structure: 'origin-values-proof' } },
      { name: 'render', order: 3, config: { pacing: 'slow-burn' } },
      { name: 'distribution', order: 4, config: { summary: 'story-dispatch' } },
    ],
  },
  {
    templateId: 'preset-promo-line',
    name: '促销线',
    description: '适合大促、限时活动和强转化投放。',
    type: PipelineType.PROMO,
    categories: ['促销', '活动', '转化'],
    styles: ['强刺激', '倒计时', '行动号召'],
    defaultParams: {
      duration: 18,
      aspectRatio: '9:16',
      subtitleStyle: { emphasis: 'offer-first' },
      musicStyle: 'promo-urgent',
    },
    steps: [
      { name: 'brief', order: 1, config: { focus: 'offer' } },
      { name: 'copy', order: 2, config: { CTA: 'strong' } },
      { name: 'render', order: 3, config: { pacing: 'high' } },
      { name: 'distribution', order: 4, config: { summary: 'promo-dispatch' } },
    ],
  },
]

@Injectable()
export class PipelineSystemService implements OnModuleInit {
  constructor(
    @InjectModel(PipelineTemplate.name)
    private readonly pipelineTemplateModel: Model<PipelineTemplate>,
    @InjectModel(Pipeline.name)
    private readonly pipelineModel: Model<Pipeline>,
    @InjectModel(VideoTask.name)
    private readonly videoTaskModel: Model<VideoTask>,
    @InjectQueue(VIDEO_WORKER_QUEUE)
    private readonly videoWorkerQueue: Queue<VideoWorkerJobData>,
    private readonly pipelineService: PipelineService,
  ) {}

  async onModuleInit() {
    await this.ensurePresetTemplates()
  }

  async createTemplate(data: CreateTemplateInput) {
    const name = data.name?.trim()
    const createdBy = data.createdBy?.trim()

    if (!name) {
      throw new BadRequestException('name is required')
    }
    if (!createdBy) {
      throw new BadRequestException('createdBy is required')
    }
    this.ensurePipelineType(data.type || PipelineType.CUSTOM)

    return this.pipelineTemplateModel.create({
      templateId: this.normalizeOptionalString(data.templateId) || this.slugify(name),
      name,
      type: data.type || PipelineType.CUSTOM,
      description: this.normalizeOptionalString(data.description),
      categories: this.normalizeUniqueStrings(data.categories),
      styles: this.normalizeUniqueStrings(data.styles),
      steps: this.normalizeTemplateSteps(data.steps),
      defaultParams: this.normalizeDefaultParams(data.defaultParams),
      isPublic: data.isPublic ?? false,
      createdBy,
      usageCount: 0,
    })
  }

  async listTemplates(filters: ListTemplateFilters) {
    const query = this.buildTemplateQuery(filters)
    const items = await this.pipelineTemplateModel
      .find(query)
      .sort({ usageCount: -1, createdAt: -1 })
      .lean()
      .exec()

    return items.map(item => ({
      id: item._id.toString(),
      templateId: item.templateId || item._id.toString(),
      name: item.name,
      description: item.description || '',
      categories: item.categories || [],
      styles: item.styles || [],
      type: item.type,
      steps: item.steps,
      defaultParams: item.defaultParams,
      isPublic: item.isPublic,
      createdBy: item.createdBy,
      usageCount: item.usageCount,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }))
  }

  async getTemplate(id: string, requestedBy?: string) {
    const template = await this.findAccessibleTemplate(id, requestedBy)

    if (!template) {
      throw new NotFoundException('Pipeline template not found')
    }

    return {
      id: template._id.toString(),
      templateId: template.templateId || template._id.toString(),
      name: template.name,
      description: template.description || '',
      categories: template.categories || [],
      styles: template.styles || [],
      type: template.type,
      steps: template.steps,
      defaultParams: template.defaultParams,
      isPublic: template.isPublic,
      createdBy: template.createdBy,
      usageCount: template.usageCount,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    }
  }

  async applyTemplate(
    templateId: string,
    requestedBy: string,
    orgId: string,
    brandId: string,
    overrides: ApplyTemplateOverrides = {},
  ) {
    const template = await this.findAccessibleTemplate(templateId, requestedBy)

    if (!template) {
      throw new NotFoundException('Pipeline template not found')
    }

    const templateSteps = this.normalizeTemplateSteps(template.steps)
    const styleConfig = {
      ...(this.asRecord(overrides.styleConfig) || {}),
      duration: Number(this.asRecord(overrides.styleConfig)?.['duration'] || template.defaultParams?.duration || 15),
      aspectRatio: this.normalizeOptionalString(this.asRecord(overrides.styleConfig)?.['aspectRatio'])
        || template.defaultParams?.aspectRatio
        || '9:16',
      visualStyle: this.normalizeOptionalString(this.asRecord(overrides.styleConfig)?.['visualStyle'])
        || template.styles?.[0]
        || '',
    }
    const pipeline = await this.pipelineService.create(orgId, brandId, {
      name: this.normalizeOptionalString(overrides.name) || template.name,
      description: this.normalizeOptionalString(overrides.description) || `Generated from template ${template.name}`,
      type: template.type,
      templateId: template.templateId || template._id.toString(),
      routingConfigId: this.normalizeOptionalString(overrides.routingConfigId),
      styleConfig,
      distributionRules: this.asRecord(overrides.distributionRules) || {},
      groupBinding: this.asRecord(overrides.groupBinding) || {},
      preferences: {
        preferredStyles: this.normalizeUniqueStrings(overrides.preferredStyles),
        avoidStyles: this.normalizeUniqueStrings(overrides.avoidStyles),
        preferredDuration: styleConfig.duration,
        aspectRatio: styleConfig.aspectRatio,
        subtitlePreferences: {
          ...(template.defaultParams?.subtitleStyle || {}),
          ...(overrides.subtitleStyle || {}),
          musicStyle: overrides.musicStyle || template.defaultParams?.musicStyle || '',
          templateId: template.templateId || template._id.toString(),
          templateName: template.name,
          templateSteps,
        },
      },
      schedule: this.normalizeSchedule(overrides.schedule),
    })

    await this.pipelineTemplateModel.findByIdAndUpdate(template._id, {
      $inc: { usageCount: 1 },
    }).exec()

    return pipeline
  }

  async learnPreference(orgId: string, pipelineId: string, feedback: LearnPreferenceInput) {
    const pipeline = await this.findOwnedPipeline(orgId, pipelineId)
    const pipelineQuery = this.buildPipelineOwnershipQuery(orgId, pipelineId)
    const sourceMeta = this.normalizePreferenceSource(feedback.source)
    const existingTrainingPreferences = this.normalizeTrainingPreferences(pipeline['trainingPreferences'])
    const newEntry = {
      source: sourceMeta.label,
      sourceType: sourceMeta.type,
      preference: this.normalizePreferenceText(feedback),
      applied: true,
      priority: sourceMeta.priority,
      score: typeof feedback.score === 'number' ? feedback.score : null,
      notes: this.normalizeOptionalString(feedback.notes),
      metadata: {
        preferredStyles: this.normalizeUniqueStrings(feedback.preferredStyles),
        avoidStyles: this.normalizeUniqueStrings(feedback.avoidStyles),
        subtitleStyle: this.asRecord(feedback.subtitleStyle) || {},
        rejectionReason: this.normalizeOptionalString(feedback.rejectionReason),
      },
      createdAt: new Date(),
    }
    const trainingPreferences = [...existingTrainingPreferences, newEntry]
    const aggregatedPreferences = this.aggregatePreferences(
      trainingPreferences,
      this.asRecord(pipeline.preferences),
    )

    return this.pipelineModel.findOneAndUpdate(
      pipelineQuery,
      {
        $set: {
          'preferences.preferredStyles': aggregatedPreferences.preferredStyles,
          'preferences.avoidStyles': aggregatedPreferences.avoidStyles,
          'preferences.subtitlePreferences': aggregatedPreferences.subtitlePreferences,
          'preferences.preferredDuration': aggregatedPreferences.preferredDuration,
          'preferences.aspectRatio': aggregatedPreferences.aspectRatio,
          trainingPreferences,
        },
        $inc: {
          'preferences.feedbackCount': 1,
        },
      },
      { new: true },
    ).exec()
  }

  async warmUp(orgId: string, pipelineId: string, requestedBy?: string) {
    const pipeline = await this.findOwnedPipeline(orgId, pipelineId)
    if (pipeline.status !== PipelineStatus.ACTIVE) {
      throw new BadRequestException('Only active pipelines can be warmed up')
    }

    const firstStep = VIDEO_WORKER_STEPS[0]
    const requestedUserId = requestedBy?.trim() || 'system:warm-up'
    const createdAt = new Date().toISOString()

    const createdTasks = await Promise.all(
      Array.from({ length: 3 }, async (_, index) => {
        const taskId = new Types.ObjectId()
        const task = await this.videoTaskModel.create({
          _id: taskId,
          userId: requestedUserId,
          orgId: pipeline.orgId,
          brandId: pipeline.brandId,
          pipelineId: pipeline._id,
          taskType: VideoTaskType.NEW_CONTENT,
          status: VideoTaskStatus.PENDING,
          sourceVideoUrl: '',
          creditsConsumed: 0,
          creditCharged: false,
          metadata: {
            warmUp: true,
            warmUpIndex: index + 1,
            templateId: pipeline.preferences?.subtitlePreferences?.['templateId'] || null,
            timeline: [
              this.createTimelineEntry('created', createdAt, 'Warm-up task created'),
              this.createTimelineEntry('queued', createdAt, 'Warm-up task queued', VideoTaskStatus.PENDING),
            ],
          },
        })

        await this.videoWorkerQueue.add(
          firstStep,
          { taskId: task._id.toString() },
          { jobId: `${task._id.toString()}:${firstStep}:warm-up` },
        )

        return {
          id: task._id.toString(),
          status: task.status,
          taskType: task.taskType,
          warmUpIndex: index + 1,
        }
      }),
    )

    const queuedTaskIds = createdTasks.map(task => task.id)
    await this.pipelineModel.findOneAndUpdate(
      this.buildPipelineOwnershipQuery(orgId, pipelineId),
      {
        $set: {
          warmUp: {
            required: false,
            status: 'queued',
            lastTriggeredAt: new Date(),
            queuedTaskIds,
          },
        },
      },
      { new: true },
    ).exec()

    return {
      pipelineId: pipeline._id.toString(),
      queued: createdTasks.length,
      warmUpStatus: 'queued',
      tasks: createdTasks,
    }
  }

  private buildTemplateQuery(filters: ListTemplateFilters) {
    const query: Record<string, any> = {}

    if (filters.type) {
      this.ensurePipelineType(filters.type)
      query['type'] = filters.type
    }

    if (filters.presetOnly) {
      query['createdBy'] = 'system'
    }

    if (this.normalizeOptionalString(filters.keyword)) {
      query['name'] = {
        $regex: this.escapeRegex(filters.keyword || ''),
        $options: 'i',
      }
    }

    if (typeof filters.isPublic === 'boolean') {
      query['isPublic'] = filters.isPublic
      if (filters.isPublic === false && filters.requestedBy) {
        query['createdBy'] = filters.requestedBy
      }
      return query
    }

    if (filters.requestedBy) {
      query['$or'] = [
        { isPublic: true },
        { createdBy: filters.requestedBy },
      ]
    }

    return query
  }

  private async findAccessibleTemplate(templateId: string, requestedBy?: string) {
    const normalizedTemplateId = this.normalizeOptionalString(templateId)
    const identifierQuery = Types.ObjectId.isValid(normalizedTemplateId)
      ? {
          $or: [
            { templateId: normalizedTemplateId },
            { _id: this.toObjectId(normalizedTemplateId, 'templateId') },
          ],
        }
      : {
          templateId: normalizedTemplateId,
        }

    const accessQuery = requestedBy?.trim()
      ? {
          $or: [
            { isPublic: true },
            { createdBy: requestedBy.trim() },
          ],
        }
      : { isPublic: true }

    return this.pipelineTemplateModel.findOne({
      $and: [
        identifierQuery,
        accessQuery,
      ],
    }).lean().exec()
  }

  private async findOwnedPipeline(orgId: string, pipelineId: string) {
    const pipeline = await this.pipelineModel
      .findOne(this.buildPipelineOwnershipQuery(orgId, pipelineId))
      .lean()
      .exec()

    if (!pipeline) {
      throw new NotFoundException('Pipeline not found')
    }

    return pipeline
  }

  private buildPipelineOwnershipQuery(orgId: string, pipelineId: string) {
    return {
      _id: this.toObjectId(pipelineId, 'pipelineId'),
      orgId: this.toObjectId(orgId, 'orgId'),
    }
  }

  private normalizeTemplateSteps(steps?: PipelineTemplateStepInput[]) {
    return (steps || [])
      .filter(step => step?.name?.trim())
      .map((step, index) => ({
        name: step.name.trim(),
        config: step.config || {},
        order: step.order ?? index + 1,
      }))
      .sort((left, right) => left.order - right.order)
  }

  private normalizeDefaultParams(defaultParams?: CreateTemplateInput['defaultParams']) {
    return {
      duration: defaultParams?.duration || 15,
      aspectRatio: defaultParams?.aspectRatio?.trim() || '9:16',
      subtitleStyle: defaultParams?.subtitleStyle || {},
      musicStyle: defaultParams?.musicStyle?.trim() || '',
    }
  }

  private normalizeSchedule(schedule?: Record<string, any>) {
    return {
      enabled: Boolean(schedule?.['enabled']),
      cron: typeof schedule?.['cron'] === 'string' && schedule['cron'].trim()
        ? schedule['cron'].trim()
        : '0 9 * * 1-5',
      videosPerRun: Number(schedule?.['videosPerRun']) > 0
        ? Number(schedule?.['videosPerRun'])
        : 1,
      timezone: typeof schedule?.['timezone'] === 'string' && schedule['timezone'].trim()
        ? schedule['timezone'].trim()
        : 'Asia/Shanghai',
    }
  }

  private async ensurePresetTemplates() {
    await Promise.all(
      SYSTEM_PIPELINE_TEMPLATES.map(template =>
        this.pipelineTemplateModel.findOneAndUpdate(
          { templateId: template.templateId },
          {
            $set: {
              name: template.name,
              description: template.description,
              categories: template.categories,
              styles: template.styles,
              type: template.type,
              steps: this.normalizeTemplateSteps(template.steps),
              defaultParams: this.normalizeDefaultParams(template.defaultParams),
              isPublic: true,
              createdBy: 'system',
            },
            $setOnInsert: {
              templateId: template.templateId,
              usageCount: 0,
            },
          },
          {
            upsert: true,
            new: true,
          },
        ).exec(),
      ),
    )
  }

  private normalizeTrainingPreferences(values: unknown) {
    return (Array.isArray(values) ? values : [])
      .map((item) => {
        const record = this.asRecord(item)
        return {
          source: this.normalizeOptionalString(record?.['source']),
          sourceType: this.normalizeOptionalString(record?.['sourceType']) || 'custom',
          preference: this.normalizeOptionalString(record?.['preference']),
          applied: record?.['applied'] !== false,
          priority: Number(record?.['priority'] || 0),
          score: typeof record?.['score'] === 'number' ? record['score'] : null,
          notes: this.normalizeOptionalString(record?.['notes']),
          metadata: this.asRecord(record?.['metadata']) || {},
          createdAt: record?.['createdAt'] ? new Date(record['createdAt']) : new Date(0),
        }
      })
      .filter(item => item.source || item.preference)
  }

  private aggregatePreferences(trainingPreferences: Array<Record<string, any>>, existingPreferences?: Record<string, any> | null) {
    const sorted = [...trainingPreferences].sort((left, right) => {
      if (right['priority'] !== left['priority']) {
        return Number(right['priority'] || 0) - Number(left['priority'] || 0)
      }

      return new Date(right['createdAt']).getTime() - new Date(left['createdAt']).getTime()
    })

    const preferredStyles: string[] = []
    const avoidStyles: string[] = []
    const subtitleStylesByPriority = [...sorted].reverse()
    const baseSubtitlePreferences = this.asRecord(existingPreferences?.['subtitlePreferences']) || {}
    const feedbackWeights = sorted.reduce<Record<string, number>>((acc, item) => {
      const sourceType = this.normalizeOptionalString(item['sourceType']) || 'custom'
      acc[sourceType] = Number(acc[sourceType] || 0) + Number(item['priority'] || 0)
      acc['total'] = Number(acc['total'] || 0) + Number(item['priority'] || 0)
      return acc
    }, {})

    for (const item of sorted) {
      const metadata = this.asRecord(item['metadata']) || {}
      for (const style of this.normalizeUniqueStrings(metadata['preferredStyles'])) {
        if (!preferredStyles.includes(style)) {
          preferredStyles.push(style)
        }
      }
      for (const style of this.normalizeUniqueStrings(metadata['avoidStyles'])) {
        if (!preferredStyles.includes(style) && !avoidStyles.includes(style)) {
          avoidStyles.push(style)
        }
      }
    }

    const subtitlePreferences = subtitleStylesByPriority.reduce<Record<string, any>>(
      (acc, item) => ({
        ...acc,
        ...(this.asRecord(this.asRecord(item['metadata'])?.['subtitleStyle']) || {}),
      }),
      {
        ...baseSubtitlePreferences,
      },
    )

    subtitlePreferences['feedbackWeights'] = {
      ...feedbackWeights,
      lastUpdatedAt: new Date().toISOString(),
    }
    subtitlePreferences['lastFeedback'] = sorted[0]
      ? {
          source: sorted[0]['source'],
          sourceType: sorted[0]['sourceType'],
          preference: sorted[0]['preference'],
          notes: sorted[0]['notes'],
          recordedAt: new Date(sorted[0]['createdAt']).toISOString(),
        }
      : null

    return {
      preferredStyles,
      avoidStyles,
      subtitlePreferences,
      preferredDuration: Number(existingPreferences?.['preferredDuration'] || 15),
      aspectRatio: this.normalizeOptionalString(existingPreferences?.['aspectRatio']) || '9:16',
    }
  }

  private normalizeUniqueStrings(values?: string[]) {
    return [...new Set(
      (values || [])
        .map(value => value?.trim())
        .filter((value): value is string => Boolean(value)),
    )]
  }

  private normalizePreferenceSource(source?: string) {
    const normalized = this.normalizeOptionalString(source).toLowerCase()
    if (!normalized || normalized.includes('效果') || normalized.includes('performance') || normalized.includes('data')) {
      return { type: 'performance', label: '效果数据', priority: 2 }
    }
    if (normalized.includes('老板') || normalized.includes('boss')) {
      return { type: 'boss', label: '老板反馈', priority: 4 }
    }
    if (normalized.includes('运营') || normalized.includes('ops') || normalized.includes('operator')) {
      return { type: 'operations', label: '运营反馈', priority: 3 }
    }
    if (normalized.includes('拒绝') || normalized.includes('reject')) {
      return { type: 'rejection', label: '拒绝原因', priority: 1 }
    }

    return {
      type: 'custom',
      label: this.normalizeOptionalString(source) || '自定义反馈',
      priority: 1,
    }
  }

  private normalizePreferenceText(feedback: LearnPreferenceInput) {
    return this.normalizeOptionalString(feedback.preference)
      || this.normalizeOptionalString(feedback.rejectionReason)
      || this.normalizeOptionalString(feedback.notes)
      || this.normalizeUniqueStrings(feedback.preferredStyles).join(' / ')
      || this.normalizeUniqueStrings(feedback.avoidStyles).join(' / ')
      || '偏好已记录'
  }

  private ensurePipelineType(type: PipelineType) {
    if (!Object.values(PipelineType).includes(type)) {
      throw new BadRequestException('Invalid pipeline type')
    }
  }

  private createTimelineEntry(
    status: string,
    timestamp: string,
    message: string,
    rawStatus?: VideoTaskStatus,
  ) {
    return {
      status,
      rawStatus,
      timestamp,
      message,
    }
  }

  private toObjectId(value: string, field: string) {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`${field} is invalid`)
    }

    return new Types.ObjectId(value)
  }

  private asRecord(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, any>
      : null
  }

  private normalizeOptionalString(value: unknown) {
    return typeof value === 'string' && value.trim()
      ? value.trim()
      : ''
  }

  private slugify(value: string) {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  }

  private escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
}
