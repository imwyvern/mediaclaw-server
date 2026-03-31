import { InjectQueue } from '@nestjs/bullmq'
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
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
import { VIDEO_WORKER_QUEUE, VideoWorkerJobData } from '../worker/worker.constants'

@Injectable()
export class VideoService {
  private readonly logger = new Logger(VideoService.name)
  private readonly brandModel?: Model<Brand>
  private readonly pipelineModel?: Model<Pipeline>
  private readonly billingService?: BillingService
  private readonly videoWorkerQueue?: Queue<VideoWorkerJobData>

  constructor(
    @InjectModel(VideoTask.name) private readonly videoTaskModel: Model<VideoTask>,
    @InjectModel(Brand.name) brandModelOrBilling: Model<Brand> | BillingService,
    @InjectModel(Pipeline.name) pipelineModelOrQueue: Model<Pipeline> | Queue<VideoWorkerJobData>,
    billingService?: BillingService,
    @InjectQueue(VIDEO_WORKER_QUEUE)
    videoWorkerQueue?: Queue<VideoWorkerJobData>,
  ) {
    if (this.looksLikeBillingService(brandModelOrBilling)) {
      this.billingService = brandModelOrBilling
      this.videoWorkerQueue = pipelineModelOrQueue as Queue<VideoWorkerJobData>
      return
    }

    this.brandModel = brandModelOrBilling as Model<Brand>
    this.pipelineModel = pipelineModelOrQueue as Model<Pipeline>
    this.billingService = billingService
    this.videoWorkerQueue = videoWorkerQueue
  }

  /**
   * Create a new video production task
   * Deducts credit before queueing
   */
  async createTask(
    orgIdOrUserId: string,
    userIdOrData: string | {
      brandId?: string
      pipelineId?: string
      taskType: VideoTaskType
      sourceVideoUrl: string
      metadata?: Record<string, any>
    },
    maybeData?: {
      brandId?: string
      pipelineId?: string
      taskType: VideoTaskType
      sourceVideoUrl: string
      metadata?: Record<string, any>
    },
  ) {
    const isLegacySignature = typeof userIdOrData !== 'string'
    const orgId = typeof userIdOrData === 'string' ? orgIdOrUserId : orgIdOrUserId
    const userId = typeof userIdOrData === 'string' ? userIdOrData : orgIdOrUserId
    const data = typeof userIdOrData === 'string' ? maybeData : userIdOrData

    if (!data) {
      throw new BadRequestException('task payload is required')
    }

    // Calculate credits needed based on expected duration
    const credits = 1 // Default: ≤15s = 1 credit

    // Deduct credit first (fail fast if no credits)
    const taskId = new Types.ObjectId().toString()
    const charged = await this.billingService?.deductCredit(userId, taskId, credits)
    if (!charged) {
      throw new NotFoundException('Insufficient credits. Purchase a video pack to continue.')
    }

    const normalizedOrgId = isLegacySignature
      ? this.toOptionalObjectId(orgId)
      : this.toObjectId(orgId, 'orgId')
    await this.ensureBrandBelongsToOrg(data.brandId, normalizedOrgId)
    await this.ensurePipelineBelongsToOrg(data.pipelineId, normalizedOrgId)

    const task = await this.videoTaskModel.create({
      _id: new Types.ObjectId(taskId),
      userId,
      orgId: normalizedOrgId,
      brandId: data.brandId ? new Types.ObjectId(data.brandId) : null,
      pipelineId: data.pipelineId ? new Types.ObjectId(data.pipelineId) : null,
      taskType: data.taskType,
      status: VideoTaskStatus.PENDING,
      sourceVideoUrl: data.sourceVideoUrl,
      creditsConsumed: credits,
      creditCharged: true,
      metadata: data.metadata || {},
    })

    await this.videoWorkerQueue?.add(
      'analyze-source',
      { taskId: task._id.toString() },
      { jobId: `${task._id.toString()}:analyze-source` },
    )

    this.logger.log(`Video task created: ${task._id}, type: ${data.taskType}`)
    return task
  }

  /**
   * List video tasks for a user
   */
  async listTasks(orgId: string, userId: string, filters?: {
    status?: VideoTaskStatus
    brandId?: string
    page?: number
    limit?: number
  }) {
    const query: any = {
      userId,
      orgId: this.toObjectId(orgId, 'orgId'),
    }
    if (filters?.status)
      query.status = filters.status
    if (filters?.brandId)
      query.brandId = new Types.ObjectId(filters.brandId)

    const page = filters?.page || 1
    const limit = filters?.limit || 20
    const skip = (page - 1) * limit

    const [tasks, total] = await Promise.all([
      this.videoTaskModel.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.videoTaskModel.countDocuments(query),
    ])

    return { tasks, total, page, limit }
  }

  /**
   * Get single task detail
   */
  async getTask(orgId: string, taskId: string) {
    const task = await this.videoTaskModel.findOne(this.buildOwnershipQuery(orgId, taskId)).exec()
    if (!task)
      throw new NotFoundException('Video task not found')
    return task
  }

  async getTaskForWorker(taskId: string) {
    const task = await this.videoTaskModel.findById(this.toObjectId(taskId, 'taskId')).exec()
    if (!task) {
      throw new NotFoundException('Video task not found')
    }

    return task
  }

  /**
   * Update task status (called by worker)
   */
  async updateStatus(taskId: string, status: VideoTaskStatus, data?: {
    outputVideoUrl?: string
    errorMessage?: string
    quality?: any
    copy?: any
    deepSynthesis?: Record<string, any>
  }) {
    const timelineEntry = {
      status: this.mapTimelineStatus(status),
      rawStatus: status,
      timestamp: new Date().toISOString(),
    }

    const updateSet: Record<string, any> = { status }
    if (data?.outputVideoUrl)
      updateSet['outputVideoUrl'] = data.outputVideoUrl
    if (data?.errorMessage)
      updateSet['errorMessage'] = data.errorMessage
    if (data?.quality)
      updateSet['quality'] = data.quality
    if (data?.copy)
      updateSet['copy'] = data.copy
    if (data?.deepSynthesis)
      updateSet['metadata.compliance.aiDeepSynthesis'] = data.deepSynthesis

    if (status === VideoTaskStatus.ANALYZING || status === VideoTaskStatus.EDITING) {
      updateSet['startedAt'] = new Date()
    }
    if (status === VideoTaskStatus.COMPLETED || status === VideoTaskStatus.FAILED) {
      updateSet['completedAt'] = new Date()
    }

    // If failed, refund credit
    if (status === VideoTaskStatus.FAILED) {
      const task = await this.videoTaskModel.findById(taskId).exec()
      if (task?.creditCharged) {
        await this.billingService?.refundCredit(task.userId, task.creditsConsumed || 1)
        updateSet['creditCharged'] = false
        updateSet['metadata.creditRefundedAt'] = new Date().toISOString()
      }
    }

    return this.videoTaskModel.findByIdAndUpdate(
      taskId,
      {
        $set: updateSet,
        $push: { 'metadata.timeline': timelineEntry },
      },
      { new: true },
    ).exec()
  }

  async recordRetry(taskId: string, retryCount: number, errorMessage: string) {
    return this.videoTaskModel.findByIdAndUpdate(
      taskId,
      {
        retryCount,
        errorMessage,
      },
      { new: true },
    ).exec()
  }

  /**
   * Mark video as published
   */
  async markPublished(orgId: string, taskId: string) {
    await this.getTask(orgId, taskId)
    return this.videoTaskModel.findOneAndUpdate(
      this.buildOwnershipQuery(orgId, taskId),
      { 'metadata.publishedAt': new Date() },
      { new: true },
    ).exec()
  }

  /**
   * Edit copy for a completed video
   */
  async editCopy(orgId: string, taskId: string, copy: { title?: string, subtitle?: string, hashtags?: string[], commentGuide?: string }) {
    await this.getTask(orgId, taskId)
    return this.videoTaskModel.findOneAndUpdate(
      this.buildOwnershipQuery(orgId, taskId),
      { $set: { copy } },
      { new: true },
    ).exec()
  }

  private buildOwnershipQuery(orgId: string, taskId: string) {
    return {
      _id: this.toObjectId(taskId, 'taskId'),
      orgId: this.toObjectId(orgId, 'orgId'),
    }
  }

  private toObjectId(value: string, field: string) {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`${field} is invalid`)
    }

    return new Types.ObjectId(value)
  }

  private async ensureBrandBelongsToOrg(brandId: string | undefined, orgId: Types.ObjectId | null) {
    if (!brandId || !this.brandModel || !orgId) {
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

  private async ensurePipelineBelongsToOrg(pipelineId: string | undefined, orgId: Types.ObjectId | null) {
    if (!pipelineId || !this.pipelineModel || !orgId) {
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

  private mapTimelineStatus(status: VideoTaskStatus) {
    switch (status) {
      case VideoTaskStatus.PENDING:
        return 'queued'
      case VideoTaskStatus.PENDING_REVIEW:
        return 'pending_review'
      case VideoTaskStatus.APPROVED:
        return 'approved'
      case VideoTaskStatus.REJECTED:
        return 'rejected'
      case VideoTaskStatus.PUBLISHED:
        return 'published'
      case VideoTaskStatus.COMPLETED:
        return 'completed'
      case VideoTaskStatus.FAILED:
        return 'failed'
      case VideoTaskStatus.CANCELLED:
        return 'cancelled'
      default:
        return 'processing'
    }
  }

  private looksLikeBillingService(value: unknown): value is BillingService {
    return Boolean(value && typeof (value as BillingService).deductCredit === 'function')
  }

  private toOptionalObjectId(value: string) {
    return Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : null
  }
}
