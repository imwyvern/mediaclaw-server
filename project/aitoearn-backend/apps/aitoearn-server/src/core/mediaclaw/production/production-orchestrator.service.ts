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

  constructor(
    @InjectModel(ProductionBatch.name)
    private readonly productionBatchModel: Model<ProductionBatch>,
    @InjectModel(VideoTask.name)
    private readonly videoTaskModel: Model<VideoTask>,
    @InjectModel(Pipeline.name)
    private readonly pipelineModel: Model<Pipeline>,
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
    const now = new Date()
    const pipelineObjectId = this.toObjectIdIfValid(pipelineId)
    const orgObjectId = this.toObjectIdIfValid(normalizedOrgId)
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

    try {
      const taskPayloads = Array.from({ length: count }, (_, index) => ({
        userId: requestedBy || normalizedOrgId,
        orgId: orgObjectId,
        brandId: brandObjectId,
        pipelineId: pipelineObjectId,
        batchId: batch._id,
        batchIndex: index,
        taskType: VideoTaskType.NEW_CONTENT,
        status: VideoTaskStatus.PENDING,
        sourceVideoUrl: referenceVideoUrl,
        source: {
          type: referenceVideoUrl ? 'url' : 'manual',
          url: referenceVideoUrl,
          videoId: '',
        },
        retryCount: 0,
        maxRetries: 2,
        metadata: {
          batchId,
          productionBatch: {
            batchId,
            batchIndex: index,
            templateId,
            requestedBy,
            brandAssets,
            styleOverrides,
            referenceVideoUrl,
            createdAt: now.toISOString(),
          },
        },
      }))

      const tasks = await this.videoTaskModel.insertMany(taskPayloads)
      const taskIds = tasks.map(task => task._id.toString())
      const legacyTasks = tasks.map(task => ({
        taskId: task._id,
        status: task.status,
        sourceVideoUrl: task.sourceVideoUrl,
        errorMessage: '',
      }))

      const updated = await this.productionBatchModel.findByIdAndUpdate(
        batch._id,
        {
          $set: {
            videoTaskIds: taskIds,
            tasks: legacyTasks,
            totalCount: taskIds.length,
            totalTasks: taskIds.length,
          },
        },
        { new: true },
      ).lean().exec() as ProductionBatchRecord | null

      if (!updated) {
        throw new NotFoundException('Production batch not found')
      }

      return this.toBatchResponse(updated)
    }
    catch (error) {
      await this.productionBatchModel.findByIdAndDelete(batch._id).exec().catch(() => undefined)
      throw error
    }
  }

  async startBatch(orgId: string, batchId: string) {
    const batch = await this.getBatchRecordOrFail(orgId, batchId)
    if (this.isTerminalBatchStatus(batch['status'])) {
      return this.toBatchResponse(batch)
    }

    const startedAt = batch['startedAt'] || new Date()
    await this.productionBatchModel.findByIdAndUpdate(batch['_id'], {
      $set: {
        status: ProductionBatchStatus.RUNNING,
        startedAt,
        cancelledAt: null,
        errorMessage: '',
        'summary.startedAt': batch['summary']?.['startedAt'] || startedAt,
      },
    }).exec()

    return this.processBatch(orgId, batchId, false)
  }

  async pauseBatch(orgId: string, batchId: string) {
    const batch = await this.getBatchRecordOrFail(orgId, batchId)
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
    const batch = await this.getBatchRecordOrFail(orgId, batchId)
    const currentStatus = this.normalizeBatchStatus(batch['status'])
    if (currentStatus === ProductionBatchStatus.CANCELLED || currentStatus === ProductionBatchStatus.COMPLETED) {
      throw new BadRequestException('Only paused or failed batches can be resumed')
    }

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

    return this.processBatch(orgId, batchId, true, updated || batch)
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
    return this.toBatchResponse(await this.getBatchRecordOrFail(orgId, batchId))
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

    return {
      items: items.map(item => this.toBatchResponse(item)),
      total,
      page,
      limit,
    }
  }

  async getBatchSummary(orgId: string, batchId: string) {
    const batch = await this.getBatchRecordOrFail(orgId, batchId)
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

  private async processBatch(
    orgId: string,
    batchId: string,
    isResume: boolean,
    existingBatch?: ProductionBatchRecord,
  ) {
    const initialBatch = existingBatch || await this.getBatchRecordOrFail(orgId, batchId)
    const taskIds = this.normalizeStringList(initialBatch['videoTaskIds'])
    const resumeState = this.asRecord(initialBatch['resumeState']) || {}
    const completedIds = new Set(this.normalizeStringList(initialBatch['completedTaskIds']))
    const startIndex = isResume
      ? Math.max(Number(resumeState['lastProcessedIndex'] || -1) + 1, 0)
      : 0

    if (isResume && startIndex > 0) {
      await this.productionBatchModel.findByIdAndUpdate(initialBatch['_id'], {
        $set: {
          skippedCount: Math.max(Number(initialBatch['skippedCount'] || 0), completedIds.size),
        },
      }).exec()
    }

    for (let index = startIndex; index < taskIds.length; index += 1) {
      const latestBatch = await this.getBatchRecordById(initialBatch['_id'].toString())
      if (!latestBatch) {
        throw new NotFoundException('Production batch not found')
      }

      const latestStatus = this.normalizeBatchStatus(latestBatch['status'])
      if (latestStatus === ProductionBatchStatus.PAUSED || latestStatus === ProductionBatchStatus.CANCELLED) {
        return this.toBatchResponse(latestBatch)
      }

      const taskId = taskIds[index]
      if (!taskId || completedIds.has(taskId)) {
        continue
      }

      await this.runTaskWithRetries(latestBatch, taskId, index)
    }

    return this.finalizeBatch(orgId, batchId)
  }

  private async runTaskWithRetries(batch: ProductionBatchRecord, taskId: string, index: number) {
    const batchBusinessId = this.normalizeOptionalString(batch['batchId']) || batch['_id'].toString()
    let task = await this.getVideoTaskRecordOrFail(taskId)

    while (Number(task['retryCount'] || 0) <= 2) {
      await this.videoTaskModel.findByIdAndUpdate(task['_id'], {
        $set: {
          status: VideoTaskStatus.EDITING,
          errorMessage: '',
          'metadata.productionBatch.batchId': batchBusinessId,
          'metadata.productionBatch.batchIndex': index,
          'metadata.productionBatch.startedAt': new Date().toISOString(),
        },
      }).exec()

      const execution = await this.executePipelineStub(batchBusinessId, taskId)
      if (execution.success) {
        const completedAt = new Date()
        await Promise.all([
          this.videoTaskModel.findByIdAndUpdate(task['_id'], {
            $set: {
              status: VideoTaskStatus.COMPLETED,
              outputVideoUrl: execution.outputVideoUrl,
              output: {
                url: execution.outputVideoUrl,
                duration: execution.durationSec,
                resolution: '1080x1920',
                fileSize: execution.durationSec * 1024,
              },
              quality: {
                duration: execution.durationSec,
              },
              errorMessage: '',
              completedAt,
              'metadata.productionBatch.completedAt': completedAt.toISOString(),
              'metadata.productionBatch.cost': execution.cost,
            },
          }).exec(),
          this.updateBatchTaskState(batch['_id'].toString(), taskId, index, {
            taskStatus: VideoTaskStatus.COMPLETED,
            batchStatus: ProductionBatchStatus.RUNNING,
            errorMessage: '',
            lastProcessedIndex: index,
            completed: true,
            failed: false,
          }),
        ])
        return
      }

      const nextRetryCount = Number(task['retryCount'] || 0) + 1
      if (nextRetryCount <= 2) {
        await this.videoTaskModel.findByIdAndUpdate(task['_id'], {
          $set: {
            status: VideoTaskStatus.PENDING,
            retryCount: nextRetryCount,
            errorMessage: execution.errorMessage,
            'metadata.productionBatch.lastRetryAt': new Date().toISOString(),
          },
        }).exec()
        task = await this.getVideoTaskRecordOrFail(taskId)
        continue
      }

      await Promise.all([
        this.videoTaskModel.findByIdAndUpdate(task['_id'], {
          $set: {
            status: VideoTaskStatus.FAILED,
            retryCount: nextRetryCount,
            errorMessage: execution.errorMessage,
            'metadata.productionBatch.failedAt': new Date().toISOString(),
          },
        }).exec(),
        this.updateBatchTaskState(batch['_id'].toString(), taskId, index, {
          taskStatus: VideoTaskStatus.FAILED,
          batchStatus: ProductionBatchStatus.RUNNING,
          errorMessage: execution.errorMessage || 'stub_pipeline_execution_failed',
          lastProcessedIndex: index,
          completed: false,
          failed: true,
        }),
      ])
      return
    }
  }

  private async updateBatchTaskState(
    batchObjectId: string,
    taskId: string,
    index: number,
    input: {
      taskStatus: VideoTaskStatus
      batchStatus: ProductionBatchStatus
      errorMessage: string
      lastProcessedIndex: number
      completed: boolean
      failed: boolean
    },
  ) {
    const batch = await this.getBatchRecordById(batchObjectId)
    if (!batch) {
      throw new NotFoundException('Production batch not found')
    }

    const completedSet = new Set(this.normalizeStringList(batch['completedTaskIds']))
    const failedSet = new Set(this.normalizeStringList(batch['failedTaskIds']))
    if (input.completed) {
      completedSet.add(taskId)
      failedSet.delete(taskId)
    }
    if (input.failed) {
      failedSet.add(taskId)
      completedSet.delete(taskId)
    }

    await this.productionBatchModel.findByIdAndUpdate(batch['_id'], {
      $set: {
        status: input.batchStatus,
        completedTaskIds: Array.from(completedSet),
        failedTaskIds: Array.from(failedSet),
        completedCount: completedSet.size,
        failedCount: failedSet.size,
        completedTasks: completedSet.size,
        failedTasks: failedSet.size,
        errorMessage: input.errorMessage,
        'resumeState.lastProcessedIndex': input.lastProcessedIndex,
        [`tasks.${index}.status`]: input.taskStatus,
        [`tasks.${index}.errorMessage`]: input.errorMessage,
      },
    }).exec()
  }

  private async finalizeBatch(orgId: string, batchId: string) {
    const batch = await this.getBatchRecordOrFail(orgId, batchId)
    const taskIds = this.normalizeStringList(batch['videoTaskIds'])
    const tasks = taskIds.length === 0
      ? []
      : await this.videoTaskModel.find({ _id: { $in: this.toObjectIdList(taskIds) } }).lean().exec() as VideoTaskRecord[]
    const completedCount = tasks.filter(task => task['status'] === VideoTaskStatus.COMPLETED).length
    const failedCount = tasks.filter(task => task['status'] === VideoTaskStatus.FAILED).length
    const totalCost = tasks.reduce((sum, task) => sum + Number(task['creditsConsumed'] || task['quotaUnits'] || 0), 0)
    const totalDuration = tasks.reduce((sum, task) => sum + Number(task['output']?.['duration'] || task['quality']?.['duration'] || 0), 0)
    const startedAt = batch['startedAt'] || batch['summary']?.['startedAt'] || new Date()
    const normalizedStatus = this.normalizeBatchStatus(batch['status'])
    const allProcessed = completedCount + failedCount >= taskIds.length && taskIds.length > 0
    const nextStatus = normalizedStatus === ProductionBatchStatus.CANCELLED
      ? ProductionBatchStatus.CANCELLED
      : normalizedStatus === ProductionBatchStatus.PAUSED
        ? ProductionBatchStatus.PAUSED
        : allProcessed
          ? (completedCount > 0 ? ProductionBatchStatus.COMPLETED : ProductionBatchStatus.FAILED)
          : ProductionBatchStatus.RUNNING
    const completedAt = allProcessed ? new Date() : null

    const updated = await this.productionBatchModel.findByIdAndUpdate(
      batch['_id'],
      {
        $set: {
          status: nextStatus,
          completedCount,
          failedCount,
          completedTasks: completedCount,
          failedTasks: failedCount,
          completedTaskIds: tasks.filter(task => task['status'] === VideoTaskStatus.COMPLETED).map(task => task['_id'].toString()),
          failedTaskIds: tasks.filter(task => task['status'] === VideoTaskStatus.FAILED).map(task => task['_id'].toString()),
          completedAt,
          summary: {
            avgCostPerVideo: taskIds.length > 0 ? Number((totalCost / taskIds.length).toFixed(2)) : 0,
            totalCost: Number(totalCost.toFixed(2)),
            avgDurationSec: taskIds.length > 0 ? Number((totalDuration / taskIds.length).toFixed(2)) : 0,
            successRate: taskIds.length > 0 ? Number((completedCount / taskIds.length).toFixed(4)) : 0,
            startedAt,
            completedAt,
            elapsedMs: completedAt ? completedAt.getTime() - new Date(startedAt).getTime() : 0,
          },
        },
      },
      { new: true },
    ).lean().exec() as ProductionBatchRecord | null

    if (!updated) {
      throw new NotFoundException('Production batch not found')
    }

    this.logger.log({
      message: 'Production batch processed',
      batchId: updated['batchId'],
      status: updated['status'],
      completedCount,
      failedCount,
    })

    return this.toBatchResponse(updated)
  }

  private async executePipelineStub(batchId: string, taskId: string) {
    // TODO: Replace this stub with the real production pipeline execution orchestrator.
    await this.sleep(120)
    const success = Math.random() < 0.7
    const durationSec = this.randomInt(12, 45)
    const cost = Number((0.8 + Math.random() * 1.7).toFixed(2))

    if (success) {
      return {
        success: true,
        durationSec,
        cost,
        outputVideoUrl: `https://stub.openclaw.local/${batchId}/${taskId}.mp4`,
      }
    }

    return {
      success: false,
      durationSec: 0,
      cost,
      errorMessage: 'stub_pipeline_execution_failed',
      outputVideoUrl: '',
    }
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
    if (normalized === ProductionBatchStatus.CANCELLED) {
      return ProductionBatchStatus.CANCELLED
    }
    return ProductionBatchStatus.FAILED
  }

  private isTerminalBatchStatus(status: unknown) {
    const normalized = this.normalizeBatchStatus(status)
    return normalized === ProductionBatchStatus.COMPLETED || normalized === ProductionBatchStatus.CANCELLED
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

  private sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  private randomInt(min: number, max: number) {
    return Math.floor(Math.random() * (max - min + 1)) + min
  }
}
