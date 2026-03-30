import { InjectQueue } from '@nestjs/bullmq'
import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { VideoTask, VideoTaskStatus, VideoTaskType } from '@yikart/mongodb'
import { Queue } from 'bullmq'
import { Model, Types } from 'mongoose'
import { BillingService } from '../billing/billing.service'
import { VIDEO_WORKER_QUEUE, VideoWorkerJobData } from '../worker/worker.constants'

@Injectable()
export class VideoService {
  private readonly logger = new Logger(VideoService.name)

  constructor(
    @InjectModel(VideoTask.name) private readonly videoTaskModel: Model<VideoTask>,
    private readonly billingService: BillingService,
    @InjectQueue(VIDEO_WORKER_QUEUE)
    private readonly videoWorkerQueue: Queue<VideoWorkerJobData>,
  ) {}

  /**
   * Create a new video production task
   * Deducts credit before queueing
   */
  async createTask(userId: string, data: {
    brandId?: string
    pipelineId?: string
    taskType: VideoTaskType
    sourceVideoUrl: string
    metadata?: Record<string, any>
  }) {
    // Calculate credits needed based on expected duration
    const credits = 1 // Default: ≤15s = 1 credit

    // Deduct credit first (fail fast if no credits)
    const taskId = new Types.ObjectId().toString()
    const charged = await this.billingService.deductCredit(userId, taskId, credits)
    if (!charged) {
      throw new NotFoundException('Insufficient credits. Purchase a video pack to continue.')
    }

    const task = await this.videoTaskModel.create({
      _id: new Types.ObjectId(taskId),
      userId,
      orgId: data.brandId ? null : null, // TODO: resolve from brand
      brandId: data.brandId ? new Types.ObjectId(data.brandId) : null,
      pipelineId: data.pipelineId ? new Types.ObjectId(data.pipelineId) : null,
      taskType: data.taskType,
      status: VideoTaskStatus.PENDING,
      sourceVideoUrl: data.sourceVideoUrl,
      creditsConsumed: credits,
      creditCharged: true,
      metadata: data.metadata || {},
    })

    await this.videoWorkerQueue.add(
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
  async listTasks(userId: string, filters?: {
    status?: VideoTaskStatus
    brandId?: string
    page?: number
    limit?: number
  }) {
    const query: any = { userId }
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
  async getTask(taskId: string) {
    const task = await this.videoTaskModel.findById(taskId).exec()
    if (!task)
      throw new NotFoundException('Video task not found')
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
        // TODO: Implement credit refund
        this.logger.warn(`Task ${taskId} failed — credit refund needed`)
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
  async markPublished(taskId: string) {
    return this.videoTaskModel.findByIdAndUpdate(
      taskId,
      { 'metadata.publishedAt': new Date() },
      { new: true },
    ).exec()
  }

  /**
   * Edit copy for a completed video
   */
  async editCopy(taskId: string, copy: { title?: string, subtitle?: string, hashtags?: string[], commentGuide?: string }) {
    return this.videoTaskModel.findByIdAndUpdate(
      taskId,
      { $set: { copy } },
      { new: true },
    ).exec()
  }

  private mapTimelineStatus(status: VideoTaskStatus) {
    switch (status) {
      case VideoTaskStatus.PENDING:
        return 'queued'
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
}
