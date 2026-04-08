import { randomBytes } from 'node:crypto'
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Cron } from '@nestjs/schedule'
import {
  Brand,
  NotificationEvent,
  Pipeline,
  PipelineStatus,
  ProductionBatch,
  ProductionBatchStatus,
  VideoTask,
  VideoTaskStatus,
  VideoTaskType,
} from '@yikart/mongodb'
import { Model, Types } from 'mongoose'
import { DedupService } from '../dedup/dedup.service'
import { EmployeeDispatchService } from '../employee-dispatch/employee-dispatch.service'
import { NotificationService } from '../notification/notification.service'
import { VideoService } from '../video/video.service'

interface BatchTaskPlanItem {
  assignmentId?: string
  employeeName?: string
  employeePhone?: string
  accountType?: string
  platform?: string
  platformAccountId?: string
  platformAccountName?: string
  accountId?: string
  firstFrameUrl?: string
  referenceVideoUrl?: string
  templateId?: string
  dailySequence?: number
  dailyQuota?: number
  styleOverrides?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

interface BatchProcessingConfig {
  concurrency?: number
  retryLimit?: number
  dedupOnComplete?: boolean
  batchDedupOnFinish?: boolean
  notifyChannel?: string
  pauseOnErrorRate?: number | null
}

interface ResolvedBatchProcessingConfig {
  concurrency: number
  retryLimit: number
  dedupOnComplete: boolean
  batchDedupOnFinish: boolean
  notifyChannel: string
  pauseOnErrorRate: number | null
}

interface CreateBatchParams {
  batchName?: string
  templateId?: string
  count?: number
  pipelineId?: string
  brandId?: string
  brandAssets?: string[]
  styleOverrides?: Record<string, unknown>
  referenceVideoUrl?: string
  scheduleContext?: Record<string, unknown>
  taskPlan?: BatchTaskPlanItem[]
  config?: BatchProcessingConfig
}

interface BatchFilters {
  status?: string
}

interface PaginationInput {
  page?: number
  limit?: number
}

interface ScheduledTaskPlanSummary {
  taskPlan: BatchTaskPlanItem[]
  accountTypes: Record<string, number>
  totalAccounts: number
}

type ProductionBatchRecord = Record<string, any>
type VideoTaskRecord = Record<string, any>
type PipelineRecord = Record<string, any>
type GenericRecord = Record<string, any>

const DEFAULT_BATCH_CONCURRENCY = 2
const DEFAULT_BATCH_RETRY_LIMIT = 1
const STOP_BATCH_PROCESSING = Symbol('stop-batch-processing')

@Injectable()
export class ProductionOrchestratorService {
  private readonly logger = new Logger(ProductionOrchestratorService.name)
  private readonly activeBatchRuns = new Map<string, Promise<void>>()

  constructor(
    @InjectModel(ProductionBatch.name)
    private readonly productionBatchModel: Model<ProductionBatch>,
    @InjectModel(VideoTask.name)
    private readonly videoTaskModel: Model<VideoTask>,
    @InjectModel(Pipeline.name)
    private readonly pipelineModel: Model<Pipeline>,
    @InjectModel(Brand.name)
    private readonly brandModel: Model<Brand>,
    private readonly videoService: VideoService,
    @Optional()
    private readonly employeeDispatchService?: EmployeeDispatchService,
    @Optional()
    private readonly notificationService?: NotificationService,
    @Optional()
    private readonly dedupService?: DedupService,
  ) {}

  @Cron('0 2 * * *')
  async runDailyProductionSchedule() {
    const pipelines = await this.pipelineModel.find({
      'status': PipelineStatus.ACTIVE,
      'schedule.enabled': true,
    }).lean().exec() as PipelineRecord[]

    const orgIds = Array.from(new Set(
      pipelines
        .map(pipeline => pipeline['orgId']?.toString?.() || this.normalizeOptionalString(pipeline['orgId']))
        .filter(Boolean),
    ))

    for (const orgId of orgIds) {
      try {
        const summary = await this.scheduleDailyProduction(orgId)
        this.logger.log({
          message: 'Daily production schedule completed',
          orgId,
          scheduledCount: summary.scheduledCount,
          skippedCount: summary.skippedCount,
          failedCount: summary.failedCount,
        })
      }
      catch (error) {
        this.logger.error({
          message: 'Daily production schedule failed',
          orgId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  async createBatch(orgId: string, requestedBy: string, params: CreateBatchParams) {
    const normalizedOrgId = this.normalizeOrgId(orgId)
    const templateId = this.normalizeOptionalString(params.templateId)
    const pipelineId = this.normalizeOptionalString(params.pipelineId)
    const brandId = this.normalizeOptionalString(params.brandId)
    const referenceVideoUrl = this.normalizeOptionalString(params.referenceVideoUrl)
    const brandAssets = this.normalizeStringList(params.brandAssets)
    const styleOverrides = this.asRecord(params.styleOverrides) || {}
    const scheduleContext = this.asRecord(params.scheduleContext) || {}
    const taskPlan = this.normalizeBatchTaskPlan(params.taskPlan)
    const config = this.normalizeBatchConfig(params.config)
    const count = taskPlan.length > 0
      ? taskPlan.length
      : this.normalizeCount(params.count)

    await this.ensurePipelineBelongsToOrg(normalizedOrgId, pipelineId)

    const batchId = this.generateBatchId()
    const brandObjectId = this.toObjectIdIfValid(brandId)
    const batchName = this.normalizeOptionalString(params.batchName) || templateId || batchId

    const batch = await this.productionBatchModel.create({
      batchId,
      orgId: normalizedOrgId,
      pipelineId: pipelineId || null,
      templateId,
      totalCount: count,
      completedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      status: ProductionBatchStatus.PENDING,
      videoTaskIds: [],
      completedTaskIds: [],
      failedTaskIds: [],
      params: {
        templateId,
        pipelineId: pipelineId || null,
        brandAssets,
        styleOverrides,
        referenceVideoUrl,
        scheduleContext,
        taskPlan,
        config,
      },
      summary: {
        avgCostPerVideo: 0,
        totalCost: 0,
        avgDurationSec: 0,
        totalDurationSec: 0,
        successRate: 0,
        errorRate: 0,
        totalVideos: 0,
        totalAccounts: this.countUniquePlanAccounts(taskPlan),
        successAccounts: 0,
        failedAccounts: 0,
        skippedAccounts: 0,
        dedupPassed: 0,
        dedupFailed: 0,
        dedupCheckedAt: null,
        notifiedAt: null,
        startedAt: null,
        completedAt: null,
        elapsedMs: 0,
      },
      resumeState: {
        lastProcessedIndex: -1,
        resumedAt: null,
        resumeCount: 0,
      },
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
      errorMessage: '',
      brandId: brandObjectId,
      batchName,
      userId: requestedBy,
      tasks: [],
      totalTasks: count,
      completedTasks: 0,
      failedTasks: 0,
      createdBy: requestedBy,
    })

    return this.toBatchResponse(batch.toObject() as ProductionBatchRecord)
  }

  async startBatch(orgId: string, batchId: string) {
    const batch = await this.syncBatchStateFromTasks(
      (await this.getBatchRecordOrFail(orgId, batchId))['_id'].toString(),
    )
    if (this.isTerminalBatchStatus(batch['status'])) {
      return this.toBatchResponse(batch)
    }
    if (this.normalizeBatchStatus(batch['status']) === ProductionBatchStatus.RUNNING) {
      return this.toBatchResponse(batch)
    }

    this.ensureBatchCanRun(batch)
    const startedAt = batch['startedAt'] || new Date()
    const updated = await this.productionBatchModel.findByIdAndUpdate(
      batch['_id'],
      {
        $set: {
          'status': ProductionBatchStatus.RUNNING,
          startedAt,
          'cancelledAt': null,
          'errorMessage': '',
          'summary.startedAt': batch['summary']?.['startedAt'] || startedAt,
          'summary.completedAt': null,
        },
      },
      { new: true },
    ).lean().exec() as ProductionBatchRecord | null

    if (!updated) {
      throw new NotFoundException('Production batch not found')
    }

    this.runBatchInBackground(orgId, updated['_id'].toString())
    return this.toBatchResponse(updated)
  }

  async pauseBatch(orgId: string, batchId: string) {
    const batch = await this.syncBatchStateFromTasks(
      (await this.getBatchRecordOrFail(orgId, batchId))['_id'].toString(),
    )
    const updated = await this.productionBatchModel.findByIdAndUpdate(
      batch['_id'],
      {
        $set: {
          status: ProductionBatchStatus.PAUSED,
        },
      },
      { new: true },
    ).lean().exec() as ProductionBatchRecord | null

    return this.toBatchResponse(updated || batch)
  }

  async resumeBatch(orgId: string, batchId: string) {
    const batch = await this.syncBatchStateFromTasks(
      (await this.getBatchRecordOrFail(orgId, batchId))['_id'].toString(),
    )
    const currentStatus = this.normalizeBatchStatus(batch['status'])
    if (
      currentStatus === ProductionBatchStatus.CANCELLED
      || currentStatus === ProductionBatchStatus.COMPLETED
      || currentStatus === ProductionBatchStatus.PARTIAL
    ) {
      throw new BadRequestException('Only paused or failed batches can be resumed')
    }
    if (currentStatus === ProductionBatchStatus.RUNNING) {
      return this.toBatchResponse(batch)
    }

    this.ensureBatchCanRun(batch)
    const resumeState = this.asRecord(batch['resumeState']) || {}
    const updated = await this.productionBatchModel.findByIdAndUpdate(
      batch['_id'],
      {
        $set: {
          'status': ProductionBatchStatus.RUNNING,
          'resumeState.resumedAt': new Date(),
          'resumeState.resumeCount': Number(resumeState['resumeCount'] || 0) + 1,
          'errorMessage': '',
        },
      },
      { new: true },
    ).lean().exec() as ProductionBatchRecord | null

    const resumedBatch = updated || batch
    this.runBatchInBackground(orgId, resumedBatch['_id'].toString())
    return this.toBatchResponse(resumedBatch)
  }

  async cancelBatch(orgId: string, batchId: string) {
    const batch = await this.getBatchRecordOrFail(orgId, batchId)
    const cancelledAt = new Date()
    await Promise.all([
      this.productionBatchModel.findByIdAndUpdate(batch['_id'], {
        $set: {
          status: ProductionBatchStatus.CANCELLED,
          cancelledAt,
        },
      }).exec(),
      this.videoTaskModel.updateMany(
        {
          _id: {
            $in: this.toObjectIdList(this.normalizeStringList(batch['videoTaskIds'])),
          },
          status: {
            $in: [
              VideoTaskStatus.PENDING,
              VideoTaskStatus.ANALYZING,
              VideoTaskStatus.EDITING,
              VideoTaskStatus.RENDERING,
              VideoTaskStatus.QUALITY_CHECK,
              VideoTaskStatus.GENERATING_COPY,
            ],
          },
        },
        {
          $set: {
            status: VideoTaskStatus.CANCELLED,
            errorMessage: 'batch_cancelled',
          },
        },
      ).exec(),
    ])

    return this.toBatchResponse(await this.getBatchRecordOrFail(orgId, batchId))
  }

  async getBatch(orgId: string, batchId: string) {
    return this.toBatchResponse(
      await this.syncBatchStateFromTasks(
        (await this.getBatchRecordOrFail(orgId, batchId))['_id'].toString(),
      ),
    )
  }

  async listBatches(orgId: string, filters: BatchFilters = {}, pagination: PaginationInput = {}) {
    const page = Math.max(Number(pagination.page || 1), 1)
    const limit = Math.min(Math.max(Number(pagination.limit || 20), 1), 100)
    const skip = (page - 1) * limit
    const query: Record<string, unknown> = this.buildOrgMatch(orgId)
    const normalizedStatuses = this.resolveBatchStatuses(filters.status)
    if (normalizedStatuses.length > 0) {
      query['status'] = { $in: normalizedStatuses }
    }

    const [items, total] = await Promise.all([
      this.productionBatchModel.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec() as Promise<ProductionBatchRecord[]>,
      this.productionBatchModel.countDocuments(query),
    ])

    const syncedItems = await Promise.all(
      items.map(item => this.syncBatchStateFromTasks(item['_id'].toString())),
    )

    return {
      items: syncedItems.map(item => this.toBatchResponse(item)),
      total,
      page,
      limit,
    }
  }

  async getBatchSummary(orgId: string, batchId: string) {
    const batch = await this.syncBatchStateFromTasks(
      (await this.getBatchRecordOrFail(orgId, batchId))['_id'].toString(),
    )
    const taskIds = this.normalizeStringList(batch['videoTaskIds'])
    const tasks = taskIds.length === 0
      ? []
      : await this.videoTaskModel.find({ _id: { $in: this.toObjectIdList(taskIds) } }).lean().exec() as VideoTaskRecord[]
    const taskMap = new Map(tasks.map(task => [task['_id'].toString(), task]))

    return {
      ...this.toBatchResponse(batch),
      tasks: taskIds.map((taskId, index) => {
        const task = taskMap.get(taskId)
        const productionBatch = this.asRecord(task?.['metadata']?.['productionBatch']) || {}
        return {
          id: taskId,
          batchIndex: task?.['batchIndex'] ?? index,
          status: task?.['status'] || VideoTaskStatus.PENDING,
          retryCount: Number(task?.['retryCount'] || 0),
          attempt: this.readTaskAttempt(task),
          errorMessage: task?.['errorMessage'] || '',
          sourceVideoUrl: task?.['sourceVideoUrl'] || '',
          outputVideoUrl: task?.['outputVideoUrl'] || task?.['output']?.['url'] || '',
          durationSec: Number(task?.['output']?.['duration'] || task?.['quality']?.['duration'] || 0),
          cost: Number(task?.['creditsConsumed'] || task?.['quotaUnits'] || 0),
          dedupStatus: this.normalizeOptionalString(task?.['dedup']?.['status']) || 'pending',
          assignmentId: this.normalizeOptionalString(productionBatch['assignmentId']) || null,
          employeeName: this.normalizeOptionalString(productionBatch['employeeName']) || null,
          accountType: this.normalizeOptionalString(productionBatch['accountType']) || null,
          platformAccountId: this.normalizeOptionalString(productionBatch['platformAccountId']) || null,
          accountId: this.normalizeOptionalString(productionBatch['accountId']) || null,
          createdAt: task?.['createdAt'] || null,
          updatedAt: task?.['updatedAt'] || null,
        }
      }),
    }
  }

  async scheduleDailyProduction(orgId: string) {
    const normalizedOrgId = this.normalizeOrgId(orgId)
    const pipelines = await this.pipelineModel.find({
      ...this.buildOrgMatch(normalizedOrgId),
      'status': PipelineStatus.ACTIVE,
      'schedule.enabled': true,
    }).lean().exec() as PipelineRecord[]

    const items: Array<Record<string, any>> = []
    for (const pipeline of pipelines) {
      items.push(await this.schedulePipelineRun(normalizedOrgId, pipeline))
    }

    return {
      orgId: normalizedOrgId,
      scheduledAt: new Date().toISOString(),
      totalPipelines: pipelines.length,
      scheduledCount: items.filter(item => item['status'] === 'scheduled').length,
      skippedCount: items.filter(item => item['status'] === 'skipped').length,
      failedCount: items.filter(item => item['status'] === 'failed').length,
      items,
    }
  }

  private async schedulePipelineRun(orgId: string, pipeline: PipelineRecord) {
    const pipelineId = pipeline['_id']?.toString?.() || this.normalizeOptionalString(pipeline['_id'])
    const pipelineName = this.normalizeOptionalString(pipeline['name']) || pipelineId
    const schedule = this.asRecord(pipeline['schedule']) || {}
    const timezone = this.normalizeOptionalString(schedule['timezone']) || 'Asia/Shanghai'
    const scheduleDateKey = this.buildDateKeyForTimezone(timezone)

    if (!pipelineId) {
      return {
        pipelineId: null,
        pipelineName,
        status: 'skipped',
        reason: 'missing_pipeline_id',
      }
    }

    const existingBatch = await this.productionBatchModel.findOne({
      ...this.buildOrgMatch(orgId),
      'pipelineId': this.toObjectIdIfValid(pipelineId),
      'params.scheduleContext.autoScheduled': true,
      'params.scheduleContext.scheduleDateKey': scheduleDateKey,
    }).sort({ createdAt: -1 }).lean().exec() as ProductionBatchRecord | null

    if (existingBatch) {
      return {
        pipelineId,
        pipelineName,
        status: 'skipped',
        reason: 'already_scheduled',
        batchId: this.normalizeOptionalString(existingBatch['batchId']) || existingBatch['_id']?.toString(),
        scheduleDateKey,
      }
    }

    try {
      const batchParams = await this.buildScheduledBatchParams(orgId, pipeline, scheduleDateKey, timezone)
      const taskPlan = this.normalizeBatchTaskPlan(batchParams.taskPlan)
      if (taskPlan.length === 0) {
        return {
          pipelineId,
          pipelineName,
          status: 'skipped',
          reason: 'no_dispatch_accounts',
          scheduleDateKey,
        }
      }

      if (!batchParams.referenceVideoUrl && !this.batchPlanHasPlayableSource(taskPlan)) {
        this.logger.warn({
          message: 'Skipping scheduled production because reference input is missing',
          orgId,
          pipelineId,
          pipelineName,
          scheduleDateKey,
        })

        return {
          pipelineId,
          pipelineName,
          status: 'skipped',
          reason: 'missing_reference_video_url',
          scheduleDateKey,
        }
      }

      const requestedBy = pipeline['orgId']?.toString?.() || orgId
      const batch = await this.createBatch(orgId, requestedBy, batchParams)
      const startedBatch = await this.startBatch(orgId, batch['batchId'] || batch['id'])

      this.logger.log({
        message: 'Scheduled production batch started',
        orgId,
        pipelineId,
        pipelineName,
        batchId: startedBatch['batchId'],
        count: startedBatch['totalCount'],
        scheduleDateKey,
      })

      return {
        pipelineId,
        pipelineName,
        status: 'scheduled',
        batchId: startedBatch['batchId'],
        count: startedBatch['totalCount'],
        totalAccounts: Number(startedBatch['summary']?.['totalAccounts'] || 0),
        accountTypes: batchParams.scheduleContext?.['accountTypes'] || {},
        scheduleDateKey,
      }
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.error({
        message: 'Scheduled production batch failed to start',
        orgId,
        pipelineId,
        pipelineName,
        error: message,
        scheduleDateKey,
      })

      return {
        pipelineId,
        pipelineName,
        status: 'failed',
        errorMessage: message,
        scheduleDateKey,
      }
    }
  }

  private async buildScheduledBatchParams(
    orgId: string,
    pipeline: PipelineRecord,
    scheduleDateKey: string,
    timezone: string,
  ): Promise<CreateBatchParams> {
    const schedule = this.asRecord(pipeline['schedule']) || {}
    const preferences = this.asRecord(pipeline['preferences']) || {}
    const subtitlePreferences = this.asRecord(preferences['subtitlePreferences']) || {}
    const remixInsights = this.asRecord(preferences['remixInsights']) || {}
    const brandId = pipeline['brandId']?.toString?.() || this.normalizeOptionalString(pipeline['brandId'])
    const brand = brandId
      ? await this.brandModel.findOne({
        _id: this.toObjectIdIfValid(brandId),
        orgId: this.toObjectIdIfValid(orgId),
      }).lean().exec() as Record<string, any> | null
      : null
    const brandAssets = [
      ...this.normalizeStringList(brand?.['assets']?.['keywords']),
      ...this.normalizeStringList(brand?.['assets']?.['slogans']),
      ...this.normalizeStringList(brand?.['assets']?.['colors']),
    ]
    const templateId = this.normalizeOptionalString(subtitlePreferences['templateId']) || undefined
    const referenceVideoUrl = this.normalizeOptionalString(brand?.['videoStyle']?.['referenceVideoUrl'])
      || this.normalizeOptionalString(remixInsights['referenceVideoUrl'])
      || this.normalizeOptionalString(subtitlePreferences['referenceVideoUrl'])
    const styleOverrides = {
      preferredStyles: this.normalizeStringList(preferences['preferredStyles']),
      avoidStyles: this.normalizeStringList(preferences['avoidStyles']),
      preferredDuration: Number(preferences['preferredDuration'] || 0),
      aspectRatio: this.normalizeOptionalString(preferences['aspectRatio']),
      subtitlePreferences,
      remixInsights,
      pipelineName: this.normalizeOptionalString(pipeline['name']),
      scheduleCron: this.normalizeOptionalString(schedule['cron']),
    }
    const taskPlanSummary = await this.buildScheduledTaskPlan(
      orgId,
      pipeline,
      templateId,
      referenceVideoUrl,
      styleOverrides,
    )

    return {
      templateId,
      count: taskPlanSummary.taskPlan.length,
      pipelineId: pipeline['_id']?.toString?.() || undefined,
      brandId: brandId || undefined,
      brandAssets,
      styleOverrides,
      referenceVideoUrl,
      taskPlan: taskPlanSummary.taskPlan,
      config: {
        concurrency: this.normalizePositiveInteger(schedule['concurrency'], DEFAULT_BATCH_CONCURRENCY, 8),
        retryLimit: this.normalizePositiveInteger(schedule['retryLimit'], DEFAULT_BATCH_RETRY_LIMIT, 3),
        dedupOnComplete: this.normalizeBoolean(schedule['dedupOnComplete'], true),
        batchDedupOnFinish: this.normalizeBoolean(schedule['batchDedupOnFinish'], true),
        notifyChannel: this.normalizeOptionalString(schedule['notifyChannel']),
        pauseOnErrorRate: this.normalizeRatio(schedule['pauseOnErrorRate']),
      },
      scheduleContext: {
        autoScheduled: true,
        scheduleDateKey,
        timezone,
        pipelineId: pipeline['_id']?.toString?.() || '',
        pipelineName: this.normalizeOptionalString(pipeline['name']),
        videosPerRun: Math.max(Number(schedule['videosPerRun'] || 1), 1),
        accountTypes: taskPlanSummary.accountTypes,
        totalAccounts: taskPlanSummary.totalAccounts,
      },
    }
  }

  private async buildScheduledTaskPlan(
    orgId: string,
    pipeline: PipelineRecord,
    templateId: string | undefined,
    referenceVideoUrl: string,
    baseStyleOverrides: Record<string, unknown>,
  ): Promise<ScheduledTaskPlanSummary> {
    if (!this.employeeDispatchService) {
      return {
        taskPlan: [],
        accountTypes: {},
        totalAccounts: 0,
      }
    }

    const dispatchRules = this.asRecord(pipeline['distributionRules']) || {}
    const requestedAssignmentIds = new Set(this.normalizeStringList(dispatchRules['assignmentIds']))
    const requestedPlatforms = new Set(
      this.normalizeStringList(dispatchRules['preferredPlatforms']).map(item => item.toLowerCase()),
    )
    const requestedAccountTypes = new Set(
      this.normalizeStringList(dispatchRules['accountTypes']).map(item => item.toLowerCase()),
    )
    const requestedPlatformAccountIds = new Set(this.normalizeStringList(dispatchRules['platformAccountIds']))
    const requestedTemplateIds = this.normalizeStringList(dispatchRules['templateIds'])
    const assignmentResponse = await this.employeeDispatchService.listAssignments(
      orgId,
      { status: 'active' },
      { page: 1, limit: 200 },
    )
    const assignments = Array.isArray(assignmentResponse['items'])
      ? assignmentResponse['items'] as GenericRecord[]
      : []
    const taskPlan: BatchTaskPlanItem[] = []

    for (const assignment of assignments) {
      const assignmentId = this.normalizeOptionalString(assignment['id'] || assignment['_id'])
      if (requestedAssignmentIds.size > 0 && !requestedAssignmentIds.has(assignmentId)) {
        continue
      }

      if (!this.isAssignmentTemplateEligible(assignment, templateId, requestedTemplateIds)) {
        continue
      }

      const quota = Math.max(
        Number(assignment['distributionRules']?.['maxDailyVideos'] || assignment['dailyQuota'] || 0),
        0,
      )
      if (quota <= 0) {
        continue
      }

      const accounts = this.resolveAssignmentAccounts(
        assignment,
        requestedPlatforms,
        requestedAccountTypes,
        requestedPlatformAccountIds,
      )
      if (accounts.length === 0) {
        continue
      }

      const defaultPlatformAccountId = this.normalizeOptionalString(
        assignment['defaultPlatformAccount']?.['id']
        || assignment['distributionRules']?.['defaultPlatformAccountId'],
      )
      const orderedAccounts = this.sortAssignmentAccounts(accounts, defaultPlatformAccountId)

      for (let sequence = 0; sequence < quota; sequence += 1) {
        const account = orderedAccounts[sequence % orderedAccounts.length]
        const accountType = this.normalizeOptionalString(account['platform'] || account['accountType'])
        taskPlan.push({
          assignmentId,
          employeeName: this.normalizeOptionalString(assignment['employeeName']),
          employeePhone: this.normalizeOptionalString(assignment['employeePhone']),
          accountType,
          platform: this.normalizeOptionalString(account['platform']),
          platformAccountId: this.normalizeOptionalString(account['id']),
          platformAccountName: this.normalizeOptionalString(account['accountName']),
          accountId: this.normalizeOptionalString(account['accountId']),
          firstFrameUrl: this.resolveAssignmentFirstFrameUrl(assignment, account),
          referenceVideoUrl,
          templateId,
          dailySequence: sequence + 1,
          dailyQuota: quota,
          styleOverrides: {
            ...baseStyleOverrides,
            accountType,
            platform: this.normalizeOptionalString(account['platform']),
            platformAccountId: this.normalizeOptionalString(account['id']),
            platformAccountName: this.normalizeOptionalString(account['accountName']),
            dailySequence: sequence + 1,
            dailyQuota: quota,
          },
          metadata: {
            assignmentId,
            employeeName: this.normalizeOptionalString(assignment['employeeName']),
            employeePhone: this.normalizeOptionalString(assignment['employeePhone']),
            accountType,
            platform: this.normalizeOptionalString(account['platform']),
            platformAccountId: this.normalizeOptionalString(account['id']),
            platformAccountName: this.normalizeOptionalString(account['accountName']),
            accountId: this.normalizeOptionalString(account['accountId']),
          },
        })
      }
    }

    return {
      taskPlan,
      accountTypes: this.buildAccountTypeSummary(taskPlan),
      totalAccounts: this.countUniquePlanAccounts(taskPlan),
    }
  }

  private runBatchInBackground(orgId: string, batchObjectId: string) {
    if (this.activeBatchRuns.has(batchObjectId)) {
      return
    }

    const runner: Promise<void> = this.processBatch(orgId, batchObjectId)
      .then(() => undefined)
      .catch(async (error) => {
        const message = error instanceof Error ? error.message : String(error)
        this.logger.error(`Production batch processing failed for ${batchObjectId}: ${message}`)
        await this.markBatchRunFailure(batchObjectId, message).catch(() => undefined)
      })
      .finally(() => {
        this.activeBatchRuns.delete(batchObjectId)
      })

    this.activeBatchRuns.set(batchObjectId, runner)
  }

  private async processBatch(orgId: string, batchObjectId: string) {
    const batch = await this.getBatchRecordById(batchObjectId)
    if (!batch) {
      throw new NotFoundException('Production batch not found')
    }

    const totalCount = Math.max(
      Number(batch['totalCount'] || batch['totalTasks'] || 0),
      this.getBatchTaskPlan(batch).length,
    )
    if (totalCount === 0) {
      return this.finalizeBatch(orgId, batchObjectId)
    }

    const config = this.resolveBatchProcessingConfig(batch)
    const workerCount = Math.min(Math.max(config.concurrency, 1), totalCount)
    let nextIndex = 0
    let stopRequested = false

    const runWorker = async () => {
      while (!stopRequested) {
        const index = nextIndex
        nextIndex += 1

        if (index >= totalCount) {
          return
        }

        const result = await this.processBatchIndex(batchObjectId, index, config)
        if (result === STOP_BATCH_PROCESSING) {
          stopRequested = true
          return
        }

        const pausedByErrorRate = await this.maybePauseBatchByErrorRate(batchObjectId, config)
        if (pausedByErrorRate) {
          stopRequested = true
          return
        }
      }
    }

    await Promise.all(Array.from({ length: workerCount }, () => runWorker()))

    const latestBatch = await this.syncBatchStateFromTasks(batchObjectId)
    const latestStatus = this.normalizeBatchStatus(latestBatch['status'])
    if (
      latestStatus === ProductionBatchStatus.PAUSED
      || latestStatus === ProductionBatchStatus.CANCELLED
    ) {
      return this.toBatchResponse(latestBatch)
    }

    return this.finalizeBatch(orgId, batchObjectId)
  }

  private async processBatchIndex(batchObjectId: string, index: number, config: ResolvedBatchProcessingConfig) {
    while (true) {
      const latestBatch = await this.syncBatchStateFromTasks(batchObjectId)
      const latestStatus = this.normalizeBatchStatus(latestBatch['status'])
      if (
        latestStatus === ProductionBatchStatus.PAUSED
        || latestStatus === ProductionBatchStatus.CANCELLED
      ) {
        return STOP_BATCH_PROCESSING
      }

      const latestTask = await this.getLatestTaskForIndex(batchObjectId, index)
      if (latestTask) {
        if (!this.isTerminalTaskStatus(latestTask['status'])) {
          await this.waitForTaskTerminalState(latestTask['_id'].toString())
          continue
        }

        if (this.isSuccessfulTaskStatus(latestTask['status'])) {
          return undefined
        }

        const nextAttempt = this.readTaskAttempt(latestTask) + 1
        if (nextAttempt > config.retryLimit) {
          return undefined
        }

        const retryTask = await this.createBatchTask(latestBatch, index, nextAttempt)
        if (!this.isTerminalTaskStatus(retryTask['status'])) {
          await this.waitForTaskTerminalState(retryTask['_id'].toString())
        }
        continue
      }

      const createdTask = await this.createBatchTask(latestBatch, index, 0)
      if (!this.isTerminalTaskStatus(createdTask['status'])) {
        await this.waitForTaskTerminalState(createdTask['_id'].toString())
      }
    }
  }

  private async createBatchTask(
    batch: ProductionBatchRecord,
    index: number,
    attempt = 0,
  ) {
    const requestedBy = this.normalizeOptionalString(batch['createdBy'])
      || this.normalizeOptionalString(batch['userId'])
      || this.normalizeOptionalString(batch['orgId'])
    const orgId = batch['orgId']?.toString?.() || this.normalizeOptionalString(batch['orgId'])
    const config = this.resolveBatchProcessingConfig(batch)

    try {
      const task = await this.videoService.createTask(
        orgId,
        requestedBy,
        this.buildBatchTaskInput(batch, index, attempt),
      )

      const updatedTask = await this.videoTaskModel.findByIdAndUpdate(
        task._id,
        {
          $set: {
            'batchIndex': index,
            'maxRetries': config.retryLimit,
            'retryCount': attempt,
            'metadata.productionBatch.batchIndex': index,
            'metadata.productionBatch.attempt': attempt,
          },
        },
        { new: true },
      ).lean().exec() as VideoTaskRecord | null

      if (updatedTask) {
        return updatedTask
      }

      return this.getVideoTaskRecordOrFail(task._id.toString())
    }
    catch (error) {
      return this.createFailedBatchTask(batch, index, error, attempt)
    }
  }

  private async createFailedBatchTask(
    batch: ProductionBatchRecord,
    index: number,
    error: unknown,
    attempt = 0,
  ) {
    const params = this.asRecord(batch['params']) || {}
    const taskPlan = this.getBatchTaskPlan(batch)
    const planItem = taskPlan[index] || {}
    const sourceVideoUrl = this.resolveBatchTaskSourceVideoUrl(batch, planItem)
    const requestedBy = this.normalizeOptionalString(batch['createdBy'])
      || this.normalizeOptionalString(batch['userId'])
      || this.normalizeOptionalString(batch['orgId'])
    const orgObjectId = this.toObjectIdIfValid(
      batch['orgId']?.toString?.() || this.normalizeOptionalString(batch['orgId']),
    )
    const brandObjectId = this.toObjectIdIfValid(
      batch['brandId']?.toString?.() || this.normalizeOptionalString(batch['brandId']),
    )
    const pipelineObjectId = this.toObjectIdIfValid(
      batch['pipelineId']?.toString?.() || this.normalizeOptionalString(batch['pipelineId']),
    )
    const message = error instanceof Error ? error.message : String(error)
    const batchBusinessId = this.normalizeOptionalString(batch['batchId']) || batch['_id'].toString()
    const failedTask = await this.videoTaskModel.create({
      userId: requestedBy,
      orgId: orgObjectId,
      brandId: brandObjectId,
      pipelineId: pipelineObjectId,
      batchId: batch['_id'],
      batchIndex: index,
      taskType: VideoTaskType.NEW_CONTENT,
      status: VideoTaskStatus.FAILED,
      sourceVideoUrl,
      source: {
        type: sourceVideoUrl ? 'url' : 'manual',
        url: sourceVideoUrl,
        videoId: '',
      },
      creditsConsumed: 0,
      creditCharged: false,
      retryCount: attempt,
      maxRetries: this.resolveBatchProcessingConfig(batch).retryLimit,
      errorMessage: message,
      errorLog: [
        {
          step: 'production-orchestrator',
          message,
          detail: {
            batchId: batchBusinessId,
            batchIndex: index,
            attempt,
          },
          recordedAt: new Date(),
        },
      ],
      metadata: {
        batchId: batchBusinessId,
        productionBatch: {
          batchId: batchBusinessId,
          batchIndex: index,
          attempt,
          templateId: this.normalizeOptionalString(planItem['templateId']) || this.normalizeOptionalString(batch['templateId']),
          requestedBy,
          assignmentId: this.normalizeOptionalString(planItem['assignmentId']),
          employeeName: this.normalizeOptionalString(planItem['employeeName']),
          employeePhone: this.normalizeOptionalString(planItem['employeePhone']),
          accountType: this.normalizeOptionalString(planItem['accountType']),
          platform: this.normalizeOptionalString(planItem['platform']),
          platformAccountId: this.normalizeOptionalString(planItem['platformAccountId']),
          platformAccountName: this.normalizeOptionalString(planItem['platformAccountName']),
          accountId: this.normalizeOptionalString(planItem['accountId']),
          firstFrameUrl: this.normalizeOptionalString(planItem['firstFrameUrl']),
          brandAssets: this.normalizeStringList(params['brandAssets']),
          styleOverrides: {
            ...(this.asRecord(params['styleOverrides']) || {}),
            ...(this.asRecord(planItem['styleOverrides']) || {}),
          },
          referenceVideoUrl: sourceVideoUrl,
          createdAt: new Date().toISOString(),
          creationFailed: true,
        },
      },
    })

    return failedTask.toObject() as VideoTaskRecord
  }

  private async waitForTaskTerminalState(taskId: string) {
    while (true) {
      const task = await this.getVideoTaskRecordOrFail(taskId)
      if (this.isTerminalTaskStatus(task['status'])) {
        return task
      }

      await this.delay(2000)
    }
  }

  private async finalizeBatch(orgId: string, batchId: string) {
    const batchObjectId = (await this.getBatchRecordOrFail(orgId, batchId))['_id'].toString()
    let batch = await this.syncBatchStateFromTasks(batchObjectId)
    const status = this.normalizeBatchStatus(batch['status'])

    if (
      status === ProductionBatchStatus.PAUSED
      || status === ProductionBatchStatus.CANCELLED
    ) {
      return this.toBatchResponse(batch)
    }

    batch = await this.runBatchDedupIfNeeded(orgId, batch)
    batch = await this.notifyBatchSummaryIfNeeded(orgId, batch)

    this.logger.log({
      message: 'Production batch processed',
      batchId: batch['batchId'],
      status: batch['status'],
      completedCount: batch['completedCount'],
      failedCount: batch['failedCount'],
      skippedCount: batch['skippedCount'],
      totalAccounts: batch['summary']?.['totalAccounts'] || 0,
      dedupPassed: batch['summary']?.['dedupPassed'] || 0,
      dedupFailed: batch['summary']?.['dedupFailed'] || 0,
    })

    return this.toBatchResponse(batch)
  }

  private async runBatchDedupIfNeeded(orgId: string, batch: ProductionBatchRecord) {
    if (!this.dedupService) {
      return batch
    }

    const config = this.resolveBatchProcessingConfig(batch)
    if (!config.dedupOnComplete && !config.batchDedupOnFinish) {
      return batch
    }

    const summary = this.asRecord(batch['summary']) || {}
    if (summary['dedupCheckedAt']) {
      return batch
    }

    const projectId = batch['pipelineId']?.toString?.()
      || this.normalizeOptionalString(batch['pipelineId'])
      || this.normalizeOptionalString(batch['batchId'])
    if (!projectId) {
      return batch
    }

    try {
      const dedupSummary = await this.dedupService.batchCheckDuplicateByBatch(
        orgId,
        projectId,
        batch['_id'].toString(),
      )
      const updated = await this.productionBatchModel.findByIdAndUpdate(
        batch['_id'],
        {
          $set: {
            'summary.dedupPassed': dedupSummary.passed,
            'summary.dedupFailed': dedupSummary.duplicate + dedupSummary.error,
            'summary.dedupCheckedAt': new Date(),
          },
        },
        { new: true },
      ).lean().exec() as ProductionBatchRecord | null

      return updated || batch
    }
    catch (error) {
      this.logger.warn({
        message: 'Production batch dedup summary failed',
        batchId: this.normalizeOptionalString(batch['batchId']) || batch['_id']?.toString(),
        error: error instanceof Error ? error.message : String(error),
      })
      return batch
    }
  }

  private async notifyBatchSummaryIfNeeded(orgId: string, batch: ProductionBatchRecord) {
    const status = this.normalizeBatchStatus(batch['status'])
    if (
      status !== ProductionBatchStatus.COMPLETED
      && status !== ProductionBatchStatus.PARTIAL
      && status !== ProductionBatchStatus.FAILED
    ) {
      return batch
    }

    const summary = this.asRecord(batch['summary']) || {}
    if (summary['notifiedAt']) {
      return batch
    }

    const config = this.resolveBatchProcessingConfig(batch)
    const report = this.buildBatchReport(batch)

    try {
      if (config.notifyChannel && this.isHttpUrl(config.notifyChannel)) {
        await this.postBatchSummary(config.notifyChannel, report)
      }
    }
    catch (error) {
      this.logger.warn({
        message: 'Batch summary webhook delivery failed',
        batchId: this.normalizeOptionalString(batch['batchId']) || batch['_id']?.toString(),
        notifyChannel: config.notifyChannel,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    try {
      if (this.notificationService) {
        await this.notificationService.send(
          orgId,
          status === ProductionBatchStatus.FAILED
            ? NotificationEvent.TASK_FAILED
            : NotificationEvent.TASK_COMPLETED,
          report,
        )
      }
    }
    catch (error) {
      this.logger.warn({
        message: 'Batch summary notification failed',
        batchId: this.normalizeOptionalString(batch['batchId']) || batch['_id']?.toString(),
        error: error instanceof Error ? error.message : String(error),
      })
    }

    const updated = await this.productionBatchModel.findByIdAndUpdate(
      batch['_id'],
      {
        $set: {
          'summary.notifiedAt': new Date(),
        },
      },
      { new: true },
    ).lean().exec() as ProductionBatchRecord | null

    return updated || batch
  }

  private async postBatchSummary(url: string, payload: Record<string, unknown>) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    })

    if (!response.ok) {
      throw new Error(`Webhook returned ${response.status}`)
    }
  }

  private buildBatchReport(batch: ProductionBatchRecord) {
    const summary = this.asRecord(batch['summary']) || {}
    const scheduleContext = this.asRecord(batch['params']?.['scheduleContext']) || {}
    const config = this.resolveBatchProcessingConfig(batch)

    return {
      batchId: this.normalizeOptionalString(batch['batchId']) || batch['_id']?.toString(),
      orgId: batch['orgId']?.toString?.() || this.normalizeOptionalString(batch['orgId']),
      pipelineId: batch['pipelineId']?.toString?.() || this.normalizeOptionalString(batch['pipelineId']) || null,
      templateId: this.normalizeOptionalString(batch['templateId']) || null,
      status: this.normalizeBatchStatus(batch['status']),
      totalAccounts: Number(summary['totalAccounts'] || 0),
      successAccounts: Number(summary['successAccounts'] || 0),
      failedAccounts: Number(summary['failedAccounts'] || 0),
      skippedAccounts: Number(summary['skippedAccounts'] || 0),
      totalVideos: Number(summary['totalVideos'] || 0),
      completedCount: Number(batch['completedCount'] || 0),
      failedCount: Number(batch['failedCount'] || 0),
      skippedCount: Number(batch['skippedCount'] || 0),
      dedupPassed: Number(summary['dedupPassed'] || 0),
      dedupFailed: Number(summary['dedupFailed'] || 0),
      totalDurationSec: Number(summary['totalDurationSec'] || 0),
      totalCost: Number(summary['totalCost'] || 0),
      errorRate: Number(summary['errorRate'] || 0),
      successRate: Number(summary['successRate'] || 0),
      startedAt: summary['startedAt'] || batch['startedAt'] || null,
      completedAt: summary['completedAt'] || batch['completedAt'] || null,
      notifyChannel: config.notifyChannel || null,
      scheduleContext,
    }
  }

  private async maybePauseBatchByErrorRate(
    batchObjectId: string,
    config: ResolvedBatchProcessingConfig,
  ) {
    if (config.pauseOnErrorRate === null) {
      return false
    }

    const batch = await this.syncBatchStateFromTasks(batchObjectId)
    const processedCount = Number(batch['completedCount'] || 0) + Number(batch['failedCount'] || 0)
    if (processedCount === 0) {
      return false
    }

    const errorRate = Number(batch['summary']?.['errorRate'] || 0)
    if (errorRate < config.pauseOnErrorRate) {
      return false
    }

    const status = this.normalizeBatchStatus(batch['status'])
    if (status !== ProductionBatchStatus.RUNNING) {
      return false
    }

    await this.productionBatchModel.findByIdAndUpdate(
      batch['_id'],
      {
        $set: {
          status: ProductionBatchStatus.PAUSED,
          errorMessage: `error_rate_exceeded:${errorRate.toFixed(4)}`,
        },
      },
    ).exec()

    return true
  }

  private async markBatchRunFailure(batchObjectId: string, errorMessage: string) {
    const batch = await this.getBatchRecordById(batchObjectId)
    if (!batch) {
      return
    }

    const currentStatus = this.normalizeBatchStatus(batch['status'])
    if (
      currentStatus === ProductionBatchStatus.CANCELLED
      || currentStatus === ProductionBatchStatus.COMPLETED
      || currentStatus === ProductionBatchStatus.PARTIAL
    ) {
      return
    }

    await this.productionBatchModel.findByIdAndUpdate(batch['_id'], {
      $set: {
        status: ProductionBatchStatus.FAILED,
        errorMessage,
      },
    }).exec()
  }

  private async syncBatchStateFromTasks(batchObjectId: string) {
    const [batch, tasks] = await Promise.all([
      this.getBatchRecordById(batchObjectId),
      this.videoTaskModel.find({
        batchId: this.toObjectIdIfValid(batchObjectId),
      }).lean().exec() as Promise<VideoTaskRecord[]>,
    ])

    if (!batch) {
      throw new NotFoundException('Production batch not found')
    }

    const normalizedTasks = this.collapseBatchTasks(tasks)
    const totalCount = Math.max(
      Number(batch['totalCount'] || batch['totalTasks'] || 0),
      this.getBatchTaskPlan(batch).length,
      normalizedTasks.length,
    )
    const completedTasks = normalizedTasks.filter(task => this.isSuccessfulTaskStatus(task['status']))
    const failedTasks = normalizedTasks.filter(task => this.isFailedTaskStatus(task['status']))
    const activeTaskCount = normalizedTasks.filter(task => !this.isTerminalTaskStatus(task['status'])).length
    const currentStatus = this.normalizeBatchStatus(batch['status'])
    const retryLimit = this.resolveBatchProcessingConfig(batch).retryLimit
    const skippedCount = failedTasks.filter(task => this.readTaskAttempt(task) >= retryLimit).length
    const allProcessed = totalCount > 0
      && normalizedTasks.length >= totalCount
      && activeTaskCount === 0

    let nextStatus = currentStatus
    if (currentStatus === ProductionBatchStatus.CANCELLED) {
      nextStatus = ProductionBatchStatus.CANCELLED
    }
    else if (currentStatus === ProductionBatchStatus.PAUSED && !allProcessed) {
      nextStatus = ProductionBatchStatus.PAUSED
    }
    else if (currentStatus === ProductionBatchStatus.FAILED && activeTaskCount === 0 && !allProcessed) {
      nextStatus = ProductionBatchStatus.FAILED
    }
    else if (normalizedTasks.length === 0) {
      nextStatus = ProductionBatchStatus.PENDING
    }
    else if (!allProcessed) {
      nextStatus = ProductionBatchStatus.RUNNING
    }
    else if (completedTasks.length === totalCount) {
      nextStatus = ProductionBatchStatus.COMPLETED
    }
    else if (failedTasks.length === totalCount) {
      nextStatus = ProductionBatchStatus.FAILED
    }
    else {
      nextStatus = ProductionBatchStatus.PARTIAL
    }

    const startedAt = batch['startedAt']
      || batch['summary']?.['startedAt']
      || normalizedTasks[0]?.['createdAt']
      || null
    const completedAt = [
      ProductionBatchStatus.COMPLETED,
      ProductionBatchStatus.FAILED,
      ProductionBatchStatus.PARTIAL,
    ].includes(nextStatus)
      ? (batch['completedAt'] || new Date())
      : null
    const latestFailedTask = failedTasks[failedTasks.length - 1]

    const updated = await this.productionBatchModel.findByIdAndUpdate(
      batch['_id'],
      {
        $set: {
          'status': nextStatus,
          'videoTaskIds': normalizedTasks.map(task => task['_id'].toString()),
          'tasks': normalizedTasks.map(task => ({
            taskId: task['_id'],
            status: task['status'],
            sourceVideoUrl: task['sourceVideoUrl'] || '',
            errorMessage: task['errorMessage'] || '',
          })),
          totalCount,
          'totalTasks': totalCount,
          'completedCount': completedTasks.length,
          'failedCount': failedTasks.length,
          'skippedCount': skippedCount,
          'completedTasks': completedTasks.length,
          'failedTasks': failedTasks.length,
          'completedTaskIds': completedTasks.map(task => task['_id'].toString()),
          'failedTaskIds': failedTasks.map(task => task['_id'].toString()),
          startedAt,
          completedAt,
          'errorMessage': [
            ProductionBatchStatus.RUNNING,
            ProductionBatchStatus.PENDING,
          ].includes(nextStatus)
            ? ''
            : latestFailedTask?.['errorMessage'] || batch['errorMessage'] || '',
          'summary': this.buildBatchSummary(normalizedTasks, totalCount, startedAt, completedAt, batch, skippedCount),
          'resumeState.lastProcessedIndex': this.resolveLastProcessedIndex(normalizedTasks),
        },
      },
      { new: true },
    ).lean().exec() as ProductionBatchRecord | null

    if (!updated) {
      throw new NotFoundException('Production batch not found')
    }

    return updated
  }

  private async ensurePipelineBelongsToOrg(orgId: string, pipelineId: string) {
    if (!pipelineId) {
      return
    }

    if (!Types.ObjectId.isValid(pipelineId)) {
      throw new BadRequestException('pipelineId is invalid')
    }

    const pipeline = await this.pipelineModel.findById(new Types.ObjectId(pipelineId)).lean().exec() as Record<string, any> | null
    if (!pipeline) {
      throw new NotFoundException('Pipeline not found')
    }

    const pipelineOrgId = pipeline['orgId']?.toString?.() || this.normalizeOptionalString(pipeline['orgId'])
    if (pipelineOrgId && pipelineOrgId !== orgId) {
      throw new BadRequestException('Pipeline does not belong to the organization')
    }
  }

  private ensureBatchCanRun(batch: ProductionBatchRecord) {
    const params = this.asRecord(batch['params']) || {}
    const referenceVideoUrl = this.normalizeOptionalString(params['referenceVideoUrl'])
    const existingTaskIds = this.normalizeStringList(batch['videoTaskIds'])
    const taskPlan = this.getBatchTaskPlan(batch)

    if (!referenceVideoUrl && !this.batchPlanHasPlayableSource(taskPlan) && existingTaskIds.length === 0) {
      throw new BadRequestException('referenceVideoUrl or taskPlan source is required for automated production batches')
    }
  }

  private buildBatchTaskInput(
    batch: ProductionBatchRecord,
    index: number,
    attempt = 0,
  ) {
    const params = this.asRecord(batch['params']) || {}
    const taskPlan = this.getBatchTaskPlan(batch)
    const planItem = taskPlan[index] || {}
    const sourceVideoUrl = this.resolveBatchTaskSourceVideoUrl(batch, planItem)
    const batchBusinessId = this.normalizeOptionalString(batch['batchId']) || batch['_id'].toString()

    return {
      brandId: batch['brandId']?.toString?.() || this.normalizeOptionalString(batch['brandId']) || undefined,
      pipelineId: batch['pipelineId']?.toString?.() || this.normalizeOptionalString(batch['pipelineId']) || undefined,
      batchId: batch['_id'].toString(),
      taskType: VideoTaskType.NEW_CONTENT,
      sourceVideoUrl,
      source: {
        type: sourceVideoUrl ? 'url' : 'manual',
        url: sourceVideoUrl,
        videoId: '',
      },
      metadata: {
        batchId: batchBusinessId,
        accountType: this.normalizeOptionalString(planItem['accountType']),
        firstFrameUrl: this.normalizeOptionalString(planItem['firstFrameUrl']),
        templateId: this.normalizeOptionalString(planItem['templateId']) || this.normalizeOptionalString(batch['templateId']),
        coverUrl: this.normalizeOptionalString(planItem['firstFrameUrl']),
        distribution: {
          assignmentId: this.normalizeOptionalString(planItem['assignmentId']),
          accountType: this.normalizeOptionalString(planItem['accountType']),
          platform: this.normalizeOptionalString(planItem['platform']),
          platformAccountId: this.normalizeOptionalString(planItem['platformAccountId']),
          accountId: this.normalizeOptionalString(planItem['accountId']),
          employeeName: this.normalizeOptionalString(planItem['employeeName']),
        },
        productionBatch: {
          batchId: batchBusinessId,
          batchIndex: index,
          attempt,
          templateId: this.normalizeOptionalString(planItem['templateId']) || this.normalizeOptionalString(batch['templateId']),
          requestedBy: this.normalizeOptionalString(batch['createdBy'])
            || this.normalizeOptionalString(batch['userId'])
            || this.normalizeOptionalString(batch['orgId']),
          assignmentId: this.normalizeOptionalString(planItem['assignmentId']),
          employeeName: this.normalizeOptionalString(planItem['employeeName']),
          employeePhone: this.normalizeOptionalString(planItem['employeePhone']),
          accountType: this.normalizeOptionalString(planItem['accountType']),
          platform: this.normalizeOptionalString(planItem['platform']),
          platformAccountId: this.normalizeOptionalString(planItem['platformAccountId']),
          platformAccountName: this.normalizeOptionalString(planItem['platformAccountName']),
          accountId: this.normalizeOptionalString(planItem['accountId']),
          firstFrameUrl: this.normalizeOptionalString(planItem['firstFrameUrl']),
          dailySequence: Number(planItem['dailySequence'] || 0),
          dailyQuota: Number(planItem['dailyQuota'] || 0),
          brandAssets: this.normalizeStringList(params['brandAssets']),
          styleOverrides: {
            ...(this.asRecord(params['styleOverrides']) || {}),
            ...(this.asRecord(planItem['styleOverrides']) || {}),
          },
          referenceVideoUrl: sourceVideoUrl,
          createdAt: new Date().toISOString(),
        },
      },
    }
  }

  private buildOrgMatch(orgId: string) {
    const normalizedOrgId = this.normalizeOrgId(orgId)
    const values: Array<string | Types.ObjectId> = [normalizedOrgId]
    const objectId = this.toObjectIdIfValid(normalizedOrgId)
    if (objectId) {
      values.push(objectId)
    }
    return {
      orgId: {
        $in: values,
      },
    }
  }

  private resolveBatchStatuses(status: string | undefined) {
    const normalized = this.normalizeOptionalString(status).toLowerCase()
    switch (normalized) {
      case '':
        return []
      case ProductionBatchStatus.RUNNING:
      case 'processing':
        return [ProductionBatchStatus.RUNNING, 'processing']
      case ProductionBatchStatus.FAILED:
      case ProductionBatchStatus.PARTIAL:
        return [ProductionBatchStatus.FAILED, ProductionBatchStatus.PARTIAL]
      case ProductionBatchStatus.PENDING:
      case ProductionBatchStatus.PAUSED:
      case ProductionBatchStatus.COMPLETED:
      case ProductionBatchStatus.CANCELLED:
        return [normalized]
      default:
        throw new BadRequestException('Invalid batch status')
    }
  }

  private normalizeBatchStatus(status: unknown): ProductionBatchStatus {
    const normalized = this.normalizeOptionalString(status).toLowerCase()
    if (normalized === ProductionBatchStatus.RUNNING || normalized === 'processing') {
      return ProductionBatchStatus.RUNNING
    }
    if (normalized === ProductionBatchStatus.PENDING) {
      return ProductionBatchStatus.PENDING
    }
    if (normalized === ProductionBatchStatus.PAUSED) {
      return ProductionBatchStatus.PAUSED
    }
    if (normalized === ProductionBatchStatus.COMPLETED) {
      return ProductionBatchStatus.COMPLETED
    }
    if (normalized === ProductionBatchStatus.PARTIAL) {
      return ProductionBatchStatus.PARTIAL
    }
    if (normalized === ProductionBatchStatus.CANCELLED) {
      return ProductionBatchStatus.CANCELLED
    }
    return ProductionBatchStatus.FAILED
  }

  private isTerminalBatchStatus(status: unknown) {
    const normalized = this.normalizeBatchStatus(status)
    return [
      ProductionBatchStatus.COMPLETED,
      ProductionBatchStatus.PARTIAL,
      ProductionBatchStatus.CANCELLED,
    ].includes(normalized)
  }

  private async getBatchRecordOrFail(orgId: string, batchId: string) {
    const normalizedBatchId = this.normalizeRequiredString(batchId, 'batchId')
    const orQueries: Record<string, unknown>[] = [{ batchId: normalizedBatchId }]
    if (Types.ObjectId.isValid(normalizedBatchId)) {
      orQueries.push({ _id: new Types.ObjectId(normalizedBatchId) })
    }

    const batch = await this.productionBatchModel.findOne({
      ...this.buildOrgMatch(orgId),
      $or: orQueries,
    }).lean().exec() as ProductionBatchRecord | null

    if (!batch) {
      throw new NotFoundException('Production batch not found')
    }

    return batch
  }

  private async getBatchRecordById(batchObjectId: string) {
    if (!Types.ObjectId.isValid(batchObjectId)) {
      return null
    }

    return this.productionBatchModel.findById(new Types.ObjectId(batchObjectId)).lean().exec() as Promise<ProductionBatchRecord | null>
  }

  private async getVideoTaskRecordOrFail(taskId: string) {
    if (!Types.ObjectId.isValid(taskId)) {
      throw new BadRequestException('videoTaskId is invalid')
    }

    const task = await this.videoTaskModel.findById(new Types.ObjectId(taskId)).lean().exec() as VideoTaskRecord | null
    if (!task) {
      throw new NotFoundException('Video task not found')
    }
    return task
  }

  private async getLatestTaskForIndex(batchObjectId: string, index: number) {
    return this.videoTaskModel.findOne({
      batchId: this.toObjectIdIfValid(batchObjectId),
      batchIndex: index,
    })
      .sort({ createdAt: -1, updatedAt: -1 })
      .lean()
      .exec() as Promise<VideoTaskRecord | null>
  }

  private isTerminalTaskStatus(status: unknown) {
    return [
      VideoTaskStatus.COMPLETED,
      VideoTaskStatus.PENDING_REVIEW,
      VideoTaskStatus.APPROVED,
      VideoTaskStatus.PUBLISHED,
      VideoTaskStatus.FAILED,
      VideoTaskStatus.CANCELLED,
    ].includes(status as VideoTaskStatus)
  }

  private isSuccessfulTaskStatus(status: unknown) {
    return [
      VideoTaskStatus.COMPLETED,
      VideoTaskStatus.PENDING_REVIEW,
      VideoTaskStatus.APPROVED,
      VideoTaskStatus.PUBLISHED,
    ].includes(status as VideoTaskStatus)
  }

  private isFailedTaskStatus(status: unknown) {
    return [
      VideoTaskStatus.FAILED,
      VideoTaskStatus.CANCELLED,
    ].includes(status as VideoTaskStatus)
  }

  private resolveLastProcessedIndex(tasks: VideoTaskRecord[]) {
    return tasks.reduce((maxIndex, task, index) => {
      if (!this.isTerminalTaskStatus(task['status'])) {
        return maxIndex
      }

      const taskIndex = typeof task['batchIndex'] === 'number'
        ? Number(task['batchIndex'])
        : index

      return Math.max(maxIndex, taskIndex)
    }, -1)
  }

  private buildBatchSummary(
    tasks: VideoTaskRecord[],
    totalCount: number,
    startedAt: Date | string | null,
    completedAt: Date | null,
    batch: ProductionBatchRecord,
    skippedCount: number,
  ) {
    const currentSummary = this.asRecord(batch['summary']) || {}
    const totalCost = tasks.reduce(
      (sum, task) => sum + Number(task['creditsConsumed'] || task['quotaUnits'] || 0),
      0,
    )
    const totalDuration = tasks.reduce(
      (sum, task) => sum + Number(task['output']?.['duration'] || task['quality']?.['duration'] || 0),
      0,
    )
    const completedCount = tasks.filter(task => this.isSuccessfulTaskStatus(task['status'])).length
    const failedTasks = tasks.filter(task => this.isFailedTaskStatus(task['status']))
    const processedCount = completedCount + failedTasks.length
    const averageBase = totalCount > 0 ? totalCount : tasks.length
    const normalizedStartedAt = startedAt ? new Date(startedAt) : null
    const elapsedMs = normalizedStartedAt
      ? Math.max((completedAt || new Date()).getTime() - normalizedStartedAt.getTime(), 0)
      : 0
    const plannedAccounts = new Set(this.getBatchTaskPlan(batch).map(item => this.buildPlanAccountKey(item)).filter(Boolean))
    const successAccounts = new Set(
      tasks
        .filter(task => this.isSuccessfulTaskStatus(task['status']))
        .map(task => this.extractTaskAccountKey(task))
        .filter(Boolean),
    )
    const failedAccounts = new Set(
      failedTasks
        .map(task => this.extractTaskAccountKey(task))
        .filter(Boolean),
    )
    const totalAccounts = Math.max(
      plannedAccounts.size,
      successAccounts.size + failedAccounts.size,
      Number(currentSummary['totalAccounts'] || 0),
    )

    return {
      avgCostPerVideo: averageBase > 0 ? Number((totalCost / averageBase).toFixed(2)) : 0,
      totalCost: Number(totalCost.toFixed(2)),
      avgDurationSec: averageBase > 0 ? Number((totalDuration / averageBase).toFixed(2)) : 0,
      totalDurationSec: Number(totalDuration.toFixed(2)),
      successRate: totalCount > 0 ? Number((completedCount / totalCount).toFixed(4)) : 0,
      errorRate: processedCount > 0 ? Number((failedTasks.length / processedCount).toFixed(4)) : 0,
      totalVideos: completedCount,
      totalAccounts,
      successAccounts: successAccounts.size,
      failedAccounts: failedAccounts.size,
      skippedAccounts: Math.min(totalAccounts, Math.max(skippedCount, Number(currentSummary['skippedAccounts'] || 0))),
      dedupPassed: Number(currentSummary['dedupPassed'] || 0),
      dedupFailed: Number(currentSummary['dedupFailed'] || 0),
      dedupCheckedAt: currentSummary['dedupCheckedAt'] || null,
      notifiedAt: currentSummary['notifiedAt'] || null,
      startedAt: normalizedStartedAt,
      completedAt,
      elapsedMs,
    }
  }

  private toBatchResponse(batch: ProductionBatchRecord) {
    return {
      id: batch['_id']?.toString(),
      batchId: this.normalizeOptionalString(batch['batchId']) || batch['_id']?.toString(),
      orgId: batch['orgId']?.toString?.() || this.normalizeOptionalString(batch['orgId']),
      pipelineId: batch['pipelineId']?.toString?.() || this.normalizeOptionalString(batch['pipelineId']) || null,
      templateId: this.normalizeOptionalString(batch['templateId']),
      status: this.normalizeBatchStatus(batch['status']),
      totalCount: Number(batch['totalCount'] || batch['totalTasks'] || 0),
      completedCount: Number(batch['completedCount'] || batch['completedTasks'] || 0),
      failedCount: Number(batch['failedCount'] || batch['failedTasks'] || 0),
      skippedCount: Number(batch['skippedCount'] || 0),
      videoTaskIds: this.normalizeStringList(batch['videoTaskIds']),
      completedTaskIds: this.normalizeStringList(batch['completedTaskIds']),
      failedTaskIds: this.normalizeStringList(batch['failedTaskIds']),
      params: batch['params'] || {},
      summary: batch['summary'] || {},
      resumeState: batch['resumeState'] || {
        lastProcessedIndex: -1,
        resumedAt: null,
        resumeCount: 0,
      },
      startedAt: batch['startedAt'] || null,
      completedAt: batch['completedAt'] || null,
      cancelledAt: batch['cancelledAt'] || null,
      errorMessage: batch['errorMessage'] || '',
      createdAt: batch['createdAt'] || null,
      updatedAt: batch['updatedAt'] || null,
    }
  }

  private generateBatchId() {
    const now = new Date()
    const pad = (value: number) => String(value).padStart(2, '0')
    const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}_${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`
    const random = randomBytes(3).toString('hex').slice(0, 6)
    return `batch_${stamp}_${random}`
  }

  private normalizeCount(value: unknown) {
    const normalized = Math.trunc(Number(value || 0))
    if (!Number.isFinite(normalized) || normalized <= 0) {
      throw new BadRequestException('count must be greater than 0')
    }
    return Math.min(normalized, 100)
  }

  private normalizeOrgId(orgId: string) {
    const normalized = this.normalizeOptionalString(orgId)
    if (!normalized) {
      throw new BadRequestException('orgId is required')
    }
    return normalized
  }

  private normalizeRequiredString(value: unknown, field: string) {
    const normalized = this.normalizeOptionalString(value)
    if (!normalized) {
      throw new BadRequestException(`${field} is required`)
    }
    return normalized
  }

  private normalizeOptionalString(value: unknown) {
    if (typeof value === 'string') {
      return value.trim()
    }
    if (value && typeof value === 'object' && 'toString' in value && typeof value.toString === 'function') {
      return String(value).trim()
    }
    return ''
  }

  private buildDateKeyForTimezone(timezone: string) {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })

    return formatter.format(new Date())
  }

  private normalizeStringList(value: unknown) {
    if (!Array.isArray(value)) {
      return []
    }
    return Array.from(new Set(value.map(item => this.normalizeOptionalString(item)).filter(Boolean)))
  }

  private normalizeBatchTaskPlan(value: unknown) {
    if (!Array.isArray(value)) {
      return []
    }

    return value
      .map((item) => {
        const record = this.asRecord(item)
        if (!record) {
          return null
        }

        return {
          assignmentId: this.normalizeOptionalString(record['assignmentId']),
          employeeName: this.normalizeOptionalString(record['employeeName']),
          employeePhone: this.normalizeOptionalString(record['employeePhone']),
          accountType: this.normalizeOptionalString(record['accountType']) || this.normalizeOptionalString(record['platform']),
          platform: this.normalizeOptionalString(record['platform']),
          platformAccountId: this.normalizeOptionalString(record['platformAccountId'] || record['id']),
          platformAccountName: this.normalizeOptionalString(record['platformAccountName'] || record['accountName']),
          accountId: this.normalizeOptionalString(record['accountId']),
          firstFrameUrl: this.normalizeOptionalString(record['firstFrameUrl'] || record['coverUrl'] || record['avatarUrl']),
          referenceVideoUrl: this.normalizeOptionalString(record['referenceVideoUrl']),
          templateId: this.normalizeOptionalString(record['templateId']),
          dailySequence: Math.max(Number(record['dailySequence'] || 0), 0),
          dailyQuota: Math.max(Number(record['dailyQuota'] || 0), 0),
          styleOverrides: this.asRecord(record['styleOverrides']) || {},
          metadata: this.asRecord(record['metadata']) || {},
        } as BatchTaskPlanItem
      })
      .filter((item): item is BatchTaskPlanItem => Boolean(item))
  }

  private normalizeBatchConfig(value: unknown): BatchProcessingConfig {
    const source = this.asRecord(value) || {}
    return {
      concurrency: this.normalizePositiveInteger(source['concurrency'], DEFAULT_BATCH_CONCURRENCY, 8),
      retryLimit: this.normalizePositiveInteger(source['retryLimit'], DEFAULT_BATCH_RETRY_LIMIT, 3),
      dedupOnComplete: this.normalizeBoolean(source['dedupOnComplete'], true),
      batchDedupOnFinish: this.normalizeBoolean(source['batchDedupOnFinish'], true),
      notifyChannel: this.normalizeOptionalString(source['notifyChannel']),
      pauseOnErrorRate: this.normalizeRatio(source['pauseOnErrorRate']),
    }
  }

  private resolveBatchProcessingConfig(batch: ProductionBatchRecord): ResolvedBatchProcessingConfig {
    const config = this.asRecord(batch['params']?.['config']) || {}
    return {
      concurrency: this.normalizePositiveInteger(config['concurrency'], DEFAULT_BATCH_CONCURRENCY, 8),
      retryLimit: this.normalizePositiveInteger(config['retryLimit'], DEFAULT_BATCH_RETRY_LIMIT, 3),
      dedupOnComplete: this.normalizeBoolean(config['dedupOnComplete'], true),
      batchDedupOnFinish: this.normalizeBoolean(config['batchDedupOnFinish'], true),
      notifyChannel: this.normalizeOptionalString(config['notifyChannel']),
      pauseOnErrorRate: this.normalizeRatio(config['pauseOnErrorRate']),
    }
  }

  private normalizePositiveInteger(value: unknown, fallback: number, max = 100) {
    const normalized = Math.trunc(Number(value))
    if (!Number.isFinite(normalized) || normalized <= 0) {
      return fallback
    }
    return Math.min(normalized, max)
  }

  private normalizeBoolean(value: unknown, fallback: boolean) {
    if (typeof value === 'boolean') {
      return value
    }
    if (typeof value === 'string') {
      if (value === 'true') {
        return true
      }
      if (value === 'false') {
        return false
      }
    }
    return fallback
  }

  private normalizeRatio(value: unknown) {
    const normalized = Number(value)
    if (!Number.isFinite(normalized) || normalized <= 0) {
      return null
    }
    return Math.min(Math.max(normalized, 0.01), 1)
  }

  private asRecord(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
  }

  private toObjectIdIfValid(value: string) {
    return Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : null
  }

  private toObjectIdList(values: string[]) {
    return values
      .filter(value => Types.ObjectId.isValid(value))
      .map(value => new Types.ObjectId(value))
  }

  private delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  private getBatchTaskPlan(batch: ProductionBatchRecord) {
    return this.normalizeBatchTaskPlan(batch['params']?.['taskPlan'])
  }

  private batchPlanHasPlayableSource(taskPlan: BatchTaskPlanItem[]) {
    return taskPlan.some(item =>
      Boolean(
        this.normalizeOptionalString(item.referenceVideoUrl)
        || this.normalizeOptionalString(item.firstFrameUrl),
      ),
    )
  }

  private resolveBatchTaskSourceVideoUrl(batch: ProductionBatchRecord, planItem: BatchTaskPlanItem) {
    const params = this.asRecord(batch['params']) || {}
    return this.normalizeOptionalString(planItem.referenceVideoUrl)
      || this.normalizeOptionalString(params['referenceVideoUrl'])
      || this.normalizeOptionalString(planItem.firstFrameUrl)
  }

  private resolveAssignmentAccounts(
    assignment: GenericRecord,
    requestedPlatforms: Set<string>,
    requestedAccountTypes: Set<string>,
    requestedPlatformAccountIds: Set<string>,
  ) {
    const platformAccounts = Array.isArray(assignment['platformAccounts'])
      ? assignment['platformAccounts'] as GenericRecord[]
      : []

    const normalizedAccounts = platformAccounts
      .map(account => ({
        id: this.normalizeOptionalString(account['id']),
        platform: this.normalizeOptionalString(account['platform']).toLowerCase(),
        accountId: this.normalizeOptionalString(account['accountId']),
        accountName: this.normalizeOptionalString(account['accountName']),
        avatarUrl: this.normalizeOptionalString(account['avatarUrl']),
        coverUrl: this.normalizeOptionalString(account['coverUrl']),
        firstFrameUrl: this.normalizeOptionalString(account['firstFrameUrl']),
      }))
      .filter(account => Boolean(account.id || account.accountId || account.platform))

    const assignmentAccountTypes = new Set(
      this.normalizeStringList(assignment['distributionRules']?.['accountTypes']).map(item => item.toLowerCase()),
    )

    return normalizedAccounts.filter((account) => {
      if (requestedPlatformAccountIds.size > 0 && !requestedPlatformAccountIds.has(account.id)) {
        return false
      }
      if (requestedPlatforms.size > 0 && !requestedPlatforms.has(account.platform)) {
        return false
      }
      if (requestedAccountTypes.size > 0 && !requestedAccountTypes.has(account.platform)) {
        return false
      }
      if (assignmentAccountTypes.size > 0 && !assignmentAccountTypes.has(account.platform)) {
        return false
      }
      return true
    })
  }

  private sortAssignmentAccounts(accounts: GenericRecord[], defaultPlatformAccountId: string) {
    return accounts.slice().sort((left, right) => {
      const leftDefault = left['id'] === defaultPlatformAccountId ? 1 : 0
      const rightDefault = right['id'] === defaultPlatformAccountId ? 1 : 0
      if (leftDefault !== rightDefault) {
        return rightDefault - leftDefault
      }

      return this.normalizeOptionalString(left['accountName']).localeCompare(
        this.normalizeOptionalString(right['accountName']),
      )
    })
  }

  private isAssignmentTemplateEligible(
    assignment: GenericRecord,
    templateId: string | undefined,
    requestedTemplateIds: string[],
  ) {
    const assignmentTemplateIds = this.normalizeStringList(assignment['distributionRules']?.['templateIds'])
    if (requestedTemplateIds.length > 0 && templateId && !requestedTemplateIds.includes(templateId)) {
      return false
    }
    if (assignmentTemplateIds.length > 0 && templateId && !assignmentTemplateIds.includes(templateId)) {
      return false
    }
    return true
  }

  private resolveAssignmentFirstFrameUrl(assignment: GenericRecord, account: GenericRecord) {
    const metadata = this.asRecord(assignment['metadata']) || {}
    const accountId = this.normalizeOptionalString(account['id'])
    const firstFrameByAccountId = this.asRecord(metadata['firstFrameByAccountId']) || {}
    const coverByAccountId = this.asRecord(metadata['coverByAccountId']) || {}

    return this.normalizeOptionalString(firstFrameByAccountId[accountId])
      || this.normalizeOptionalString(coverByAccountId[accountId])
      || this.normalizeOptionalString(metadata['firstFrameUrl'])
      || this.normalizeOptionalString(account['firstFrameUrl'])
      || this.normalizeOptionalString(account['coverUrl'])
      || this.normalizeOptionalString(account['avatarUrl'])
  }

  private buildAccountTypeSummary(taskPlan: BatchTaskPlanItem[]) {
    return taskPlan.reduce<Record<string, number>>((acc, item) => {
      const key = this.normalizeOptionalString(item.accountType || item.platform) || 'unknown'
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})
  }

  private countUniquePlanAccounts(taskPlan: BatchTaskPlanItem[]) {
    return new Set(taskPlan.map(item => this.buildPlanAccountKey(item)).filter(Boolean)).size
  }

  private buildPlanAccountKey(item: BatchTaskPlanItem) {
    const platformAccountId = this.normalizeOptionalString(item.platformAccountId)
    const accountId = this.normalizeOptionalString(item.accountId)
    const accountType = this.normalizeOptionalString(item.accountType || item.platform)
    return platformAccountId || `${accountType}:${accountId}`
  }

  private extractTaskAccountKey(task: VideoTaskRecord | null | undefined) {
    const productionBatch = this.asRecord(task?.['metadata']?.['productionBatch']) || {}
    const platformAccountId = this.normalizeOptionalString(productionBatch['platformAccountId'])
    const accountId = this.normalizeOptionalString(productionBatch['accountId'])
    const accountType = this.normalizeOptionalString(productionBatch['accountType'] || productionBatch['platform'])
    return platformAccountId || `${accountType}:${accountId}`
  }

  private collapseBatchTasks(tasks: VideoTaskRecord[]) {
    const indexedTasks = new Map<number, VideoTaskRecord>()
    const unindexedTasks: VideoTaskRecord[] = []

    for (const task of tasks) {
      const batchIndex = typeof task['batchIndex'] === 'number'
        ? Number(task['batchIndex'])
        : null
      if (batchIndex === null || Number.isNaN(batchIndex)) {
        unindexedTasks.push(task)
        continue
      }

      const existing = indexedTasks.get(batchIndex)
      if (!existing || this.isLaterTaskVersion(task, existing)) {
        indexedTasks.set(batchIndex, task)
      }
    }

    return [
      ...Array.from(indexedTasks.entries())
        .sort((left, right) => left[0] - right[0])
        .map(([, task]) => task),
      ...unindexedTasks.sort((left, right) => this.compareTaskVersion(left, right)),
    ]
  }

  private isLaterTaskVersion(candidate: VideoTaskRecord, current: VideoTaskRecord) {
    return this.compareTaskVersion(candidate, current) > 0
  }

  private compareTaskVersion(left: VideoTaskRecord, right: VideoTaskRecord) {
    const leftCreatedAt = new Date(left['createdAt'] || 0).getTime()
    const rightCreatedAt = new Date(right['createdAt'] || 0).getTime()
    if (leftCreatedAt !== rightCreatedAt) {
      return leftCreatedAt - rightCreatedAt
    }

    const leftUpdatedAt = new Date(left['updatedAt'] || 0).getTime()
    const rightUpdatedAt = new Date(right['updatedAt'] || 0).getTime()
    return leftUpdatedAt - rightUpdatedAt
  }

  private readTaskAttempt(task: VideoTaskRecord | null | undefined) {
    const metadata = this.asRecord(task?.['metadata']) || {}
    const productionBatch = this.asRecord(metadata['productionBatch']) || {}
    const normalized = Number(productionBatch['attempt'] ?? task?.['retryCount'] ?? 0)
    if (!Number.isFinite(normalized) || normalized < 0) {
      return 0
    }
    return Math.trunc(normalized)
  }

  private isHttpUrl(value: string) {
    return /^https?:\/\//i.test(value)
  }
}
