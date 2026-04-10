import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import {
  DistributionRule,
  DistributionRuleType,
  NotificationEvent,
  PaymentOrder,
  Pipeline,
  VideoTask,
  VideoTaskStatus,
} from '@yikart/mongodb'
import { Model, Types } from 'mongoose'
import { EmployeeDispatchService } from '../employee-dispatch/employee-dispatch.service'
import { NotificationService } from '../notification/notification.service'
import { isDistributableVideoTaskStatus } from '../video-task-status.utils'
import { WebhookService } from '../webhook/webhook.service'
import {
  DistributionCallbackStatus,
  DistributionLifecycleStatus,
  DistributionPublishStatus,
  isDistributionLifecycleStatus,
  isDistributionPublishStatus,
} from './distribution.constants'
import { DistributionQueueService } from './distribution.queue.service'

export interface DistributionRuleEntryPayload {
  condition?: Record<string, unknown> | null
  action: string
  target: string
}

export interface DistributionRulePayload {
  name: string
  type: DistributionRuleType
  rules: DistributionRuleEntryPayload[]
  isActive?: boolean
  priority?: number
}

export interface DistributionTargetInput {
  action?: string
  target: string
}

interface DistributionTargetRecord {
  action: string
  target: string
  status: DistributionPublishStatus.PUSHED
  pushedAt: string
}

interface DistributionTimelineEntry {
  status: string
  timestamp: string
  details?: Record<string, unknown>
}

interface RuleEvaluationResult {
  matched: boolean
  rule: {
    id?: string
    name?: string
    type?: DistributionRuleType
    priority?: number
    isActive?: boolean
    rules?: DistributionRuleEntryPayload[]
  } | null
  selected: {
    action: string
    target: string
  } | null
}

interface DistributionStatusQuery {
  contentId?: string
  page?: number
  limit?: number
}

interface DistributionDashboardQuery {
  days?: number
  status?: 'all' | 'published' | 'expired' | 'pushed'
}

interface DistributionCallbackInput {
  status: DistributionCallbackStatus
  publishUrl?: string
  publishPostId?: string
  platform?: string
  reason?: string
}

@Injectable()
export class DistributionService {
  private readonly logger = new Logger(DistributionService.name)

  constructor(
    @InjectModel(DistributionRule.name)
    private readonly distributionRuleModel: Model<DistributionRule>,
    @InjectModel(VideoTask.name)
    private readonly videoTaskModel: Model<VideoTask>,
    @InjectModel(Pipeline.name)
    private readonly pipelineModel: Model<Pipeline>,
    private readonly webhookService: WebhookService,
    @Optional()
    private readonly employeeDispatchService?: EmployeeDispatchService,
    @Optional()
    private readonly notificationService?: NotificationService,
    @Optional()
    private readonly distributionQueueService?: DistributionQueueService,
  ) {}

  async createRule(orgId: string, data: DistributionRulePayload) {
    const normalizedOrgId = this.toObjectId(orgId, 'orgId')
    const payload = this.buildRulePayload(data)

    const created = await this.distributionRuleModel.create({
      ...payload,
      orgId: normalizedOrgId,
    })

    return this.toRuleResponse(created.toObject())
  }

  async listRules(orgId: string) {
    const rules = await this.distributionRuleModel.find({
      orgId: this.toObjectId(orgId, 'orgId'),
    })
      .sort({ priority: -1, createdAt: 1 })
      .lean()
      .exec()

    return rules.map(rule => this.toRuleResponse(rule))
  }

  async updateRule(orgId: string, id: string, data: Partial<DistributionRulePayload>) {
    const payload = this.buildRulePayload(data, true)
    const updated = await this.distributionRuleModel.findOneAndUpdate(this.buildRuleQuery(orgId, id), payload, {
      new: true,
    }).lean().exec()

    if (!updated) {
      throw new NotFoundException('Distribution rule not found')
    }

    return this.toRuleResponse(updated)
  }

  async deleteRule(orgId: string, id: string) {
    const deleted = await this.distributionRuleModel.findOneAndDelete(this.buildRuleQuery(orgId, id)).lean().exec()
    if (!deleted) {
      throw new NotFoundException('Distribution rule not found')
    }

    return {
      id,
      deleted: true,
    }
  }

  async evaluateRules(orgId: string, content: Record<string, unknown>): Promise<RuleEvaluationResult> {
    const rules = await this.distributionRuleModel.find({
      orgId: this.toObjectId(orgId, 'orgId'),
      isActive: true,
    })
      .sort({ priority: -1, createdAt: 1 })
      .lean()
      .exec()

    for (const rule of rules) {
      for (const entry of rule.rules || []) {
        if (this.matchesCondition(content, entry.condition || null)) {
          return {
            matched: true,
            rule: this.toRuleResponse(rule),
            selected: {
              action: entry.action,
              target: entry.target,
            },
          }
        }
      }
    }

    return {
      matched: false,
      rule: null,
      selected: null,
    }
  }

  async distribute(orgId: string, contentId: string, targets: DistributionTargetInput[]) {
    const task = await this.getTaskOrFail(orgId, contentId)
    const normalizedOrgId = this.toObjectId(orgId, 'orgId')

    if (!task.orgId || task.orgId.toString() !== normalizedOrgId.toString()) {
      throw new BadRequestException('Content does not belong to the organization')
    }

    if (!isDistributableVideoTaskStatus(task.status)) {
      throw new BadRequestException('Only completed or approved content can be distributed')
    }

    this.assertDedupPassed(task)

    const normalizedTargets = this.normalizeTargets(targets)
    const timestamp = new Date().toISOString()
    const pushRecords: DistributionTargetRecord[] = normalizedTargets.map(target => ({
      action: target.action,
      target: target.target,
      status: DistributionPublishStatus.PUSHED,
      pushedAt: timestamp,
    }))

    const updated = await this.videoTaskModel.findByIdAndUpdate(
      task._id,
      {
        $set: {
          'metadata.distribution.targets': pushRecords,
          'metadata.distribution.lifecycleStatus': DistributionLifecycleStatus.PUSHED,
          'metadata.distribution.publishStatus': DistributionPublishStatus.PUSHED,
          'metadata.distribution.lastStatusAt': timestamp,
          'metadata.distribution.lastDistributedAt': timestamp,
          'metadata.distribution.pushedAt': timestamp,
        },
        $push: {
          'metadata.distribution.history': {
            $each: [
              this.createDistributionHistory(
                DistributionLifecycleStatus.PUSHED,
                timestamp,
                { targets: pushRecords },
              ),
            ],
          },
        },
      },
      { new: true },
    ).lean().exec()

    if (!updated) {
      throw new NotFoundException('Content not found')
    }

    await this.webhookService.trigger('distribution.pushed', {
      orgId,
      contentId,
      targets: pushRecords,
      distributedAt: timestamp,
    })

    return this.toDistributionResponse(updated)
  }

  async trackPublishStatus(
    orgIdOrContentId: string,
    contentIdOrStatus: string | DistributionPublishStatus,
    maybeStatus?: DistributionPublishStatus,
  ) {
    const orgId = maybeStatus ? orgIdOrContentId : undefined
    const contentId = maybeStatus ? contentIdOrStatus as string : orgIdOrContentId
    const status = maybeStatus || contentIdOrStatus as DistributionPublishStatus
    const task = await this.getTaskOrFail(orgId, contentId)
    const currentStatus = this.resolvePublishStatus(task)

    if (currentStatus === status) {
      return this.toDistributionResponse(task.toObject?.() || (task as Record<string, any>))
    }

    if (!this.canTransition(currentStatus, status)) {
      throw new BadRequestException(
        `Invalid publish status transition: ${currentStatus} -> ${status}`,
      )
    }

    const timestamp = new Date().toISOString()
    const setPayload: Record<string, unknown> = {
      'metadata.distribution.lifecycleStatus': status === DistributionPublishStatus.PUBLISHED
        ? DistributionLifecycleStatus.PUBLISHED
        : status === DistributionPublishStatus.EXPIRED
          ? DistributionLifecycleStatus.EXPIRED
          : DistributionLifecycleStatus.PUSHED,
      'metadata.distribution.publishStatus': status,
      'metadata.distribution.lastStatusAt': timestamp,
    }

    if (status === DistributionPublishStatus.PUBLISHED) {
      setPayload['status'] = VideoTaskStatus.PUBLISHED
      setPayload['publishedAt'] = new Date(timestamp)
      setPayload['metadata.publishedAt'] = timestamp
    }

    if (status === DistributionPublishStatus.EXPIRED) {
      setPayload['metadata.distribution.expiredAt'] = timestamp
    }

    const updated = await this.videoTaskModel.findByIdAndUpdate(
      task._id,
      {
        $set: setPayload,
        $push: {
          'metadata.distribution.history': {
            $each: [this.createDistributionHistory(this.resolveLifecycleStatusFromPublishStatus(status), timestamp)],
          },
        },
      },
      { new: true },
    ).lean().exec()

    if (!updated) {
      throw new NotFoundException('Content not found')
    }

    return this.toDistributionResponse(updated)
  }

  async collectFeedback(
    orgId: string,
    contentId: string,
    employeeId: string,
    feedback: Record<string, unknown> | string,
  ) {
    if (!employeeId.trim()) {
      throw new BadRequestException('employeeId is required')
    }

    const task = await this.getTaskOrFail(orgId, contentId)
    const timestamp = new Date().toISOString()
    const feedbackRecord = {
      employeeId,
      feedback,
      createdAt: timestamp,
    }

    const updated = await this.videoTaskModel.findByIdAndUpdate(
      task._id,
      {
        $push: {
          'metadata.distribution.feedback': feedbackRecord,
          'metadata.distribution.history': {
            status: this.resolveLifecycleStatus(task),
            timestamp,
            details: {
              feedback: feedbackRecord,
            },
          },
        },
      },
      { new: true },
    ).lean().exec()

    if (!updated) {
      throw new NotFoundException('Content not found')
    }

    return this.toDistributionResponse(updated)
  }

  async dispatchByPipelineRules(
    orgId: string,
    pipelineId: string,
    videoTaskIds: string[],
    overrideRules: Record<string, unknown> = {},
  ) {
    if (!this.employeeDispatchService) {
      return {
        total: videoTaskIds.length,
        dispatched: 0,
        failed: videoTaskIds.length,
        strategy: 'round-robin',
        results: videoTaskIds.map(videoTaskId => ({
          videoTaskId,
          dispatched: false,
          reason: 'employee_dispatch_not_configured',
        })),
      }
    }

    const normalizedTaskIds = Array.from(new Set(videoTaskIds.map(id => id.trim()).filter(Boolean)))
    if (normalizedTaskIds.length === 0) {
      throw new BadRequestException('videoTaskIds is required')
    }

    await this.assertTaskListDedupPassed(orgId, normalizedTaskIds)

    if (!Types.ObjectId.isValid(pipelineId)) {
      throw new BadRequestException('pipelineId is invalid')
    }

    const pipeline = await this.pipelineModel.findOne({
      _id: new Types.ObjectId(pipelineId),
      orgId: this.toObjectId(orgId, 'orgId'),
    }).lean().exec() as Record<string, any> | null
    if (!pipeline) {
      throw new NotFoundException('Pipeline not found')
    }

    const distributionRules = this.asRecord(pipeline['distributionRules']) || {}
    return this.employeeDispatchService.batchDispatch(
      orgId,
      normalizedTaskIds,
      this.mergeDispatchRules(
        {
          pipelineId,
          assignmentIds: Array.isArray(distributionRules['assignmentIds']) ? distributionRules['assignmentIds'] as string[] : [],
          preferredPlatforms: Array.isArray(distributionRules['preferredPlatforms']) ? distributionRules['preferredPlatforms'] as string[] : [],
          preferredCategories: Array.isArray(distributionRules['preferredCategories']) ? distributionRules['preferredCategories'] as string[] : [],
          templateIds: Array.isArray(distributionRules['templateIds']) ? distributionRules['templateIds'] as string[] : [],
          accountTypes: Array.isArray(distributionRules['accountTypes']) ? distributionRules['accountTypes'] as string[] : [],
          platformAccountIds: Array.isArray(distributionRules['platformAccountIds']) ? distributionRules['platformAccountIds'] as string[] : [],
          strategy: typeof distributionRules['strategy'] === 'string' ? distributionRules['strategy'] : undefined,
        },
        overrideRules,
      ),
    )
  }

  async assignByRule(orgId: string, contentId: string) {
    const task = await this.getTaskOrFail(orgId, contentId)
    this.assertDedupPassed(task)
    const taskId = task._id.toString()
    const ruleResult = await this.evaluateRules(
      orgId,
      this.buildRuleEvaluationContent(task.toObject?.() || (task as Record<string, any>)),
    ) as RuleEvaluationResult
    const ruleDispatchRules = ruleResult.matched && ruleResult.selected
      ? this.buildDispatchRulesFromSelection(ruleResult.selected, ruleResult.rule?.type || null)
      : {}

    let dispatchResult: Record<string, any>
    if (!this.employeeDispatchService) {
      dispatchResult = {
        total: 1,
        dispatched: 0,
        failed: 1,
        strategy: 'round-robin',
        results: [
          {
            videoTaskId: taskId,
            dispatched: false,
            reason: 'employee_dispatch_not_configured',
          },
        ],
      }
    }
    else if (task.pipelineId) {
      dispatchResult = await this.dispatchByPipelineRules(
        orgId,
        task.pipelineId.toString(),
        [taskId],
        ruleDispatchRules,
      )
    }
    else {
      dispatchResult = await this.employeeDispatchService.batchDispatch(orgId, [taskId], ruleDispatchRules)
    }

    const refreshed = await this.videoTaskModel.findById(task._id).lean().exec()
    return {
      matchedRule: ruleResult.rule,
      matchedSelection: ruleResult.selected,
      assignment: Array.isArray(dispatchResult['results']) ? dispatchResult['results'][0] || null : dispatchResult,
      batch: dispatchResult,
      ...(refreshed ? this.toDistributionResponse(refreshed) : this.toDistributionResponse(task.toObject?.() || (task as Record<string, any>))),
    }
  }

  async confirmPublish(
    orgId: string,
    contentId: string,
    publishUrl?: string,
    platform?: string,
    publishPostId?: string,
  ) {
    const normalizedPublishUrl = publishUrl?.trim() || ''
    const normalizedPlatform = platform?.trim() || ''
    const normalizedPublishPostId = publishPostId?.trim() || ''

    if (!normalizedPublishUrl && !normalizedPublishPostId) {
      throw new BadRequestException('publishUrl or publishPostId is required')
    }

    const task = await this.getTaskOrFail(orgId, contentId)
    const confirmation = this.employeeDispatchService
      ? await this.employeeDispatchService.confirmPublished(orgId, contentId, {
          publishUrl: normalizedPublishUrl,
          publishPlatform: normalizedPlatform,
          publishPostId: normalizedPublishPostId,
        })
      : {
          confirmed: false,
          reason: 'employee_dispatch_not_configured',
        }

    if (confirmation['confirmed']) {
      const refreshed = await this.videoTaskModel.findById(task._id).lean().exec()
      if (refreshed) {
        await this.emitPublishedSignals(orgId, contentId, normalizedPlatform, normalizedPublishUrl, normalizedPublishPostId)
        return {
          confirmation,
          ...this.toDistributionResponse(refreshed),
        }
      }
    }

    const timestamp = new Date().toISOString()
    const updated = await this.videoTaskModel.findByIdAndUpdate(
      task._id,
      {
        $set: {
          'metadata.publishedAt': timestamp,
          'publishedAt': new Date(timestamp),
          'status': VideoTaskStatus.PUBLISHED,
          'platformPostId': normalizedPublishPostId,
          'platformPostUrl': normalizedPublishUrl,
          'metadata.platformPostId': normalizedPublishPostId,
          'metadata.platformPostUrl': normalizedPublishUrl,
          'metadata.publishInfo': {
            platform: normalizedPlatform,
            publishUrl: normalizedPublishUrl,
            publishPostId: normalizedPublishPostId,
            publishedAt: timestamp,
          },
          'metadata.distribution.lifecycleStatus': DistributionLifecycleStatus.PUBLISHED,
          'metadata.distribution.publishStatus': DistributionPublishStatus.PUBLISHED,
          'metadata.distribution.publishUrl': normalizedPublishUrl,
          'metadata.distribution.platform': normalizedPlatform,
          'metadata.distribution.publishPostId': normalizedPublishPostId,
          'metadata.distribution.lastStatusAt': timestamp,
          'metadata.distribution.publishedAt': timestamp,
        },
        $push: {
          'metadata.distribution.history': {
            $each: [
              this.createDistributionHistory(DistributionLifecycleStatus.PUBLISHED, timestamp, {
                publishUrl: normalizedPublishUrl,
                platform: normalizedPlatform,
                publishPostId: normalizedPublishPostId,
                confirmation,
              }),
            ],
          },
        },
      },
      { new: true },
    ).lean().exec()

    if (!updated) {
      throw new NotFoundException('Content not found')
    }

    await this.emitPublishedSignals(orgId, contentId, normalizedPlatform, normalizedPublishUrl, normalizedPublishPostId)

    return {
      confirmation,
      ...this.toDistributionResponse(updated),
    }
  }

  async getDistributionStatus(orgId: string, input: DistributionStatusQuery = {}) {
    if (input.contentId) {
      const task = await this.getTaskOrFail(orgId, input.contentId)
      return {
        items: [this.toDistributionResponse(task.toObject?.() || (task as Record<string, any>))],
        total: 1,
        page: 1,
        limit: 1,
      }
    }

    const page = Math.max(1, Math.trunc(Number(input.page) || 1))
    const limit = Math.max(1, Math.min(Math.trunc(Number(input.limit) || 20), 100))
    const skip = (page - 1) * limit
    const query = {
      orgId: this.toObjectId(orgId, 'orgId'),
      $or: [
        { 'metadata.distribution': { $exists: true } },
        { status: { $in: [VideoTaskStatus.COMPLETED, VideoTaskStatus.APPROVED, VideoTaskStatus.PUBLISHED] } },
      ],
    }

    const [items, total] = await Promise.all([
      this.videoTaskModel.find(query)
        .sort({ updatedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.videoTaskModel.countDocuments(query),
    ])

    return {
      items: items.map(item => this.toDistributionResponse(item)),
      total,
      page,
      limit,
    }
  }

  async getDashboardStats(orgId: string, input: DistributionDashboardQuery = {}) {
    const days = Math.max(1, Math.min(Math.trunc(Number(input.days) || 30), 365))
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    const normalizedOrgId = this.toObjectId(orgId, 'orgId')
    const statusFilter = input.status && input.status !== 'all'
      ? { 'metadata.distribution.publishStatus': input.status }
      : {}

    const tasks = await this.videoTaskModel.find({
      'orgId': normalizedOrgId,
      'metadata.distribution.lastStatusAt': { $gte: since.toISOString() },
      ...statusFilter,
    }).lean().exec() as Array<Record<string, any>>

    const pushedTasks = tasks.filter((task) => {
      const status = this.resolvePublishStatus(task)
      return status === DistributionPublishStatus.PUSHED
        || status === DistributionPublishStatus.PUBLISHED
        || status === DistributionPublishStatus.EXPIRED
    })
    const publishedTasks = tasks.filter(task => this.resolvePublishStatus(task) === DistributionPublishStatus.PUBLISHED)
    const expiredTasks = tasks.filter(task => this.resolvePublishStatus(task) === DistributionPublishStatus.EXPIRED)
    const conversionRate = pushedTasks.length > 0
      ? Number(((publishedTasks.length / pushedTasks.length) * 100).toFixed(2))
      : 0
    const publishDurations = publishedTasks
      .map((task) => {
        const distribution = this.asRecord(task['metadata']?.['distribution'])
        const pushedAt = this.parseDate(
          distribution?.['pushedAt']
          || distribution?.['lastDistributedAt'],
        )
        const publishedAt = this.parseDate(
          distribution?.['publishedAt']
          || task['publishedAt']
          || task['metadata']?.['publishedAt'],
        )

        if (!pushedAt || !publishedAt || publishedAt.getTime() < pushedAt.getTime()) {
          return null
        }

        return publishedAt.getTime() - pushedAt.getTime()
      })
      .filter((value): value is number => value !== null)
    const avgTimeToPublishMs = publishDurations.length > 0
      ? Math.round(publishDurations.reduce((sum, value) => sum + value, 0) / publishDurations.length)
      : 0

    return {
      orgId,
      windowDays: days,
      totals: {
        tasks: tasks.length,
        pushed: pushedTasks.length,
        published: publishedTasks.length,
        expired: expiredTasks.length,
      },
      pushToPublishConversionRate: conversionRate,
      avgTimeToPublishMs,
      avgTimeToPublishHours: Number((avgTimeToPublishMs / (60 * 60 * 1000)).toFixed(2)),
      recent: tasks.slice(0, 10).map(task => this.toDistributionResponse(task)),
    }
  }

  async handleEmployeeCallback(orgId: string, contentId: string, input: DistributionCallbackInput) {
    const task = await this.getTaskOrFail(orgId, contentId)
    const timestamp = new Date().toISOString()
    const normalizedReason = this.normalizeOptionalString(input.reason)
    const normalizedPlatform = this.normalizeOptionalString(input.platform)
    const normalizedPublishUrl = this.normalizeOptionalString(input.publishUrl)
    const normalizedPublishPostId = this.normalizeOptionalString(input.publishPostId)

    if (input.status === DistributionCallbackStatus.PUBLISHED) {
      return this.confirmPublish(
        orgId,
        contentId,
        normalizedPublishUrl,
        normalizedPlatform,
        normalizedPublishPostId,
      )
    }

    const currentDistribution = this.asRecord(task.metadata?.distribution) || {}
    const currentEmployeeDispatch = this.asRecord(currentDistribution['employeeDispatch'])
    const currentDeliveryRecordId = this.normalizeOptionalString(currentEmployeeDispatch?.['deliveryRecordId'])
    const currentAssignmentId = this.normalizeOptionalString(currentEmployeeDispatch?.['assignmentId'])
    const lifecycleStatus = input.status === DistributionCallbackStatus.PROCESSING
      ? DistributionLifecycleStatus.PROCESSING
      : DistributionLifecycleStatus.READY
    const setPayload: Record<string, unknown> = {
      'metadata.distribution.lifecycleStatus': lifecycleStatus,
      'metadata.distribution.lastStatusAt': timestamp,
      'metadata.distribution.callbackStatus': input.status,
      'metadata.distribution.callbackUpdatedAt': timestamp,
      'metadata.distribution.rejectionReason': input.status === DistributionCallbackStatus.REJECTED
        ? normalizedReason || 'employee_rejected'
        : null,
      'metadata.distribution.readyAt': lifecycleStatus === DistributionLifecycleStatus.READY ? timestamp : null,
      'metadata.distribution.publishStatus': lifecycleStatus === DistributionLifecycleStatus.READY
        ? DistributionPublishStatus.COMPLETED
        : this.resolvePublishStatus(task),
      'metadata.distribution.heartbeatPending': false,
    }

    if (currentAssignmentId) {
      setPayload['metadata.distribution.employeeDispatch.assignmentId'] = currentAssignmentId
    }
    if (currentDeliveryRecordId) {
      setPayload['metadata.distribution.employeeDispatch.deliveryRecordId'] = currentDeliveryRecordId
    }

    const updated = await this.videoTaskModel.findByIdAndUpdate(
      task._id,
      {
        $set: setPayload,
        $push: {
          'metadata.distribution.history': {
            $each: [
              this.createDistributionHistory(input.status, timestamp, {
                reason: normalizedReason || null,
              }),
            ],
          },
        },
      },
      { new: true },
    ).lean().exec() as Record<string, any> | null

    if (!updated) {
      throw new NotFoundException('Content not found')
    }

    let reassignment: Record<string, unknown> | null = null
    if (input.status === DistributionCallbackStatus.REJECTED) {
      if (this.employeeDispatchService && currentDeliveryRecordId) {
        await this.employeeDispatchService.expireDeliveryRecord(orgId, currentDeliveryRecordId, {
          expiredAt: timestamp,
          reason: normalizedReason || 'employee_rejected',
        }).catch((error) => {
          this.logger.warn({
            message: 'Expire delivery record after rejection failed',
            contentId,
            deliveryRecordId: currentDeliveryRecordId,
            error: error instanceof Error ? error.message : String(error),
          })
        })
      }

      reassignment = await this.reassignOrAlert(
        orgId,
        updated,
        normalizedReason || 'employee_rejected',
        'distribution.rejected',
      )
    }

    return {
      reassignment,
      ...this.toDistributionResponse(updated),
      callbackStatus: input.status,
    }
  }

  async notifyTaskComplete(task: VideoTask) {
    const taskId = task._id?.toString() || ''
    if (!taskId) {
      return {
        queued: false,
        reason: 'task_id_missing',
      }
    }

    if (this.distributionQueueService) {
      return this.distributionQueueService.enqueueCompletedTask(taskId)
    }

    return this.processCompletedTask(taskId)
  }

  async processCompletedTask(taskId: string) {
    const task = await this.getTaskOrFail(undefined, taskId)
    if (!isDistributableVideoTaskStatus(task.status)) {
      this.logger.log({
        message: 'Skip distribution for non-distributable task status',
        taskId,
        status: task.status,
      })

      return {
        taskId,
        skipped: true,
        reason: 'task_not_ready_for_distribution',
        status: task.status,
      }
    }

    const orgId = task.orgId?.toString() || null
    const pipelineId = task.pipelineId?.toString() || null
    const existingDistribution = this.asRecord(task.metadata?.distribution)
    const existingEmployeeDispatch = this.asRecord(existingDistribution?.['employeeDispatch'])
    const existingDeliveryRecordId = this.normalizeOptionalString(
      existingEmployeeDispatch?.['deliveryRecordId'],
    )

    if (existingDeliveryRecordId) {
      return {
        taskId,
        skipped: true,
        reason: 'already_dispatched',
        deliveryRecordId: existingDeliveryRecordId,
        publishStatus: this.resolvePublishStatus(task),
      }
    }

    const autoDispatchEnabled = this.hasDedupPassed(task)
    const employeeDispatch = this.employeeDispatchService && orgId && autoDispatchEnabled
      ? await (pipelineId
          ? this.dispatchByPipelineRules(orgId, pipelineId, [taskId])
          : this.employeeDispatchService.batchDispatch(orgId, [taskId], {})).catch((error) => {
          this.logger.warn({
            message: 'Employee dispatch failed after task completion',
            taskId,
            error: error instanceof Error ? error.message : String(error),
          })
          return null
        })
      : null

    const payload = {
      taskId,
      contentId: taskId,
      userId: task.userId,
      orgId,
      brandId: task.brandId?.toString() || null,
      pipelineId,
      status: task.status,
      outputVideoUrl: task.outputVideoUrl,
      completedAt: task.completedAt,
      copy: task.copy,
      quality: task.quality,
      metadata: task.metadata,
      employeeDispatch,
      dedupGate: {
        passed: autoDispatchEnabled,
        status: task.dedup?.status || '',
      },
    }

    if (!autoDispatchEnabled) {
      this.logger.log({
        message: 'Skip auto distribution until dedup passes',
        taskId,
        dedupStatus: task.dedup?.status || 'pending',
      })
    }

    this.logger.log({
      message: 'MediaClaw task completion notification queued',
      taskId,
      userId: task.userId,
      orgId,
      outputVideoUrl: task.outputVideoUrl,
      employeeDispatch,
      target: task.metadata?.['webhookUrl'] || task.metadata?.['imGroupId'] || null,
    })

    await Promise.allSettled([
      orgId && this.notificationService
        ? this.notificationService.send(orgId, NotificationEvent.TASK_COMPLETED, payload)
        : Promise.resolve(null),
      this.webhookService.trigger('task.completed', payload),
    ])

    return {
      taskId,
      notified: true,
      employeeDispatch,
      dedupGate: payload.dedupGate,
    }
  }

  async notifyPaymentSuccess(order: PaymentOrder) {
    this.logger.log({
      message: 'MediaClaw payment success notification queued',
      orderId: order.orderId,
      userId: order.userId,
      orgId: order.orgId?.toString() || null,
      amount: order.amount,
      currency: order.currency,
      status: order.status,
      paymentMethod: order.paymentMethod,
      target: order.callbackData?.['webhookUrl'] || order.callbackData?.['imGroupId'] || null,
    })

    await this.webhookService.trigger('payment.success', {
      orderId: order.orderId,
      userId: order.userId,
      orgId: order.orgId?.toString() || null,
      amount: order.amount,
      currency: order.currency,
      status: order.status,
      paidAt: order.paidAt,
      callbackData: order.callbackData,
    })
  }

  async expireStaleDistributions() {
    const cutoffIso = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
    const staleTasks = await this.videoTaskModel.find({
      'metadata.distribution.publishStatus': DistributionPublishStatus.PUSHED,
      'metadata.distribution.lastDistributedAt': { $lte: cutoffIso },
    }).lean().exec() as Array<Record<string, any>>
    let reassigned = 0
    let alerted = 0

    for (const task of staleTasks) {
      const expiredAt = new Date().toISOString()
      const orgId = task['orgId']?.toString?.() || ''
      const deliveryRecordId = this.normalizeOptionalString(
        task['metadata']?.['distribution']?.['employeeDispatch']?.['deliveryRecordId'],
      )

      await this.videoTaskModel.findByIdAndUpdate(task['_id'], {
        $set: {
          'metadata.distribution.lifecycleStatus': DistributionLifecycleStatus.EXPIRED,
          'metadata.distribution.publishStatus': DistributionPublishStatus.EXPIRED,
          'metadata.distribution.expiredAt': expiredAt,
          'metadata.distribution.lastStatusAt': expiredAt,
          'metadata.distribution.heartbeatPending': false,
        },
        $push: {
          'metadata.distribution.history': {
            $each: [
              this.createDistributionHistory(DistributionLifecycleStatus.EXPIRED, expiredAt, {
                reason: 'publish_not_confirmed_within_48h',
              }),
            ],
          },
        },
      }).exec()

      if (this.employeeDispatchService && orgId && deliveryRecordId) {
        await this.employeeDispatchService.expireDeliveryRecord(orgId, deliveryRecordId, {
          expiredAt,
          reason: 'publish_not_confirmed_within_48h',
        }).catch((error) => {
          this.logger.warn({
            message: 'Expire delivery record failed',
            taskId: task['_id']?.toString?.() || '',
            deliveryRecordId,
            error: error instanceof Error ? error.message : String(error),
          })
        })
      }

      await this.webhookService.trigger('distribution.expired', {
        orgId: orgId || null,
        contentId: task['_id']?.toString?.() || '',
        expiredAt,
        reason: 'publish_not_confirmed_within_48h',
      }).catch((error) => {
        this.logger.warn({
          message: 'Distribution expiry webhook failed',
          taskId: task['_id']?.toString?.() || '',
          error: error instanceof Error ? error.message : String(error),
        })
      })

      const followUp = await this.reassignOrAlert(
        orgId,
        {
          ...task,
          metadata: {
            ...(this.asRecord(task['metadata']) || {}),
            distribution: {
              ...(this.asRecord(task['metadata']?.['distribution']) || {}),
              lifecycleStatus: DistributionLifecycleStatus.EXPIRED,
              publishStatus: DistributionPublishStatus.EXPIRED,
              expiredAt,
            },
          },
        },
        'publish_not_confirmed_within_48h',
        'distribution.expired.alert',
      )

      if (followUp?.['reassigned']) {
        reassigned += 1
      }
      if (followUp?.['alerted']) {
        alerted += 1
      }
    }

    return {
      total: staleTasks.length,
      cutoffAt: cutoffIso,
      reassigned,
      alerted,
    }
  }

  private buildRulePayload(
    data: Partial<DistributionRulePayload>,
    partial = false,
  ) {
    const payload: Record<string, unknown> = {}

    if ('name' in data) {
      const name = data.name?.trim()
      if (!name) {
        throw new BadRequestException('name is required')
      }
      payload['name'] = name
    }

    if ('type' in data) {
      if (!data.type || !Object.values(DistributionRuleType).includes(data.type)) {
        throw new BadRequestException('Invalid distribution rule type')
      }
      payload['type'] = data.type
    }

    if ('rules' in data) {
      payload['rules'] = this.normalizeRuleEntries(data.rules || [])
    }

    if ('isActive' in data && typeof data.isActive === 'boolean') {
      payload['isActive'] = data.isActive
    }

    if ('priority' in data) {
      payload['priority'] = Number(data.priority || 0)
    }

    if (!partial) {
      if (!('name' in payload) || !('type' in payload) || !('rules' in payload)) {
        throw new BadRequestException('name, type and rules are required')
      }
    }

    return payload
  }

  private normalizeRuleEntries(rules: DistributionRuleEntryPayload[]) {
    if (!Array.isArray(rules) || rules.length === 0) {
      throw new BadRequestException('rules is required')
    }

    return rules.map((rule, index) => {
      const action = rule.action?.trim()
      const target = rule.target?.trim()

      if (!action) {
        throw new BadRequestException(`rules[${index}].action is required`)
      }
      if (!target) {
        throw new BadRequestException(`rules[${index}].target is required`)
      }

      return {
        condition: rule.condition || null,
        action,
        target,
      }
    })
  }

  private normalizeTargets(targets: DistributionTargetInput[]) {
    if (!Array.isArray(targets) || targets.length === 0) {
      throw new BadRequestException('targets is required')
    }

    return targets.map((target, index) => {
      const normalizedTarget = target.target?.trim()
      if (!normalizedTarget) {
        throw new BadRequestException(`targets[${index}].target is required`)
      }

      return {
        action: target.action?.trim() || 'push',
        target: normalizedTarget,
      }
    })
  }

  private buildRuleEvaluationContent(task: Record<string, any>) {
    const now = new Date()
    const platform = this.normalizePlatform(
      task['metadata']?.['publishInfo']?.['platform']
      || task['metadata']?.['distribution']?.['platform']
      || task['metadata']?.['platform']
      || task['source']?.['type'],
    )
    const categories = this.normalizeStringList(
      task['metadata']?.['contentTags']
      || task['metadata']?.['tags']
      || task['metadata']?.['keywords']
      || task['metadata']?.['categories']
      || [],
    )

    return {
      contentId: task['_id']?.toString?.() || '',
      pipelineId: task['pipelineId']?.toString?.() || '',
      brandId: task['brandId']?.toString?.() || '',
      platform,
      categories,
      tags: categories,
      dispatch: {
        weekday: now.getUTCDay(),
        hour: now.getUTCHours(),
        slot: this.resolveDispatchSlot(now.getUTCHours()),
      },
      metadata: task['metadata'] || {},
    }
  }

  private buildDispatchRulesFromSelection(
    selection: { action: string, target: string },
    ruleType: DistributionRuleType | null,
  ) {
    const target = this.normalizeOptionalString(selection.target)
    const action = this.normalizeOptionalString(selection.action).toLowerCase()
    const [prefix, rawValue] = target.includes(':')
      ? target.split(/:(.+)/, 2)
      : ['', target]
    const normalizedPrefix = prefix.toLowerCase()
    const normalizedValue = this.normalizeOptionalString(rawValue || target)

    const dispatchRules: Record<string, unknown> = {}
    const shouldUseAssignment = ruleType === DistributionRuleType.BY_EMPLOYEE
      || normalizedPrefix === 'employee'
      || normalizedPrefix === 'assignment'
      || action === 'assign'
    const shouldUsePlatform = ruleType === DistributionRuleType.BY_PLATFORM
      || normalizedPrefix === 'platform'
      || action === 'platform'
    const shouldUseCategory = normalizedPrefix === 'category'
    const shouldUseTemplate = normalizedPrefix === 'template'
    const shouldUseAccountType = normalizedPrefix === 'account-type'
      || normalizedPrefix === 'account_type'
      || normalizedPrefix === 'accounttype'
    const shouldUseAccount = normalizedPrefix === 'account'
      || normalizedPrefix === 'platform-account'
      || normalizedPrefix === 'platform_account'
    const shouldUseStrategy = normalizedPrefix === 'strategy' || action === 'strategy'

    if (shouldUseAssignment && Types.ObjectId.isValid(normalizedValue)) {
      dispatchRules['assignmentIds'] = [normalizedValue]
    }

    if (shouldUsePlatform && normalizedValue) {
      dispatchRules['preferredPlatforms'] = [this.normalizePlatform(normalizedValue)]
    }

    if (shouldUseCategory && normalizedValue) {
      dispatchRules['preferredCategories'] = [normalizedValue.toLowerCase()]
    }

    if (shouldUseTemplate && normalizedValue) {
      dispatchRules['templateIds'] = [normalizedValue]
    }

    if (shouldUseAccountType && normalizedValue) {
      dispatchRules['accountTypes'] = [normalizedValue.toLowerCase()]
    }

    if (shouldUseAccount && Types.ObjectId.isValid(normalizedValue)) {
      dispatchRules['platformAccountIds'] = [normalizedValue]
    }

    if (shouldUseStrategy && normalizedValue) {
      dispatchRules['strategy'] = normalizedValue
    }

    return dispatchRules
  }

  private mergeDispatchRules(
    baseRules: Record<string, unknown> = {},
    overrideRules: Record<string, unknown> = {},
  ) {
    const baseAssignments = this.normalizeStringList(baseRules['assignmentIds'])
    const overrideAssignments = this.normalizeStringList(overrideRules['assignmentIds'])
    const basePlatforms = this.normalizeStringList(baseRules['preferredPlatforms'])
    const overridePlatforms = this.normalizeStringList(overrideRules['preferredPlatforms']).map(platform => this.normalizePlatform(platform))
    const baseCategories = this.normalizeStringList(baseRules['preferredCategories'])
    const overrideCategories = this.normalizeStringList(overrideRules['preferredCategories'])
    const baseTemplateIds = this.normalizeStringList(baseRules['templateIds'])
    const overrideTemplateIds = this.normalizeStringList(overrideRules['templateIds'])
    const baseAccountTypes = this.normalizeStringList(baseRules['accountTypes'])
    const overrideAccountTypes = this.normalizeStringList(overrideRules['accountTypes'])
    const basePlatformAccountIds = this.normalizeStringList(baseRules['platformAccountIds'])
    const overridePlatformAccountIds = this.normalizeStringList(overrideRules['platformAccountIds'])

    return {
      pipelineId: this.normalizeOptionalString(overrideRules['pipelineId'] || baseRules['pipelineId']),
      assignmentIds: Array.from(new Set([...baseAssignments, ...overrideAssignments])),
      preferredPlatforms: Array.from(new Set([...basePlatforms.map(platform => this.normalizePlatform(platform)), ...overridePlatforms])),
      preferredCategories: Array.from(new Set([...baseCategories, ...overrideCategories])),
      templateIds: Array.from(new Set([...baseTemplateIds, ...overrideTemplateIds])),
      accountTypes: Array.from(new Set([...baseAccountTypes, ...overrideAccountTypes])),
      platformAccountIds: Array.from(new Set([...basePlatformAccountIds, ...overridePlatformAccountIds])),
      strategy: this.normalizeOptionalString(overrideRules['strategy'] || baseRules['strategy']) || 'round-robin',
    }
  }

  private matchesCondition(
    content: Record<string, unknown>,
    condition: Record<string, unknown> | null,
  ): boolean {
    if (!condition || Object.keys(condition).length === 0) {
      return true
    }

    const anyRules = condition['any']
    if (Array.isArray(anyRules)) {
      return anyRules.some(rule => this.matchesCondition(content, this.asRecord(rule)))
    }

    const allRules = condition['all']
    if (Array.isArray(allRules)) {
      return allRules.every(rule => this.matchesCondition(content, this.asRecord(rule)))
    }

    const notRule = this.asRecord(condition['not'])
    if (notRule) {
      return !this.matchesCondition(content, notRule)
    }

    const field = typeof condition['field'] === 'string' ? condition['field'] : null
    if (field) {
      return this.compareFieldValue(
        this.getFieldValue(content, field),
        condition['op'],
        condition['value'],
      )
    }

    return Object.entries(condition).every(([key, expected]) => {
      const actual = this.getFieldValue(content, key)
      if (Array.isArray(actual)) {
        return actual.includes(expected)
      }
      return actual === expected
    })
  }

  private compareFieldValue(
    actual: unknown,
    operator: unknown,
    expected: unknown,
  ) {
    const op = typeof operator === 'string' ? operator : 'eq'
    const actualNumber = this.toNumericValue(actual)

    switch (op) {
      case 'eq':
        return actual === expected
      case 'ne':
        return actual !== expected
      case 'in':
        return Array.isArray(expected) ? expected.includes(actual) : false
      case 'contains':
        if (typeof actual === 'string' && typeof expected === 'string') {
          return actual.includes(expected)
        }
        if (Array.isArray(actual)) {
          return actual.includes(expected)
        }
        return false
      case 'gte':
        return actualNumber !== null && this.toNumericValue(expected) !== null
          ? actualNumber >= (this.toNumericValue(expected) as number)
          : false
      case 'lte':
        return actualNumber !== null && this.toNumericValue(expected) !== null
          ? actualNumber <= (this.toNumericValue(expected) as number)
          : false
      case 'between': {
        if (!Array.isArray(expected) || expected.length < 2 || actualNumber === null) {
          return false
        }

        const min = this.toNumericValue(expected[0])
        const max = this.toNumericValue(expected[1])
        return min !== null && max !== null && actualNumber >= min && actualNumber <= max
      }
      case 'exists':
        return Boolean(actual) === Boolean(expected)
      default:
        return actual === expected
    }
  }

  private getFieldValue(source: Record<string, unknown>, path: string) {
    const segments = path.split('.').filter(Boolean)
    let current: unknown = source

    for (const segment of segments) {
      if (!current || typeof current !== 'object' || !(segment in current)) {
        return undefined
      }
      current = (current as Record<string, unknown>)[segment]
    }

    return current
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null
    }

    return value as Record<string, unknown>
  }

  private buildRuleQuery(orgId: string, id: string) {
    return {
      _id: this.toObjectId(id, 'id'),
      orgId: this.toObjectId(orgId, 'orgId'),
    }
  }

  private async getTaskOrFail(orgId: string | undefined, contentId: string) {
    const task = await this.findTask(orgId, contentId)
    if (!task) {
      throw new NotFoundException('Content not found')
    }
    return task
  }

  private async findTask(orgId: string | undefined, contentId: string) {
    const taskIdQuery = this.toDocumentId(contentId)
    const videoTaskModel = this.videoTaskModel as unknown as {
      findOne?: (input: Record<string, any>) => any
      findById?: (input: unknown) => any
    }

    if (orgId && typeof videoTaskModel.findOne === 'function') {
      const query = videoTaskModel.findOne({
        _id: taskIdQuery,
        orgId: this.toObjectId(orgId, 'orgId'),
      })
      return this.resolveQueryResult(query)
    }

    if (typeof videoTaskModel.findById === 'function') {
      const task = await this.resolveQueryResult(videoTaskModel.findById(taskIdQuery))
      if (!orgId || !task) {
        return task
      }

      return task.orgId?.toString?.() === this.toObjectId(orgId, 'orgId').toString()
        ? task
        : null
    }

    if (typeof videoTaskModel.findOne === 'function') {
      return this.resolveQueryResult(videoTaskModel.findOne({ _id: taskIdQuery }))
    }

    return null
  }

  private async assertTaskListDedupPassed(orgId: string, taskIds: string[]) {
    const normalizedIds = taskIds.map(id => this.toDocumentId(id))
    const tasks = await this.videoTaskModel.find({
      _id: { $in: normalizedIds },
      orgId: this.toObjectId(orgId, 'orgId'),
    }).lean().exec() as Array<Record<string, any>>

    if (tasks.length !== normalizedIds.length) {
      throw new NotFoundException('Content not found')
    }

    tasks.forEach(task => this.assertDedupPassed(task))
  }

  private assertDedupPassed(task: VideoTask | Record<string, any>) {
    const outputUrl = this.normalizeOptionalString(
      task.outputVideoUrl
      || task.output?.url
      || task.metadata?.outputVideoUrl,
    )

    if (!outputUrl) {
      return
    }

    if (this.hasDedupPassed(task)) {
      return
    }

    throw new BadRequestException('Content dedup has not passed yet')
  }

  private hasDedupPassed(task: VideoTask | Record<string, any>) {
    return this.normalizeOptionalString(task.dedup?.status) === 'passed'
  }

  private resolvePublishStatus(task: VideoTask | Record<string, any>): DistributionPublishStatus {
    const fromMetadata = task.metadata?.distribution?.publishStatus
    if (isDistributionPublishStatus(fromMetadata)) {
      return fromMetadata
    }

    if (
      fromMetadata === 'pushed'
      || fromMetadata === 'delivered'
      || fromMetadata === 'received'
      || fromMetadata === 'confirmed'
      || fromMetadata === 'downloaded'
    ) {
      return DistributionPublishStatus.PUSHED
    }

    if (fromMetadata === 'expired') {
      return DistributionPublishStatus.EXPIRED
    }

    if (task.status === VideoTaskStatus.PUBLISHED) {
      return DistributionPublishStatus.PUBLISHED
    }

    if (isDistributableVideoTaskStatus(task.status)) {
      return DistributionPublishStatus.COMPLETED
    }

    return DistributionPublishStatus.COMPLETED
  }

  private canTransition(
    currentStatus: DistributionPublishStatus,
    nextStatus: DistributionPublishStatus,
  ) {
    if (currentStatus === nextStatus) {
      return true
    }

    const transitions: Record<DistributionPublishStatus, DistributionPublishStatus[]> = {
      [DistributionPublishStatus.COMPLETED]: [
        DistributionPublishStatus.PUSHED,
        DistributionPublishStatus.PUBLISHED,
        DistributionPublishStatus.EXPIRED,
      ],
      [DistributionPublishStatus.PUSHED]: [
        DistributionPublishStatus.PUBLISHED,
        DistributionPublishStatus.EXPIRED,
      ],
      [DistributionPublishStatus.PUBLISHED]: [],
      [DistributionPublishStatus.EXPIRED]: [],
    }

    return transitions[currentStatus].includes(nextStatus)
  }

  private createDistributionHistory(
    status: string,
    timestamp: string,
    details?: Record<string, unknown>,
  ): DistributionTimelineEntry {
    return {
      status,
      timestamp,
      details,
    }
  }

  private toRuleResponse(rule: {
    _id?: { toString: () => string }
    orgId?: { toString: () => string } | null
    name: string
    type: DistributionRuleType
    rules?: DistributionRuleEntryPayload[]
    isActive?: boolean
    priority?: number
    createdAt?: Date
    updatedAt?: Date
  }) {
    return {
      id: rule._id?.toString(),
      orgId: rule.orgId?.toString() || null,
      name: rule.name,
      type: rule.type,
      rules: (rule.rules || []).map(entry => ({
        condition: entry.condition || null,
        action: entry.action,
        target: entry.target,
      })),
      isActive: rule.isActive ?? true,
      priority: rule.priority ?? 0,
      createdAt: rule.createdAt,
      updatedAt: rule.updatedAt,
    }
  }

  private toDistributionResponse(task: Record<string, any>) {
    const metadata = task['metadata'] as Record<string, any> | undefined
    const distribution = metadata?.['distribution'] as Record<string, any> | undefined
    const publishInfo = metadata?.['publishInfo'] as Record<string, any> | undefined
    const pushedAtValue = distribution?.['pushedAt'] || distribution?.['lastDistributedAt']
    const publishedAtValue = distribution?.['publishedAt'] || publishInfo?.['publishedAt'] || task['publishedAt'] || metadata?.['publishedAt']
    const timeToPublishMs = this.calculateTimeDifferenceMs(pushedAtValue, publishedAtValue)

    return {
      contentId: task['_id']?.toString(),
      orgId: task['orgId']?.toString() || null,
      distributionStatus: this.resolveLifecycleStatus(task),
      publishStatus: this.resolvePublishStatus(task),
      employeeDispatch: distribution?.['employeeDispatch'] || null,
      callbackStatus: distribution?.['callbackStatus'] || null,
      rejectionReason: distribution?.['rejectionReason'] || null,
      publishUrl: distribution?.['publishUrl'] || publishInfo?.['publishUrl'] || task['platformPostUrl'] || metadata?.['platformPostUrl'] || null,
      publishPostId: distribution?.['publishPostId'] || publishInfo?.['publishPostId'] || task['platformPostId'] || metadata?.['platformPostId'] || null,
      platform: distribution?.['platform'] || publishInfo?.['platform'] || metadata?.['publishInfo']?.['platform'] || null,
      targets: distribution?.['targets'] || [],
      feedback: distribution?.['feedback'] || [],
      history: distribution?.['history'] || [],
      heartbeatPending: Boolean(distribution?.['heartbeatPending']),
      manualPickupRequired: Boolean(distribution?.['manualPickupRequired']),
      lastDistributedAt: distribution?.['lastDistributedAt'] || null,
      pushedAt: pushedAtValue || null,
      publishedAt: publishedAtValue || null,
      lastStatusAt: distribution?.['lastStatusAt'] || null,
      expiredAt: distribution?.['expiredAt'] || null,
      timeToPublishMs,
      timeToPublishHours: timeToPublishMs !== null ? Number((timeToPublishMs / (60 * 60 * 1000)).toFixed(2)) : null,
    }
  }

  private resolveLifecycleStatus(task: Record<string, any> | VideoTask): DistributionLifecycleStatus {
    const distribution = task.metadata?.distribution as Record<string, any> | undefined
    const storedStatus = distribution?.['lifecycleStatus']
    if (isDistributionLifecycleStatus(storedStatus)) {
      return storedStatus
    }

    const publishStatus = this.resolvePublishStatus(task)
    if (publishStatus === DistributionPublishStatus.PUBLISHED) {
      return DistributionLifecycleStatus.PUBLISHED
    }
    if (publishStatus === DistributionPublishStatus.EXPIRED) {
      return DistributionLifecycleStatus.EXPIRED
    }
    if (publishStatus === DistributionPublishStatus.PUSHED) {
      return DistributionLifecycleStatus.PUSHED
    }

    const callbackStatus = this.normalizeOptionalString(distribution?.['callbackStatus']).toLowerCase()
    if (callbackStatus === DistributionCallbackStatus.PROCESSING) {
      return DistributionLifecycleStatus.PROCESSING
    }
    if (callbackStatus === DistributionCallbackStatus.READY || callbackStatus === DistributionCallbackStatus.REJECTED) {
      return DistributionLifecycleStatus.READY
    }

    const employeeDispatch = distribution?.['employeeDispatch'] as Record<string, any> | undefined
    const deliveryStatus = this.normalizeOptionalString(
      distribution?.['deliveryStatus'] || employeeDispatch?.['deliveryStatus'],
    ).toLowerCase()
    if (
      deliveryStatus === 'pending'
      || deliveryStatus === 'received'
      || deliveryStatus === 'downloaded'
      || Boolean(distribution?.['manualPickupRequired'])
      || Boolean(distribution?.['heartbeatPending'])
    ) {
      return DistributionLifecycleStatus.PROCESSING
    }

    if (isDistributableVideoTaskStatus(task.status) || distribution) {
      return DistributionLifecycleStatus.READY
    }

    return DistributionLifecycleStatus.CREATED
  }

  private resolveLifecycleStatusFromPublishStatus(status: DistributionPublishStatus) {
    switch (status) {
      case DistributionPublishStatus.PUSHED:
        return DistributionLifecycleStatus.PUSHED
      case DistributionPublishStatus.PUBLISHED:
        return DistributionLifecycleStatus.PUBLISHED
      case DistributionPublishStatus.EXPIRED:
        return DistributionLifecycleStatus.EXPIRED
      default:
        return DistributionLifecycleStatus.READY
    }
  }

  private async emitPublishedSignals(
    orgId: string,
    contentId: string,
    platform: string,
    publishUrl: string,
    publishPostId: string,
  ) {
    await Promise.allSettled([
      this.notificationService
        ? this.notificationService.send(orgId, NotificationEvent.CONTENT_PUBLISHED, {
            contentId,
            platform,
            publishUrl,
            publishPostId,
          })
        : Promise.resolve(null),
      this.webhookService.trigger('distribution.published', {
        orgId,
        contentId,
        platform,
        publishUrl,
        publishPostId,
      }),
    ])
  }

  private async reassignOrAlert(
    orgId: string,
    task: Record<string, any>,
    reason: string,
    eventName: string,
  ) {
    const contentId = task['_id']?.toString?.() || ''
    const pipelineId = task['pipelineId']?.toString?.() || ''

    if (orgId && pipelineId && this.employeeDispatchService) {
      const dispatchResult = await this.dispatchByPipelineRules(orgId, pipelineId, [contentId]).catch((error) => {
        this.logger.warn({
          message: 'Distribution reassignment failed',
          contentId,
          pipelineId,
          reason,
          error: error instanceof Error ? error.message : String(error),
        })
        return null
      })

      const firstResult = Array.isArray(dispatchResult?.['results'])
        ? dispatchResult?.['results']?.[0]
        : null
      if (firstResult?.['dispatched']) {
        return {
          reassigned: true,
          alerted: false,
          assignment: firstResult,
        }
      }
    }

    if (orgId && this.notificationService) {
      await this.notificationService.send(orgId, NotificationEvent.TASK_FAILED, {
        type: 'distribution_follow_up_required',
        contentId,
        reason,
        eventName,
        distributionStatus: this.resolveLifecycleStatus(task),
      }).catch((error) => {
        this.logger.warn({
          message: 'Distribution alert notification failed',
          contentId,
          reason,
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }

    await this.webhookService.trigger(eventName, {
      orgId: orgId || null,
      contentId,
      reason,
      distributionStatus: this.resolveLifecycleStatus(task),
    }).catch((error) => {
      this.logger.warn({
        message: 'Distribution follow-up webhook failed',
        contentId,
        reason,
        error: error instanceof Error ? error.message : String(error),
      })
    })

    return {
      reassigned: false,
      alerted: true,
    }
  }

  private normalizeOptionalString(value: unknown) {
    return typeof value === 'string' ? value.trim() : ''
  }

  private calculateTimeDifferenceMs(start: unknown, end: unknown) {
    const startDate = this.parseDate(start)
    const endDate = this.parseDate(end)
    if (!startDate || !endDate || endDate.getTime() < startDate.getTime()) {
      return null
    }

    return endDate.getTime() - startDate.getTime()
  }

  private parseDate(value: unknown) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value
    }

    if (typeof value !== 'string' || !value.trim()) {
      return null
    }

    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  private normalizeStringList(value: unknown) {
    if (!Array.isArray(value)) {
      return []
    }

    return Array.from(new Set(value
      .map(item => this.normalizeOptionalString(item).toLowerCase())
      .filter(Boolean)))
  }

  private normalizePlatform(value: unknown) {
    const normalized = this.normalizeOptionalString(value).toLowerCase()
    if (normalized === 'xhs' || normalized === 'rednote') {
      return 'xiaohongshu'
    }
    return normalized
  }

  private resolveDispatchSlot(hour: number) {
    if (hour < 6) {
      return 'overnight'
    }
    if (hour < 12) {
      return 'morning'
    }
    if (hour < 18) {
      return 'afternoon'
    }
    return 'evening'
  }

  private toNumericValue(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }
    if (typeof value === 'string' && value.trim()) {
      const asNumber = Number(value)
      if (Number.isFinite(asNumber)) {
        return asNumber
      }

      const parsedDate = Date.parse(value)
      if (!Number.isNaN(parsedDate)) {
        return parsedDate
      }
    }
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.getTime()
    }
    return null
  }

  private toObjectId(value: string, field: string) {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`${field} is invalid`)
    }

    return new Types.ObjectId(value)
  }

  private toDocumentId(value: string) {
    return Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : value
  }

  private async resolveQueryResult<T>(queryOrValue: T) {
    if (!queryOrValue) {
      return queryOrValue
    }

    const maybeQuery = queryOrValue as T & {
      lean?: () => unknown
      exec?: () => Promise<unknown>
    }

    if (typeof maybeQuery.lean === 'function') {
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
