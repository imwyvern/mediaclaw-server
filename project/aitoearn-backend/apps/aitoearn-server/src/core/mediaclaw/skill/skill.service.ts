import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Brand, Pipeline, PipelineStatus, VideoTask } from '@yikart/mongodb'
import { Model, Types } from 'mongoose'
import { MEDIACLAW_DISTRIBUTABLE_STATUSES } from '../video-task-status.utils'

interface SkillScope {
  orgId: string
  userId: string
}

interface AgentRegistration {
  agentId: string
  capabilities: string[]
  orgId: string
  userId: string
  registeredAt: Date
  lastSeenAt: Date
}

@Injectable()
export class SkillService {
  private readonly logger = new Logger(SkillService.name)
  private readonly agentRegistry = new Map<string, AgentRegistration>()

  constructor(
    @InjectModel(Brand.name) private readonly brandModel: Model<Brand>,
    @InjectModel(Pipeline.name) private readonly pipelineModel: Model<Pipeline>,
    @InjectModel(VideoTask.name) private readonly videoTaskModel: Model<VideoTask>,
  ) {}

  async registerAgent(agentId: string, capabilities: string[], scope: SkillScope) {
    const now = new Date()
    const registryKey = this.buildRegistryKey(agentId, scope.orgId)
    const registration: AgentRegistration = {
      agentId,
      capabilities: [...new Set((capabilities || []).filter(Boolean))],
      orgId: scope.orgId,
      userId: scope.userId,
      registeredAt: this.agentRegistry.get(registryKey)?.registeredAt ?? now,
      lastSeenAt: now,
    }

    this.agentRegistry.set(registryKey, registration)

    this.logger.log({
      message: 'MediaClaw skill agent registered',
      agentId,
      orgId: scope.orgId,
      capabilities: registration.capabilities,
    })

    return {
      ...registration,
      totalCapabilities: registration.capabilities.length,
    }
  }

  async getAgentConfig(agentId: string, scope: SkillScope) {
    const registration = this.touchRegistration(agentId, scope.orgId)
    const orgObjectId = this.toObjectId(scope.orgId)

    const [brands, pipelines] = await Promise.all([
      orgObjectId
        ? this.brandModel.find({ orgId: orgObjectId, isActive: true }).sort({ createdAt: -1 }).lean().exec()
        : Promise.resolve([]),
      orgObjectId
        ? this.pipelineModel.find({
            orgId: orgObjectId,
            status: { $ne: PipelineStatus.ARCHIVED },
          }).sort({ createdAt: -1 }).lean().exec()
        : Promise.resolve([]),
    ])

    const primaryPipeline = pipelines[0]

    return {
      agentId,
      capabilities: registration.capabilities,
      brands: brands.map(brand => ({
        id: brand._id?.toString(),
        name: brand.name,
        industry: brand.industry,
        logoUrl: brand.assets?.logoUrl || '',
      })),
      pipelines: pipelines.map(pipeline => ({
        id: pipeline._id?.toString(),
        name: pipeline.name,
        brandId: pipeline.brandId?.toString() || null,
        type: pipeline.type,
        status: pipeline.status,
        schedule: pipeline.schedule,
        preferences: pipeline.preferences,
      })),
      preferences: {
        preferredDuration: primaryPipeline?.preferences?.preferredDuration ?? 15,
        aspectRatio: primaryPipeline?.preferences?.aspectRatio ?? '9:16',
        preferredStyles: primaryPipeline?.preferences?.preferredStyles ?? [],
        avoidStyles: primaryPipeline?.preferences?.avoidStyles ?? [],
        subtitlePreferences: primaryPipeline?.preferences?.subtitlePreferences ?? {},
      },
      registeredAt: registration.registeredAt,
      lastSeenAt: registration.lastSeenAt,
    }
  }

  async submitFeedback(agentId: string, taskId: string, feedback: Record<string, any>, scope: SkillScope) {
    this.touchRegistration(agentId, scope.orgId)

    const feedbackEntry = {
      agentId,
      feedback,
      submittedAt: new Date(),
      submittedBy: scope.userId,
    }

    const task = await this.videoTaskModel.findOneAndUpdate(
      this.buildScopedTaskQuery(taskId, scope),
      {
        $push: { 'metadata.feedbacks': feedbackEntry },
        $set: {
          'metadata.latestFeedback': feedbackEntry,
          'metadata.lastFeedbackAt': feedbackEntry.submittedAt,
        },
      },
      { new: true },
    ).exec()

    if (!task) {
      throw new NotFoundException('Video task not found')
    }

    if (task.pipelineId) {
      await this.pipelineModel.findByIdAndUpdate(task.pipelineId, {
        $inc: { 'preferences.feedbackCount': 1 },
      }).exec()
    }

    return {
      taskId: task._id.toString(),
      feedbackCount: Array.isArray(task.metadata?.['feedbacks'])
        ? task.metadata['feedbacks'].length
        : 1,
      latestFeedbackAt: feedbackEntry.submittedAt,
    }
  }

  async getPendingDeliveries(agentId: string, scope: SkillScope) {
    this.touchRegistration(agentId, scope.orgId)

    const scopeFilter = this.buildTaskScope(scope)
    const deliveryFilter = {
      $or: [
        { 'metadata.delivery.status': { $exists: false } },
        { 'metadata.delivery.status': { $ne: 'delivered' } },
      ],
    }

    return this.videoTaskModel.find({
      status: { $in: MEDIACLAW_DISTRIBUTABLE_STATUSES },
      $and: [scopeFilter, deliveryFilter],
    })
      .sort({ completedAt: -1, createdAt: -1 })
      .lean()
      .exec()
      .then(tasks => tasks.map(task => ({
        taskId: task._id?.toString(),
        brandId: task.brandId?.toString() || null,
        pipelineId: task.pipelineId?.toString() || null,
        outputVideoUrl: task.outputVideoUrl,
        copy: task.copy,
        completedAt: task.completedAt,
        delivery: task.metadata?.['delivery'] || {
          status: 'pending',
        },
      })))
  }

  async confirmDelivery(agentId: string, taskId: string, scope: SkillScope) {
    this.touchRegistration(agentId, scope.orgId)

    const deliveredAt = new Date()
    const task = await this.videoTaskModel.findOneAndUpdate(
      this.buildScopedTaskQuery(taskId, scope),
      {
        $set: {
          'metadata.delivery': {
            agentId,
            status: 'delivered',
            deliveredAt,
            confirmedBy: scope.userId,
          },
        },
      },
      { new: true },
    ).exec()

    if (!task) {
      throw new NotFoundException('Video task not found')
    }

    return {
      taskId: task._id.toString(),
      delivered: true,
      deliveredAt,
    }
  }

  private touchRegistration(agentId: string, orgId: string) {
    const registryKey = this.buildRegistryKey(agentId, orgId)
    const registration = this.agentRegistry.get(registryKey)
    if (!registration) {
      throw new NotFoundException('Agent not registered')
    }

    registration.lastSeenAt = new Date()
    this.agentRegistry.set(registryKey, registration)
    return registration
  }

  private buildRegistryKey(agentId: string, orgId: string) {
    return `${orgId}:${agentId}`
  }

  private buildScopedTaskQuery(taskId: string, scope: SkillScope) {
    return {
      _id: new Types.ObjectId(taskId),
      ...this.buildTaskScope(scope),
    }
  }

  private buildTaskScope(scope: SkillScope) {
    const orgObjectId = this.toObjectId(scope.orgId)
    if (!orgObjectId) {
      return { userId: scope.userId }
    }

    return {
      $or: [
        { orgId: orgObjectId },
        { userId: scope.userId },
      ],
    }
  }

  private toObjectId(value?: string | null) {
    if (!value || !Types.ObjectId.isValid(value)) {
      return null
    }

    return new Types.ObjectId(value)
  }
}
