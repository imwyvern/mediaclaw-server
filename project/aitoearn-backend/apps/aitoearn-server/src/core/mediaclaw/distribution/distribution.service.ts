import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import {
  DistributionRule,
  DistributionRuleType,
  PaymentOrder,
  VideoTask,
  VideoTaskStatus,
} from '@yikart/mongodb'
import { Model, Types } from 'mongoose'
import { isDistributableVideoTaskStatus } from '../video-task-status.utils'
import { WebhookService } from '../webhook/webhook.service'

export enum DistributionPublishStatus {
  COMPLETED = 'completed',
  PUSHED = 'pushed',
  PUBLISHED = 'published',
  EXPIRED = 'expired',
}

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
  status: DistributionPublishStatus
  timestamp: string
  details?: Record<string, unknown>
}

@Injectable()
export class DistributionService {
  private readonly logger = new Logger(DistributionService.name)

  constructor(
    @InjectModel(DistributionRule.name)
    private readonly distributionRuleModel: Model<DistributionRule>,
    @InjectModel(VideoTask.name)
    private readonly videoTaskModel: Model<VideoTask>,
    private readonly webhookService: WebhookService,
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

  async evaluateRules(orgId: string, content: Record<string, unknown>) {
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
          'metadata.distribution.publishStatus': DistributionPublishStatus.PUSHED,
          'metadata.distribution.lastStatusAt': timestamp,
          'metadata.distribution.lastDistributedAt': timestamp,
        },
        $push: {
          'metadata.distribution.history': {
            $each: [
              this.createDistributionHistory(
                DistributionPublishStatus.PUSHED,
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
      return this.toDistributionResponse(task.toObject())
    }

    if (!this.canTransition(currentStatus, status)) {
      throw new BadRequestException(
        `Invalid publish status transition: ${currentStatus} -> ${status}`,
      )
    }

    const timestamp = new Date().toISOString()
    const setPayload: Record<string, unknown> = {
      'metadata.distribution.publishStatus': status,
      'metadata.distribution.lastStatusAt': timestamp,
    }

    if (status === DistributionPublishStatus.PUBLISHED) {
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
            $each: [this.createDistributionHistory(status, timestamp)],
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
            status: this.resolvePublishStatus(task),
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

  async notifyTaskComplete(task: VideoTask) {
    this.logger.log({
      message: 'MediaClaw task completion notification queued',
      taskId: task._id?.toString(),
      userId: task.userId,
      orgId: task.orgId?.toString() || null,
      outputVideoUrl: task.outputVideoUrl,
      channel: 'stub',
      target: task.metadata?.['webhookUrl'] || task.metadata?.['imGroupId'] || null,
    })

    await this.webhookService.trigger('task.completed', {
      taskId: task._id?.toString(),
      userId: task.userId,
      orgId: task.orgId?.toString() || null,
      brandId: task.brandId?.toString() || null,
      pipelineId: task.pipelineId?.toString() || null,
      status: task.status,
      outputVideoUrl: task.outputVideoUrl,
      completedAt: task.completedAt,
      copy: task.copy,
      quality: task.quality,
      metadata: task.metadata,
    })
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
        return typeof actual === 'number' && typeof expected === 'number'
          ? actual >= expected
          : false
      case 'lte':
        return typeof actual === 'number' && typeof expected === 'number'
          ? actual <= expected
          : false
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

  private resolvePublishStatus(task: VideoTask | Record<string, any>): DistributionPublishStatus {
    const fromMetadata = task.metadata?.distribution?.publishStatus
    if (this.isDistributionPublishStatus(fromMetadata)) {
      return fromMetadata
    }

    if (task.status === VideoTaskStatus.PUBLISHED) {
      return DistributionPublishStatus.PUBLISHED
    }

    if (isDistributableVideoTaskStatus(task.status)) {
      return DistributionPublishStatus.COMPLETED
    }

    return DistributionPublishStatus.COMPLETED
  }

  private isDistributionPublishStatus(value: unknown): value is DistributionPublishStatus {
    return typeof value === 'string'
      && Object.values(DistributionPublishStatus).includes(value as DistributionPublishStatus)
  }

  private canTransition(
    currentStatus: DistributionPublishStatus,
    nextStatus: DistributionPublishStatus,
  ) {
    const transitions: Record<DistributionPublishStatus, DistributionPublishStatus | null> = {
      [DistributionPublishStatus.COMPLETED]: DistributionPublishStatus.PUSHED,
      [DistributionPublishStatus.PUSHED]: DistributionPublishStatus.PUBLISHED,
      [DistributionPublishStatus.PUBLISHED]: DistributionPublishStatus.EXPIRED,
      [DistributionPublishStatus.EXPIRED]: null,
    }

    return transitions[currentStatus] === nextStatus
  }

  private createDistributionHistory(
    status: DistributionPublishStatus,
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

    return {
      contentId: task['_id']?.toString(),
      orgId: task['orgId']?.toString() || null,
      publishStatus: this.resolvePublishStatus(task),
      targets: distribution?.['targets'] || [],
      feedback: distribution?.['feedback'] || [],
      history: distribution?.['history'] || [],
      lastDistributedAt: distribution?.['lastDistributedAt'] || null,
      lastStatusAt: distribution?.['lastStatusAt'] || null,
    }
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
