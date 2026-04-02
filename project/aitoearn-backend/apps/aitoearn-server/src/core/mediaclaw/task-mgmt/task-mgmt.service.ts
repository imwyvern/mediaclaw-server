import { InjectQueue } from '@nestjs/bullmq'
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import {
  Brand,
  Pipeline,
  VideoTask,
  VideoTaskStatus,
  VideoTaskType,
} from '@yikart/mongodb'
import { Queue } from 'bullmq'
import { Model, Types } from 'mongoose'
import { BillingService } from '../billing/billing.service'
import { UsageService } from '../usage/usage.service'
import { VIDEO_WORKER_QUEUE, VIDEO_WORKER_STEPS, VideoWorkerJobData } from '../worker/worker.constants'

interface CreateTaskParams {
  requestedBy: string
  brandId?: string
  pipelineId?: string
  taskType: VideoTaskType
  sourceVideoUrl?: string
  metadata?: Record<string, any>
}

interface TaskFilters {
  status?: VideoTaskStatus
  brandId?: string
  startDate?: string
  endDate?: string
}

interface PaginationInput {
  page?: number
  limit?: number
}

interface TaskTimelineEntry {
  status: string
  rawStatus?: string
  timestamp: string
  message?: string
}

@Injectable()
export class TaskMgmtService {
  constructor(
    @InjectModel(VideoTask.name)
    private readonly videoTaskModel: Model<VideoTask>,
    @InjectModel(Brand.name)
    private readonly brandModel: Model<Brand>,
    @InjectModel(Pipeline.name)
    private readonly pipelineModel: Model<Pipeline>,
    private readonly billingService: BillingService,
    @InjectQueue(VIDEO_WORKER_QUEUE)
    private readonly videoWorkerQueue: Queue<VideoWorkerJobData>,
    @Optional()
    private readonly usageService?: UsageService,
  ) {}

  async createTask(orgId: string, params: CreateTaskParams) {
    const normalizedOrgId = this.toObjectId(orgId, 'orgId')
    if (!params.requestedBy?.trim()) {
      throw new BadRequestException('requestedBy is required')
    }
    if (!params.taskType || !Object.values(VideoTaskType).includes(params.taskType)) {
      throw new BadRequestException('Invalid task type')
    }

    await this.ensureBrandBelongsToOrg(params.brandId, normalizedOrgId)
    await this.ensurePipelineBelongsToOrg(params.pipelineId, normalizedOrgId)

    const taskObjectId = new Types.ObjectId()
    const requestedDurationSec = this.resolveRequestedDuration(params.metadata)
    const chargeResult = await this.chargeTaskCredits(
      params.requestedBy,
      normalizedOrgId.toString(),
      taskObjectId.toString(),
      requestedDurationSec,
      params.metadata,
    )

    const createdAt = new Date().toISOString()
    const timeline = [
      this.createTimelineEntry('created', createdAt, 'Task created'),
      this.createTimelineEntry('queued', createdAt, 'Queued for processing', VideoTaskStatus.PENDING),
    ]

    let task: VideoTask | null = null

    try {
      task = await this.videoTaskModel.create({
        _id: taskObjectId,
        userId: params.requestedBy,
        orgId: normalizedOrgId,
        brandId: params.brandId ? this.toObjectId(params.brandId, 'brandId') : null,
        pipelineId: params.pipelineId ? this.toObjectId(params.pipelineId, 'pipelineId') : null,
        taskType: params.taskType,
        status: VideoTaskStatus.PENDING,
        sourceVideoUrl: params.sourceVideoUrl || '',
        creditsConsumed: chargeResult.units,
        creditCharged: true,
        metadata: {
          ...(params.metadata || {}),
          timeline,
          billing: {
            packId: chargeResult.packId,
            usageHistoryId: chargeResult.usageHistoryId,
            requestedDurationSec,
            chargedAt: createdAt,
          },
        },
      })

      await this.videoWorkerQueue.add(
        'analyze-source',
        { taskId: task._id.toString() },
        { jobId: `${task._id.toString()}:analyze-source` },
      )
    }
    catch (error) {
      await this.refundTaskCredits(
        params.requestedBy,
        normalizedOrgId.toString(),
        taskObjectId.toString(),
        chargeResult.units,
        {
          reason: 'task_create_failed',
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      )

      if (task) {
        await this.videoTaskModel.findByIdAndUpdate(task._id, {
          $set: {
            status: VideoTaskStatus.FAILED,
            creditCharged: false,
            errorMessage: error instanceof Error ? error.message : String(error),
            completedAt: new Date(),
            'metadata.creditRefundedAt': new Date().toISOString(),
          },
        }).exec()
      }

      throw error
    }

    return task
  }

  async getTask(orgIdOrTaskId: string, maybeTaskId?: string) {
    const taskId = maybeTaskId || orgIdOrTaskId
    const orgId = maybeTaskId ? orgIdOrTaskId : undefined
    const task = await this.findTask(orgId, taskId)
    if (!task) {
      throw new NotFoundException('Task not found')
    }
    return task
  }

  async listTasks(orgId: string, filters: TaskFilters, pagination: PaginationInput) {
    const page = this.normalizePage(pagination.page)
    const limit = this.normalizeLimit(pagination.limit)
    const skip = (page - 1) * limit
    const query = this.buildTaskQuery(orgId, filters)

    const [items, total] = await Promise.all([
      this.videoTaskModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.videoTaskModel.countDocuments(query),
    ])

    return {
      items: items.map(task => ({
        id: task._id.toString(),
        orgId: task.orgId?.toString() || null,
        userId: task.userId,
        brandId: task.brandId?.toString() || null,
        pipelineId: task.pipelineId?.toString() || null,
        taskType: task.taskType,
        status: task.status,
        sourceVideoUrl: task.sourceVideoUrl,
        outputVideoUrl: task.outputVideoUrl,
        retryCount: task.retryCount,
        errorMessage: task.errorMessage,
        createdAt: task.createdAt,
        startedAt: task.startedAt,
        completedAt: task.completedAt,
      })),
      total,
      page,
      limit,
    }
  }

  async cancelTask(orgId: string, taskId: string) {
    const task = await this.getTask(orgId, taskId)
    if (task.status !== VideoTaskStatus.PENDING) {
      throw new BadRequestException('Only pending tasks can be cancelled')
    }

    await this.removeQueuedJobs(task._id.toString())

    if (task.creditCharged) {
      await this.refundTaskCredits(
        task.userId,
        task.orgId?.toString() || null,
        task._id.toString(),
        task.creditsConsumed || 1,
        {
          reason: 'task_cancelled',
        },
      )
    }

    const updated = await this.videoTaskModel.findByIdAndUpdate(
      task._id,
      {
        $set: {
          'status': VideoTaskStatus.CANCELLED,
          'creditCharged': false,
          'completedAt': new Date(),
          'metadata.creditRefundedAt': new Date().toISOString(),
        },
        $push: {
          'metadata.timeline': this.createTimelineEntry(
            'cancelled',
            new Date().toISOString(),
            'Task cancelled by user',
            VideoTaskStatus.CANCELLED,
          ),
        },
      },
      { new: true },
    ).exec()

    return updated
  }

  async retryTask(orgId: string, taskId: string) {
    const task = await this.getTask(orgId, taskId)
    if (task.status !== VideoTaskStatus.FAILED) {
      throw new BadRequestException('Only failed tasks can be retried')
    }

    const updated = await this.videoTaskModel.findByIdAndUpdate(
      task._id,
      {
        $set: {
          status: VideoTaskStatus.PENDING,
          startedAt: null,
          completedAt: null,
          errorMessage: '',
        },
        $push: {
          'metadata.timeline': {
            $each: [
              this.createTimelineEntry(
                'retry_requested',
                new Date().toISOString(),
                'Retry requested by user',
              ),
              this.createTimelineEntry(
                'queued',
                new Date().toISOString(),
                'Queued for retry',
                VideoTaskStatus.PENDING,
              ),
            ],
          },
        },
      },
      { new: true },
    ).exec()

    await this.videoWorkerQueue.add(
      'analyze-source',
      { taskId: task._id.toString() },
      { jobId: `${task._id.toString()}:analyze-source:retry:${Date.now()}` },
    )

    return updated
  }

  async batchDownload(orgId: string, taskIds: string[]) {
    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      throw new BadRequestException('taskIds is required')
    }

    const objectIds = taskIds.map(taskId => this.toObjectId(taskId, 'taskId'))
    const tasks = await this.videoTaskModel.find({
      _id: { $in: objectIds },
      orgId: this.toObjectId(orgId, 'orgId'),
    }).lean().exec()

    return tasks.map(task => ({
      taskId: task._id.toString(),
      status: task.status,
      downloadUrl: task.outputVideoUrl
        ? `${task.outputVideoUrl}${task.outputVideoUrl.includes('?') ? '&' : '?'}download=1`
        : null,
    }))
  }

  async getTaskTimeline(orgIdOrTaskId: string, maybeTaskId?: string) {
    const taskId = maybeTaskId || orgIdOrTaskId
    const orgId = maybeTaskId ? orgIdOrTaskId : undefined
    const task = await this.findTask(orgId, taskId, true)
    if (!task) {
      throw new NotFoundException('Task not found')
    }

    return {
      taskId: task._id.toString(),
      timeline: this.normalizeTimeline(task),
    }
  }

  private async chargeTaskCredits(
    userId: string,
    orgId: string,
    taskId: string,
    durationSec: number,
    metadata?: Record<string, any>,
  ) {
    if (this.usageService) {
      return this.usageService.chargeVideo(userId, orgId, durationSec, {
        videoTaskId: taskId,
        metadata: {
          ...(metadata || {}),
          taskId,
        },
      })
    }

    const credits = this.resolveCreditUnits(durationSec)
    const charged = await this.billingService.deductCredit(userId, taskId, credits)

    if (!charged) {
      throw new BadRequestException('Insufficient credits')
    }

    return {
      usageHistoryId: null,
      packId: null,
      units: credits,
    }
  }

  private async refundTaskCredits(
    userId: string,
    orgId: string,
    taskId: string,
    credits: number,
    metadata: Record<string, any>,
  ) {
    if (this.usageService) {
      return this.usageService.refundVideoCharge(userId, orgId, taskId, metadata)
    }

    return this.billingService.refundCredit(userId, credits)
  }

  private resolveRequestedDuration(metadata?: Record<string, any>) {
    const candidates = [
      metadata?.['targetDurationSeconds'],
      metadata?.['durationSeconds'],
      metadata?.['targetDuration'],
      metadata?.['videoDurationSec'],
      metadata?.['duration'],
    ]

    for (const candidate of candidates) {
      const value = Number(candidate)
      if (Number.isFinite(value) && value > 0) {
        return value
      }
    }

    return 15
  }

  private resolveCreditUnits(duration: number) {
    if (duration <= 15) {
      return 1
    }
    if (duration <= 30) {
      return 2
    }

    return 4
  }

  private buildTaskQuery(orgId: string, filters: TaskFilters) {
    const query: Record<string, any> = {
      orgId: this.toObjectId(orgId, 'orgId'),
    }

    if (filters.status) {
      query['status'] = filters.status
    }

    if (filters.brandId) {
      query['brandId'] = this.toObjectId(filters.brandId, 'brandId')
    }

    if (filters.startDate || filters.endDate) {
      query['createdAt'] = {}
      if (filters.startDate) {
        query['createdAt']['$gte'] = new Date(filters.startDate)
      }
      if (filters.endDate) {
        query['createdAt']['$lte'] = new Date(filters.endDate)
      }
    }

    return query
  }

  private normalizeTimeline(task: any): TaskTimelineEntry[] {
    const fromMetadata = Array.isArray(task.metadata?.timeline)
      ? task.metadata.timeline
      : []

    if (fromMetadata.length > 0) {
      return fromMetadata
        .map((entry: any) => ({
          status: entry.status,
          rawStatus: entry.rawStatus,
          timestamp: entry.timestamp,
          message: entry.message,
        }))
        .sort((left: TaskTimelineEntry, right: TaskTimelineEntry) =>
          new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime(),
        )
    }

    const fallback: TaskTimelineEntry[] = [
      this.createTimelineEntry('created', new Date(task.createdAt).toISOString(), 'Task created'),
    ]

    if (task.status === VideoTaskStatus.PENDING) {
      fallback.push(
        this.createTimelineEntry('queued', new Date(task.createdAt).toISOString(), 'Queued for processing', task.status),
      )
    }
    if (task.startedAt) {
      fallback.push(
        this.createTimelineEntry('processing', new Date(task.startedAt).toISOString(), 'Task processing', task.status),
      )
    }
    if (task.completedAt) {
      fallback.push(
        this.createTimelineEntry(
          this.mapTerminalTimelineStatus(task.status),
          new Date(task.completedAt).toISOString(),
          'Task finished',
          task.status,
        ),
      )
    }

    return fallback
  }

  private mapTerminalTimelineStatus(status: VideoTaskStatus) {
    switch (status) {
      case VideoTaskStatus.COMPLETED:
        return 'completed'
      case VideoTaskStatus.APPROVED:
        return 'approved'
      case VideoTaskStatus.REJECTED:
        return 'rejected'
      case VideoTaskStatus.PUBLISHED:
        return 'published'
      case VideoTaskStatus.FAILED:
        return 'failed'
      case VideoTaskStatus.CANCELLED:
        return 'cancelled'
      default:
        return 'processing'
    }
  }

  private createTimelineEntry(
    status: string,
    timestamp: string,
    message: string,
    rawStatus?: VideoTaskStatus,
  ): TaskTimelineEntry {
    return {
      status,
      rawStatus,
      timestamp,
      message,
    }
  }

  private normalizePage(page?: number) {
    return Math.max(1, Math.trunc(Number(page) || 1))
  }

  private normalizeLimit(limit?: number) {
    return Math.max(1, Math.min(Math.trunc(Number(limit) || 20), 100))
  }

  private buildTaskOwnershipQuery(orgId: string, taskId: string) {
    return {
      _id: this.toDocumentId(taskId),
      orgId: this.toObjectId(orgId, 'orgId'),
    }
  }

  private async findTask(orgId: string | undefined, taskId: string, lean = false) {
    const taskIdQuery = this.toDocumentId(taskId)
    const videoTaskModel = this.videoTaskModel as unknown as {
      findOne?: (input: Record<string, any>) => any
      findById?: (input: unknown) => any
    }

    if (orgId && typeof videoTaskModel.findOne === 'function') {
      const query = videoTaskModel.findOne(this.buildTaskOwnershipQuery(orgId, taskId))
      return this.resolveQueryResult(query, lean)
    }

    if (typeof videoTaskModel.findById === 'function') {
      const task = await this.resolveQueryResult(videoTaskModel.findById(taskIdQuery), lean)
      if (!orgId || !task) {
        return task
      }

      return task.orgId?.toString?.() === this.toObjectId(orgId, 'orgId').toString()
        ? task
        : null
    }

    if (typeof videoTaskModel.findOne === 'function') {
      return this.resolveQueryResult(videoTaskModel.findOne({ _id: taskIdQuery }), lean)
    }

    return null
  }

  private toDocumentId(value: string) {
    return Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : value
  }

  private toObjectId(value: string, field: string) {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`${field} is invalid`)
    }

    return new Types.ObjectId(value)
  }

  private async ensureBrandBelongsToOrg(brandId: string | undefined, orgId: Types.ObjectId) {
    if (!brandId) {
      return
    }

    const brand = await this.brandModel.exists({
      _id: this.toObjectId(brandId, 'brandId'),
      orgId,
      isActive: true,
    })

    if (!brand) {
      throw new NotFoundException('Brand not found in organization')
    }
  }

  private async ensurePipelineBelongsToOrg(pipelineId: string | undefined, orgId: Types.ObjectId) {
    if (!pipelineId) {
      return
    }

    const pipeline = await this.pipelineModel.exists({
      _id: this.toObjectId(pipelineId, 'pipelineId'),
      orgId,
    })

    if (!pipeline) {
      throw new NotFoundException('Pipeline not found in organization')
    }
  }

  private async removeQueuedJobs(taskId: string) {
    await Promise.all(
      VIDEO_WORKER_STEPS.map(async (step) => {
        const job = await this.videoWorkerQueue.getJob(`${taskId}:${step}`)
        if (job) {
          await job.remove()
        }
      }),
    )
  }

  private async resolveQueryResult<T>(queryOrValue: T, lean = false) {
    if (!queryOrValue) {
      return queryOrValue
    }

    const maybeQuery = queryOrValue as T & {
      lean?: () => unknown
      exec?: () => Promise<unknown>
    }

    if (lean && typeof maybeQuery.lean === 'function') {
      const leaned = maybeQuery.lean()
      if (leaned && typeof (leaned as { exec?: () => Promise<unknown> }).exec === 'function') {
        return (leaned as { exec: () => Promise<T> }).exec()
      }
    }

    if (typeof maybeQuery.exec === 'function') {
      return maybeQuery.exec() as Promise<T>
    }

    return queryOrValue
  }
}
