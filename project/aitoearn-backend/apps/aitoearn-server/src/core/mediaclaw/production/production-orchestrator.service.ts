import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import {
  Pipeline,
  ProductionBatch,
  ProductionBatchStatus,
  VideoTask,
  VideoTaskStatus,
  VideoTaskType,
} from '@yikart/mongodb'
import { Model, Types } from 'mongoose'
import { VideoService } from '../video/video.service'

interface CreateBatchParams {
  templateId?: string
  count?: number
  pipelineId?: string
  brandId?: string
  brandAssets?: string[]
  styleOverrides?: Record<string, unknown>
  referenceVideoUrl?: string
}

interface BatchFilters {
  status?: string
}

interface PaginationInput {
  page?: number
  limit?: number
}

type ProductionBatchRecord = Record<string, any>
type VideoTaskRecord = Record<string, any>

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
    private readonly videoService: VideoService,
  ) {}

  async createBatch(orgId: string, requestedBy: string, params: CreateBatchParams) {
    const normalizedOrgId = this.normalizeOrgId(orgId)
    const count = this.normalizeCount(params.count)
    const templateId = this.normalizeOptionalString(params.templateId)
    const pipelineId = this.normalizeOptionalString(params.pipelineId)
    const brandId = this.normalizeOptionalString(params.brandId)
    const referenceVideoUrl = this.normalizeOptionalString(params.referenceVideoUrl)
    const brandAssets = this.normalizeStringList(params.brandAssets)
    const styleOverrides = this.asRecord(params.styleOverrides) || {}

    await this.ensurePipelineBelongsToOrg(normalizedOrgId, pipelineId)

    const batchId = this.generateBatchId()
    const brandObjectId = this.toObjectIdIfValid(brandId)

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
      },
      summary: {
        avgCostPerVideo: 0,
        totalCost: 0,
        avgDurationSec: 0,
        successRate: 0,
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
      batchName: templateId || batchId,
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
          status: ProductionBatchStatus.RUNNING,
          startedAt,
          cancelledAt: null,
          errorMessage: '',
          'summary.startedAt': batch['summary']?.['startedAt'] || startedAt,
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
          status: ProductionBatchStatus.RUNNING,
          'resumeState.resumedAt': new Date(),
          'resumeState.resumeCount': Number(resumeState['resumeCount'] || 0) + 1,
          errorMessage: '',
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
        return {
          id: taskId,
          batchIndex: task?.['batchIndex'] ?? index,
          status: task?.['status'] || VideoTaskStatus.PENDING,
          retryCount: Number(task?.['retryCount'] || 0),
          errorMessage: task?.['errorMessage'] || '',
          sourceVideoUrl: task?.['sourceVideoUrl'] || '',
          outputVideoUrl: task?.['outputVideoUrl'] || task?.['output']?.['url'] || '',
          durationSec: Number(task?.['output']?.['duration'] || task?.['quality']?.['duration'] || 0),
          cost: Number(task?.['creditsConsumed'] || task?.['quotaUnits'] || 0),
          createdAt: task?.['createdAt'] || null,
          updatedAt: task?.['updatedAt'] || null,
        }
      }),
    }
  }

  private runBatchInBackground(orgId: string, batchObjectId: string) {
    if (this.activeBatchRuns.has(batchObjectId)) {
      return
    }

    const runner: Promise<void> = this.processBatch(orgId, batchObjectId)
      .then(() => undefined)
      .catch(async error => {
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

    const totalCount = Math.max(Number(batch['totalCount'] || batch['totalTasks'] || 0), 0)
    for (let index = 0; index < totalCount; index += 1) {
      const latestBatch = await this.syncBatchStateFromTasks(batchObjectId)
      const latestStatus = this.normalizeBatchStatus(latestBatch['status'])

      if (latestStatus === ProductionBatchStatus.PAUSED || latestStatus === ProductionBatchStatus.CANCELLED) {
        return latestBatch
      }

      const existingTaskId = this.normalizeStringList(latestBatch['videoTaskIds'])[index]
      if (!existingTaskId) {
        const createdTask = await this.createBatchTask(latestBatch, index)
        await this.syncBatchStateFromTasks(batchObjectId)

        if (!this.isTerminalTaskStatus(createdTask['status'])) {
          await this.waitForTaskTerminalState(createdTask['_id'].toString())
        }
      }
      else {
        const existingTask = await this.getVideoTaskRecordOrFail(existingTaskId)
        if (!this.isTerminalTaskStatus(existingTask['status'])) {
          await this.waitForTaskTerminalState(existingTaskId)
        }
      }

      await this.syncBatchStateFromTasks(batchObjectId)
    }

    return this.finalizeBatch(orgId, batchObjectId)
  }

  private async createBatchTask(batch: ProductionBatchRecord, index: number) {
    const requestedBy = this.normalizeOptionalString(batch['createdBy'])
      || this.normalizeOptionalString(batch['userId'])
      || this.normalizeOptionalString(batch['orgId'])
    const orgId = batch['orgId']?.toString?.() || this.normalizeOptionalString(batch['orgId'])

    try {
      const task = await this.videoService.createTask(
        orgId,
        requestedBy,
        this.buildBatchTaskInput(batch, index),
      )

      const updatedTask = await this.videoTaskModel.findByIdAndUpdate(
        task._id,
        {
          $set: {
            batchIndex: index,
            maxRetries: 2,
            'metadata.productionBatch.batchIndex': index,
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
      return this.createFailedBatchTask(batch, index, error)
    }
  }

  private async createFailedBatchTask(
    batch: ProductionBatchRecord,
    index: number,
    error: unknown,
  ) {
    const params = this.asRecord(batch['params']) || {}
    const referenceVideoUrl = this.normalizeOptionalString(params['referenceVideoUrl'])
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
      sourceVideoUrl: referenceVideoUrl,
      source: {
        type: referenceVideoUrl ? 'url' : 'manual',
        url: referenceVideoUrl,
        videoId: '',
      },
      creditsConsumed: 0,
      creditCharged: false,
      retryCount: 0,
      maxRetries: 2,
      errorMessage: message,
      errorLog: [
        {
          step: 'production-orchestrator',
          message,
          detail: {
            batchId: batchBusinessId,
            batchIndex: index,
          },
          recordedAt: new Date(),
        },
      ],
      metadata: {
        batchId: batchBusinessId,
        productionBatch: {
          batchId: batchBusinessId,
          batchIndex: index,
          templateId: this.normalizeOptionalString(batch['templateId']),
          requestedBy,
          brandAssets: this.normalizeStringList(params['brandAssets']),
          styleOverrides: this.asRecord(params['styleOverrides']) || {},
          referenceVideoUrl,
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
    const batch = await this.syncBatchStateFromTasks(
      (await this.getBatchRecordOrFail(orgId, batchId))['_id'].toString(),
    )

    this.logger.log({
      message: 'Production batch processed',
      batchId: batch['batchId'],
      status: batch['status'],
      completedCount: batch['completedCount'],
      failedCount: batch['failedCount'],
    })

    return this.toBatchResponse(batch)
  }

  private async markBatchRunFailure(batchObjectId: string, errorMessage: string) {
    const batch = await this.getBatchRecordById(batchObjectId)
    if (!batch) {
      return
    }

    const currentStatus = this.normalizeBatchStatus(batch['status'])
    if (currentStatus === ProductionBatchStatus.CANCELLED || currentStatus === ProductionBatchStatus.COMPLETED) {
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

    const normalizedTasks = tasks.slice().sort((left, right) => {
      const leftIndex = typeof left['batchIndex'] === 'number' ? Number(left['batchIndex']) : Number.MAX_SAFE_INTEGER
      const rightIndex = typeof right['batchIndex'] === 'number' ? Number(right['batchIndex']) : Number.MAX_SAFE_INTEGER
      if (leftIndex !== rightIndex) {
        return leftIndex - rightIndex
      }

      const leftCreatedAt = new Date(left['createdAt'] || 0).getTime()
      const rightCreatedAt = new Date(right['createdAt'] || 0).getTime()
      return leftCreatedAt - rightCreatedAt
    })
    const totalCount = Math.max(Number(batch['totalCount'] || batch['totalTasks'] || 0), normalizedTasks.length)
    const completedTasks = normalizedTasks.filter(task => task['status'] === VideoTaskStatus.COMPLETED)
    const failedTasks = normalizedTasks.filter(task => this.isFailedTaskStatus(task['status']))
    const activeTaskCount = normalizedTasks.filter(task => !this.isTerminalTaskStatus(task['status'])).length
    const currentStatus = this.normalizeBatchStatus(batch['status'])
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
          status: nextStatus,
          videoTaskIds: normalizedTasks.map(task => task['_id'].toString()),
          tasks: normalizedTasks.map(task => ({
            taskId: task['_id'],
            status: task['status'],
            sourceVideoUrl: task['sourceVideoUrl'] || '',
            errorMessage: task['errorMessage'] || '',
          })),
          totalCount,
          totalTasks: totalCount,
          completedCount: completedTasks.length,
          failedCount: failedTasks.length,
          completedTasks: completedTasks.length,
          failedTasks: failedTasks.length,
          completedTaskIds: completedTasks.map(task => task['_id'].toString()),
          failedTaskIds: failedTasks.map(task => task['_id'].toString()),
          startedAt,
          completedAt,
          errorMessage: [
            ProductionBatchStatus.RUNNING,
            ProductionBatchStatus.PENDING,
          ].includes(nextStatus)
            ? ''
            : latestFailedTask?.['errorMessage'] || batch['errorMessage'] || '',
          summary: this.buildBatchSummary(normalizedTasks, totalCount, startedAt, completedAt),
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

    if (!referenceVideoUrl && existingTaskIds.length === 0) {
      throw new BadRequestException('referenceVideoUrl is required for automated production batches')
    }
  }

  private buildBatchTaskInput(batch: ProductionBatchRecord, index: number) {
    const params = this.asRecord(batch['params']) || {}
    const referenceVideoUrl = this.normalizeOptionalString(params['referenceVideoUrl'])
    const batchBusinessId = this.normalizeOptionalString(batch['batchId']) || batch['_id'].toString()

    return {
      brandId: batch['brandId']?.toString?.() || this.normalizeOptionalString(batch['brandId']) || undefined,
      pipelineId: batch['pipelineId']?.toString?.() || this.normalizeOptionalString(batch['pipelineId']) || undefined,
      batchId: batch['_id'].toString(),
      taskType: VideoTaskType.NEW_CONTENT,
      sourceVideoUrl: referenceVideoUrl,
      source: {
        type: referenceVideoUrl ? 'url' : 'manual',
        url: referenceVideoUrl,
        videoId: '',
      },
      metadata: {
        batchId: batchBusinessId,
        productionBatch: {
          batchId: batchBusinessId,
          batchIndex: index,
          templateId: this.normalizeOptionalString(batch['templateId']),
          requestedBy: this.normalizeOptionalString(batch['createdBy'])
            || this.normalizeOptionalString(batch['userId'])
            || this.normalizeOptionalString(batch['orgId']),
          brandAssets: this.normalizeStringList(params['brandAssets']),
          styleOverrides: this.asRecord(params['styleOverrides']) || {},
          referenceVideoUrl,
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

  private isTerminalTaskStatus(status: unknown) {
    return [
      VideoTaskStatus.COMPLETED,
      VideoTaskStatus.FAILED,
      VideoTaskStatus.CANCELLED,
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
  ) {
    const totalCost = tasks.reduce(
      (sum, task) => sum + Number(task['creditsConsumed'] || task['quotaUnits'] || 0),
      0,
    )
    const totalDuration = tasks.reduce(
      (sum, task) => sum + Number(task['output']?.['duration'] || task['quality']?.['duration'] || 0),
      0,
    )
    const completedCount = tasks.filter(task => task['status'] === VideoTaskStatus.COMPLETED).length
    const averageBase = totalCount > 0 ? totalCount : tasks.length
    const normalizedStartedAt = startedAt ? new Date(startedAt) : null
    const elapsedMs = normalizedStartedAt
      ? Math.max((completedAt || new Date()).getTime() - normalizedStartedAt.getTime(), 0)
      : 0

    return {
      avgCostPerVideo: averageBase > 0 ? Number((totalCost / averageBase).toFixed(2)) : 0,
      totalCost: Number(totalCost.toFixed(2)),
      avgDurationSec: averageBase > 0 ? Number((totalDuration / averageBase).toFixed(2)) : 0,
      successRate: totalCount > 0 ? Number((completedCount / totalCount).toFixed(4)) : 0,
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
    const random = Math.random().toString(36).slice(2, 6)
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

  private normalizeStringList(value: unknown) {
    if (!Array.isArray(value)) {
      return []
    }
    return Array.from(new Set(value.map(item => this.normalizeOptionalString(item)).filter(Boolean)))
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
}
