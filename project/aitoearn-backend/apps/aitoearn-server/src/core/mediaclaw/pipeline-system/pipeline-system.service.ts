import { InjectQueue } from '@nestjs/bullmq'
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import {
  Brand,
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
import { VIDEO_WORKER_QUEUE, VIDEO_WORKER_STEPS, VideoWorkerJobData } from '../worker/worker.constants'

interface PipelineTemplateStepInput {
  name: string
  config?: Record<string, any>
  order?: number
}

interface CreateTemplateInput {
  name: string
  type: PipelineType
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
  requestedBy?: string
}

interface ApplyTemplateOverrides {
  name?: string
  description?: string
  duration?: number
  aspectRatio?: string
  subtitleStyle?: Record<string, any>
  musicStyle?: string
  preferredStyles?: string[]
  avoidStyles?: string[]
  schedule?: Record<string, any>
}

interface LearnPreferenceInput {
  source?: string
  preferredStyles?: string[]
  avoidStyles?: string[]
  subtitleStyle?: Record<string, any>
  score?: number
  notes?: string
}

@Injectable()
export class PipelineSystemService {
  constructor(
    @InjectModel(PipelineTemplate.name)
    private readonly pipelineTemplateModel: Model<PipelineTemplate>,
    @InjectModel(Pipeline.name)
    private readonly pipelineModel: Model<Pipeline>,
    @InjectModel(Brand.name)
    private readonly brandModel: Model<Brand>,
    @InjectModel(VideoTask.name)
    private readonly videoTaskModel: Model<VideoTask>,
    @InjectQueue(VIDEO_WORKER_QUEUE)
    private readonly videoWorkerQueue: Queue<VideoWorkerJobData>,
  ) {}

  async createTemplate(data: CreateTemplateInput) {
    const name = data.name?.trim()
    const createdBy = data.createdBy?.trim()

    if (!name) {
      throw new BadRequestException('name is required')
    }
    if (!createdBy) {
      throw new BadRequestException('createdBy is required')
    }
    this.ensurePipelineType(data.type)

    return this.pipelineTemplateModel.create({
      name,
      type: data.type,
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
      name: item.name,
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

  async getTemplate(id: string) {
    const template = await this.pipelineTemplateModel
      .findById(this.toObjectId(id, 'id'))
      .lean()
      .exec()

    if (!template) {
      throw new NotFoundException('Pipeline template not found')
    }

    return {
      id: template._id.toString(),
      name: template.name,
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

  async applyTemplate(templateId: string, brandId: string, overrides: ApplyTemplateOverrides = {}) {
    const [template, brand] = await Promise.all([
      this.pipelineTemplateModel.findById(this.toObjectId(templateId, 'templateId')).lean().exec(),
      this.brandModel.findById(this.toObjectId(brandId, 'brandId')).lean().exec(),
    ])

    if (!template) {
      throw new NotFoundException('Pipeline template not found')
    }
    if (!brand || !brand.isActive) {
      throw new NotFoundException('Brand not found')
    }

    const preferredDuration = overrides.duration
      || template.defaultParams?.duration
      || brand.videoStyle?.preferredDuration
      || 15
    const aspectRatio = overrides.aspectRatio
      || template.defaultParams?.aspectRatio
      || brand.videoStyle?.aspectRatio
      || '9:16'
    const subtitleStyle = {
      ...(brand.videoStyle?.subtitleStyle || {}),
      ...(template.defaultParams?.subtitleStyle || {}),
      ...(overrides.subtitleStyle || {}),
    }
    const templateSteps = this.normalizeTemplateSteps(template.steps)

    const pipeline = await this.pipelineModel.create({
      orgId: brand.orgId,
      brandId: brand._id,
      name: overrides.name?.trim() || `${brand.name} ${template.name}`,
      type: template.type,
      status: PipelineStatus.ACTIVE,
      description: overrides.description?.trim() || `Generated from template ${template.name}`,
      preferences: {
        preferredStyles: this.normalizeUniqueStrings(overrides.preferredStyles),
        avoidStyles: this.normalizeUniqueStrings(overrides.avoidStyles),
        preferredDuration,
        aspectRatio,
        subtitlePreferences: {
          ...subtitleStyle,
          musicStyle: overrides.musicStyle || template.defaultParams?.musicStyle || '',
          templateId: template._id.toString(),
          templateName: template.name,
          templateSteps,
        },
        feedbackCount: 0,
      },
      schedule: this.normalizeSchedule(overrides.schedule),
      totalVideosProduced: 0,
      totalVideosPublished: 0,
    })

    await this.pipelineTemplateModel.findByIdAndUpdate(template._id, {
      $inc: { usageCount: 1 },
    }).exec()

    return pipeline
  }

  async learnPreference(pipelineId: string, feedback: LearnPreferenceInput) {
    const pipeline = await this.pipelineModel
      .findById(this.toObjectId(pipelineId, 'pipelineId'))
      .lean()
      .exec()

    if (!pipeline) {
      throw new NotFoundException('Pipeline not found')
    }

    const source = feedback.source?.trim().toLowerCase() || 'performance'
    const multiplier = this.resolveFeedbackMultiplier(source)
    const existingSubtitlePreferences = pipeline.preferences?.subtitlePreferences || {}
    const existingWeights = existingSubtitlePreferences['feedbackWeights'] || {}
    const preferredStyles = this.mergeStyleLists(
      pipeline.preferences?.preferredStyles,
      feedback.preferredStyles,
      feedback.avoidStyles,
    )
    const avoidStyles = this.mergeStyleLists(
      pipeline.preferences?.avoidStyles,
      feedback.avoidStyles,
      feedback.preferredStyles,
    )

    return this.pipelineModel.findByIdAndUpdate(
      pipeline._id,
      {
        $set: {
          'preferences.preferredStyles': preferredStyles,
          'preferences.avoidStyles': avoidStyles,
          'preferences.subtitlePreferences': {
            ...existingSubtitlePreferences,
            ...(feedback.subtitleStyle || {}),
            feedbackWeights: {
              ...existingWeights,
              [source]: Number(existingWeights[source] || 0) + multiplier,
              total: Number(existingWeights['total'] || 0) + multiplier,
              lastUpdatedAt: new Date().toISOString(),
            },
            lastFeedback: {
              source,
              score: feedback.score ?? null,
              notes: feedback.notes?.trim() || '',
              preferredStyles,
              avoidStyles,
              subtitleStyle: feedback.subtitleStyle || {},
              multiplier,
              recordedAt: new Date().toISOString(),
            },
          },
        },
        $inc: {
          'preferences.feedbackCount': 1,
        },
      },
      { new: true },
    ).exec()
  }

  async warmUp(pipelineId: string, requestedBy?: string) {
    const pipeline = await this.pipelineModel
      .findById(this.toObjectId(pipelineId, 'pipelineId'))
      .lean()
      .exec()

    if (!pipeline) {
      throw new NotFoundException('Pipeline not found')
    }
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

    return {
      pipelineId: pipeline._id.toString(),
      queued: createdTasks.length,
      tasks: createdTasks,
    }
  }

  private buildTemplateQuery(filters: ListTemplateFilters) {
    const query: Record<string, any> = {}

    if (filters.type) {
      this.ensurePipelineType(filters.type)
      query['type'] = filters.type
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

  private mergeStyleLists(existing: string[] | undefined, incoming: string[] | undefined, excluded: string[] | undefined) {
    const excludedSet = new Set(this.normalizeUniqueStrings(excluded))
    return this.normalizeUniqueStrings([
      ...(existing || []),
      ...(incoming || []),
    ]).filter(item => !excludedSet.has(item))
  }

  private normalizeUniqueStrings(values?: string[]) {
    return [...new Set(
      (values || [])
        .map(value => value?.trim())
        .filter((value): value is string => Boolean(value)),
    )]
  }

  private resolveFeedbackMultiplier(source: string) {
    const weights: Record<string, number> = {
      boss: 3,
      ops: 2,
      performance: 1,
    }

    return weights[source] || 1
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
}
