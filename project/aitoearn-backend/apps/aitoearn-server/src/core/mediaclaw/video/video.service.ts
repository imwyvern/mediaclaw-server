import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { VideoTask, VideoTaskStatus, VideoTaskType } from '@yikart/mongodb'
import { BillingService } from '../billing/billing.service'

@Injectable()
export class VideoService {
  private readonly logger = new Logger(VideoService.name)

  constructor(
    @InjectModel(VideoTask.name) private readonly videoTaskModel: Model<VideoTask>,
    private readonly billingService: BillingService,
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

    // TODO: Add to BullMQ queue for processing
    // await this.videoQueue.add('process-video', { taskId: task._id })

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
    if (filters?.status) query.status = filters.status
    if (filters?.brandId) query.brandId = new Types.ObjectId(filters.brandId)

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
    if (!task) throw new NotFoundException('Video task not found')
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
    const update: any = { status }
    if (data?.outputVideoUrl) update.outputVideoUrl = data.outputVideoUrl
    if (data?.errorMessage) update.errorMessage = data.errorMessage
    if (data?.quality) update.quality = data.quality
    if (data?.copy) update.copy = data.copy

    if (status === VideoTaskStatus.ANALYZING || status === VideoTaskStatus.EDITING) {
      update.startedAt = new Date()
    }
    if (status === VideoTaskStatus.COMPLETED || status === VideoTaskStatus.FAILED) {
      update.completedAt = new Date()
    }

    // If failed, refund credit
    if (status === VideoTaskStatus.FAILED) {
      const task = await this.videoTaskModel.findById(taskId).exec()
      if (task?.creditCharged) {
        // TODO: Implement credit refund
        this.logger.warn(`Task ${taskId} failed — credit refund needed`)
      }
    }

    return this.videoTaskModel.findByIdAndUpdate(taskId, update, { new: true }).exec()
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
  async editCopy(taskId: string, copy: { title?: string; subtitle?: string; hashtags?: string[]; commentGuide?: string }) {
    return this.videoTaskModel.findByIdAndUpdate(
      taskId,
      { $set: { 'copy': copy } },
      { new: true },
    ).exec()
  }
}
