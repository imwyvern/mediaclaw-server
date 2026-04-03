import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import {
  DeliveryChannel,
  DeliveryRecord,
  DeliveryRecordStatus,
  EmployeeAssignment,
  EmployeeAssignmentStatus,
  PlatformAccount,
  VideoTask,
  VideoTaskStatus,
} from '@yikart/mongodb'
import { Model, Types } from 'mongoose'

import { FeishuPushService } from './feishu-push.service'
import { DispatchVideoCard } from './im-push.service'
import { WecomPushService } from './wecom-push.service'

type DispatchStrategy = 'round-robin' | 'category-match' | 'load-balance'

type AssignmentRecord = Record<string, any>
type DeliveryRecordDocument = Record<string, any>
type VideoTaskRecord = Record<string, any>
type PlatformAccountRecord = Record<string, any>

interface AssignmentFilters {
  status?: string
  keyword?: string
}

interface PaginationInput {
  page?: number
  limit?: number
}

interface DispatchRulesInput {
  pipelineId?: string
  assignmentIds?: string[]
  preferredPlatforms?: string[]
  preferredCategories?: string[]
  strategy?: string
}

interface PublishData {
  publishUrl?: string
  publishPlatform?: string
  publishPostId?: string
}

@Injectable()
export class EmployeeDispatchService {
  private readonly logger = new Logger(EmployeeDispatchService.name)

  constructor(
    @InjectModel(EmployeeAssignment.name)
    private readonly employeeAssignmentModel: Model<EmployeeAssignment>,
    @InjectModel(DeliveryRecord.name)
    private readonly deliveryRecordModel: Model<DeliveryRecord>,
    @InjectModel(PlatformAccount.name)
    private readonly platformAccountModel: Model<PlatformAccount>,
    @InjectModel(VideoTask.name)
    private readonly videoTaskModel: Model<VideoTask>,
    private readonly feishuPushService: FeishuPushService,
    private readonly wecomPushService: WecomPushService,
  ) {}

  async createAssignment(orgId: string, data: Record<string, unknown>) {
    const normalizedOrgId = this.normalizeOrgId(orgId)
    const normalized = await this.normalizeAssignmentPayload(normalizedOrgId, data)
    const now = new Date()

    const assignment = await this.employeeAssignmentModel.findOneAndUpdate(
      {
        orgId: normalizedOrgId,
        employeePhone: normalized.employeePhone,
      },
      {
        $set: {
          ...normalized,
          orgId: normalizedOrgId,
          isActive: normalized.status === EmployeeAssignmentStatus.ACTIVE,
          employeeId: normalized.employeeUserId || '',
          platformAccountId: normalized.platformAccountIds[0] || '',
          contentTags: normalized.distributionRules.preferredCategories,
          dailyQuota: normalized.distributionRules.maxDailyVideos,
        },
        $setOnInsert: {
          assignedAt: now,
          lastDispatchedAt: null,
          lastConfirmedAt: null,
          dailyAssignedCount: 0,
          totalConfirmedPublished: 0,
        },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      },
    ).lean().exec()

    return this.toAssignmentResponse(assignment)
  }

  async updateAssignment(id: string, data: Record<string, unknown>) {
    const existing = await this.getAssignmentOrFail(id)
    const normalized = await this.normalizeAssignmentPayload(existing['orgId'], data, existing)

    const updated = await this.employeeAssignmentModel.findByIdAndUpdate(
      existing['_id'],
      {
        $set: {
          ...normalized,
          isActive: normalized.status === EmployeeAssignmentStatus.ACTIVE,
          employeeId: normalized.employeeUserId || '',
          platformAccountId: normalized.platformAccountIds[0] || '',
          contentTags: normalized.distributionRules.preferredCategories,
          dailyQuota: normalized.distributionRules.maxDailyVideos,
        },
      },
      { new: true },
    ).lean().exec()

    return this.toAssignmentResponse(updated)
  }

  async removeAssignment(id: string) {
    const assignment = await this.getAssignmentOrFail(id)
    await this.employeeAssignmentModel.findByIdAndUpdate(assignment['_id'], {
      $set: {
        status: EmployeeAssignmentStatus.REMOVED,
        isActive: false,
      },
    }).exec()

    return {
      id,
      removed: true,
    }
  }

  async listAssignments(orgId: string, filters: AssignmentFilters = {}, pagination: PaginationInput = {}) {
    const normalizedOrgId = this.normalizeOrgId(orgId)
    const page = Math.max(Number(pagination.page || 1), 1)
    const limit = Math.min(Math.max(Number(pagination.limit || 20), 1), 100)
    const skip = (page - 1) * limit
    const query: Record<string, unknown> = { orgId: normalizedOrgId }

    const normalizedStatus = this.normalizeStatus(filters.status)
    if (normalizedStatus) {
      query['status'] = normalizedStatus
    }

    const keyword = this.normalizeOptionalString(filters.keyword)
    if (keyword) {
      query['$or'] = [
        { employeeName: { $regex: keyword, $options: 'i' } },
        { employeePhone: { $regex: keyword, $options: 'i' } },
      ]
    }

    const [items, total] = await Promise.all([
      this.employeeAssignmentModel.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.employeeAssignmentModel.countDocuments(query),
    ])

    return {
      items: items.map(item => this.toAssignmentResponse(item)),
      total,
      page,
      limit,
    }
  }

  async bindImAccount(assignmentId: string, channel: string, binding: Record<string, unknown>) {
    const normalizedChannel = this.normalizeChannel(channel)
    if (normalizedChannel !== DeliveryChannel.FEISHU && normalizedChannel !== DeliveryChannel.WECOM) {
      throw new BadRequestException('channel must be feishu or wecom')
    }

    const assignment = await this.getAssignmentOrFail(assignmentId)
    const normalizedBinding = this.normalizeImBinding(normalizedChannel, binding)

    const updated = await this.employeeAssignmentModel.findByIdAndUpdate(
      assignment['_id'],
      {
        $set: {
          [`imBinding.${normalizedChannel}`]: normalizedBinding,
        },
      },
      { new: true },
    ).lean().exec()

    return this.toAssignmentResponse(updated)
  }

  async dispatchToEmployee(videoTaskId: string, assignmentId: string) {
    const task = await this.getTaskOrFail(videoTaskId)
    const assignment = await this.getAssignmentOrFail(assignmentId)
    const taskOrgId = this.resolveTaskOrgId(task)

    if (assignment['orgId'] !== taskOrgId) {
      throw new BadRequestException('Assignment does not belong to the video task organization')
    }

    return this.dispatchTaskWithAssignment(task, assignment)
  }

  async batchDispatch(videoTaskIds: string[], dispatchRules: DispatchRulesInput = {}) {
    if (!Array.isArray(videoTaskIds) || videoTaskIds.length === 0) {
      throw new BadRequestException('videoTaskIds is required')
    }

    const normalizedTaskIds = Array.from(new Set(videoTaskIds.map(id => id.trim()).filter(Boolean)))
    const tasks = await this.videoTaskModel.find({
      _id: {
        $in: normalizedTaskIds
          .filter(id => Types.ObjectId.isValid(id))
          .map(id => new Types.ObjectId(id)),
      },
    }).lean().exec() as VideoTaskRecord[]

    const taskMap = new Map(tasks.map(task => [task['_id'].toString(), task]))
    const rules = this.normalizeDispatchRules(dispatchRules)
    const results: Array<Record<string, unknown>> = []
    let dispatched = 0
    let failed = 0
    let roundRobinIndex = 0

    for (const videoTaskId of normalizedTaskIds) {
      const task = taskMap.get(videoTaskId)
      if (!task) {
        failed += 1
        results.push({
          videoTaskId,
          dispatched: false,
          reason: 'video_task_not_found',
        })
        continue
      }

      const candidates = await this.resolveEligibleAssignments(task, rules)
      if (candidates.length === 0) {
        failed += 1
        results.push({
          videoTaskId,
          dispatched: false,
          reason: 'no_eligible_assignment',
        })
        continue
      }

      const selected = this.selectAssignment(candidates, task, rules, roundRobinIndex)
      if (!selected) {
        failed += 1
        results.push({
          videoTaskId,
          dispatched: false,
          reason: 'assignment_selection_failed',
        })
        continue
      }

      if (rules.strategy === 'round-robin') {
        roundRobinIndex += 1
      }

      const delivery = await this.dispatchTaskWithAssignment(task, selected)
      if (delivery['dispatched']) {
        dispatched += 1
      }
      else {
        failed += 1
      }
      results.push(delivery)
    }

    return {
      total: normalizedTaskIds.length,
      dispatched,
      failed,
      strategy: rules.strategy,
      results,
    }
  }

  async confirmDelivery(deliveryRecordId: string) {
    const record = await this.getDeliveryRecordOrFail(deliveryRecordId)
    if (record['status'] === DeliveryRecordStatus.CONFIRMED || record['status'] === DeliveryRecordStatus.PUBLISHED) {
      return this.toDeliveryResponse(record)
    }

    const confirmedAt = new Date()
    const updated = await this.deliveryRecordModel.findByIdAndUpdate(
      record['_id'],
      {
        $set: {
          status: DeliveryRecordStatus.CONFIRMED,
          confirmedAt,
        },
      },
      { new: true },
    ).lean().exec()

    await this.appendTaskDistributionHistory(record['videoTaskId'], 'confirmed', {
      deliveryRecordId,
      confirmedAt: confirmedAt.toISOString(),
    })

    return this.toDeliveryResponse(updated)
  }

  async markPublished(deliveryRecordId: string, publishData: PublishData = {}) {
    const record = await this.getDeliveryRecordOrFail(deliveryRecordId)
    if (record['status'] === DeliveryRecordStatus.PUBLISHED) {
      return this.toDeliveryResponse(record)
    }

    const publishedAt = new Date()
    const normalizedPublishUrl = this.normalizeOptionalString(publishData.publishUrl)
    const normalizedPlatform = this.normalizeOptionalString(publishData.publishPlatform)
    const normalizedPostId = this.normalizeOptionalString(publishData.publishPostId)

    const updatedRecord = await this.deliveryRecordModel.findByIdAndUpdate(
      record['_id'],
      {
        $set: {
          status: DeliveryRecordStatus.PUBLISHED,
          publishedAt,
          publishUrl: normalizedPublishUrl,
          publishPlatform: normalizedPlatform,
          publishPostId: normalizedPostId,
        },
      },
      { new: true },
    ).lean().exec()

    await Promise.all([
      this.employeeAssignmentModel.findByIdAndUpdate(record['employeeAssignmentId'], {
        $inc: {
          'stats.totalPublished': 1,
          'stats.totalPending': -1,
          totalConfirmedPublished: 1,
        },
        $set: {
          'stats.lastPublishedAt': publishedAt,
          lastConfirmedAt: publishedAt,
        },
      }).exec(),
      this.videoTaskModel.findByIdAndUpdate(record['videoTaskId'], {
        $set: {
          status: VideoTaskStatus.PUBLISHED,
          publishedAt,
          'metadata.publishedAt': publishedAt.toISOString(),
          'metadata.distribution.publishStatus': DeliveryRecordStatus.PUBLISHED,
          'metadata.distribution.publishUrl': normalizedPublishUrl,
          'metadata.distribution.platform': normalizedPlatform,
          'metadata.distribution.postId': normalizedPostId,
          'metadata.distribution.lastStatusAt': publishedAt.toISOString(),
          'metadata.distribution.employeeDispatch.publishedAt': publishedAt.toISOString(),
        },
        $push: {
          'metadata.distribution.history': {
            status: 'published',
            timestamp: publishedAt.toISOString(),
            details: {
              deliveryRecordId,
              publishUrl: normalizedPublishUrl,
              platform: normalizedPlatform,
              publishPostId: normalizedPostId,
            },
          },
        },
      }).exec(),
    ])

    return this.toDeliveryResponse(updatedRecord)
  }

  async getDispatchStats(orgId: string, period: Record<string, unknown> = {}) {
    const normalizedOrgId = this.normalizeOrgId(orgId)
    const dateFilter = this.buildPeriodFilter(period)
    const deliveryQuery = {
      orgId: normalizedOrgId,
      ...dateFilter,
    }

    const [records, assignmentSummary] = await Promise.all([
      this.deliveryRecordModel.find(deliveryQuery).lean().exec() as Promise<DeliveryRecordDocument[]>,
      this.employeeAssignmentModel.find({ orgId: normalizedOrgId }).lean().exec() as Promise<AssignmentRecord[]>,
    ])

    const byStatus = records.reduce<Record<string, number>>((acc, item) => {
      const key = String(item['status'] || DeliveryRecordStatus.PENDING)
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})

    const byChannel = records.reduce<Record<string, number>>((acc, item) => {
      const key = String(item['deliveryChannel'] || DeliveryChannel.MANUAL)
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})

    return {
      orgId: normalizedOrgId,
      period: period['period'] || null,
      totalDeliveries: records.length,
      byStatus,
      byChannel,
      assignments: {
        total: assignmentSummary.length,
        active: assignmentSummary.filter(item => item['status'] === EmployeeAssignmentStatus.ACTIVE).length,
        inactive: assignmentSummary.filter(item => item['status'] === EmployeeAssignmentStatus.INACTIVE).length,
        removed: assignmentSummary.filter(item => item['status'] === EmployeeAssignmentStatus.REMOVED).length,
      },
      publishedCount: byStatus[DeliveryRecordStatus.PUBLISHED] || 0,
      pendingCount: byStatus[DeliveryRecordStatus.PENDING] || 0,
    }
  }

  async confirmPublished(orgId: string, videoTaskId: string, publishData: PublishData = {}) {
    const normalizedOrgId = this.normalizeOrgId(orgId)
    const record = await this.deliveryRecordModel.findOne({
      orgId: normalizedOrgId,
      videoTaskId: videoTaskId.trim(),
    }).sort({ createdAt: -1 }).lean().exec() as DeliveryRecordDocument | null

    if (!record) {
      return {
        confirmed: false,
        reason: 'delivery_record_not_found',
        videoTaskId,
      }
    }

    const published = await this.markPublished(record['_id'].toString(), publishData)
    return {
      confirmed: true,
      ...published,
    }
  }

  private async dispatchTaskWithAssignment(task: VideoTaskRecord, assignment: AssignmentRecord) {
    const deliveryChannel = this.resolveDeliveryChannel(assignment)
    const created = await this.deliveryRecordModel.create({
      orgId: assignment['orgId'],
      videoTaskId: task['_id'].toString(),
      employeeAssignmentId: assignment['_id'].toString(),
      deliveryChannel,
      status: DeliveryRecordStatus.PENDING,
      retryCount: 0,
    })

    const videoData = this.buildVideoCard(task)
    const deliveredAt = new Date()
    const pushResult = await this.pushVideoCard(deliveryChannel, assignment, videoData)
    const nextStatus = pushResult.success ? DeliveryRecordStatus.DELIVERED : DeliveryRecordStatus.FAILED

    const updated = await this.deliveryRecordModel.findByIdAndUpdate(
      created._id,
      {
        $set: {
          status: nextStatus,
          deliveredAt: pushResult.success ? deliveredAt : null,
          failReason: pushResult.success ? '' : pushResult.errorMessage || 'push_failed',
          deliveryPayload: pushResult.payload,
        },
        $inc: {
          retryCount: pushResult.success ? 0 : 1,
        },
      },
      { new: true },
    ).lean().exec()

    if (pushResult.success) {
      await Promise.all([
        this.employeeAssignmentModel.findByIdAndUpdate(assignment['_id'], {
          $inc: {
            'stats.totalAssigned': 1,
            'stats.totalPending': 1,
            dailyAssignedCount: 1,
          },
          $set: {
            'stats.lastAssignedAt': deliveredAt,
            lastDispatchedAt: deliveredAt,
          },
        }).exec(),
        this.videoTaskModel.findByIdAndUpdate(task['_id'], {
          $set: {
            'metadata.distribution.employeeDispatch': {
              assignmentId: assignment['_id'].toString(),
              employeeName: assignment['employeeName'] || '',
              employeePhone: assignment['employeePhone'] || '',
              deliveryRecordId: created._id.toString(),
              deliveryChannel,
              deliveredAt: deliveredAt.toISOString(),
              publishConfirmed: false,
            },
            'metadata.distribution.publishStatus': DeliveryRecordStatus.DELIVERED,
            'metadata.distribution.lastDistributedAt': deliveredAt.toISOString(),
            'metadata.distribution.lastStatusAt': deliveredAt.toISOString(),
          },
          $push: {
            'metadata.distribution.history': {
              status: 'pushed',
              timestamp: deliveredAt.toISOString(),
              details: {
                deliveryRecordId: created._id.toString(),
                assignmentId: assignment['_id'].toString(),
                deliveryChannel,
              },
            },
          },
        }).exec(),
      ])
    }

    return {
      dispatched: pushResult.success,
      videoTaskId: task['_id'].toString(),
      assignmentId: assignment['_id'].toString(),
      deliveryRecordId: created._id.toString(),
      status: nextStatus,
      reason: pushResult.success ? '' : pushResult.errorMessage || 'push_failed',
      deliveryChannel,
    }
  }

  private async resolveEligibleAssignments(task: VideoTaskRecord, rules: Required<DispatchRulesInput>) {
    const orgId = this.resolveTaskOrgId(task)
    const query: Record<string, unknown> = {
      orgId,
      status: EmployeeAssignmentStatus.ACTIVE,
    }

    if (rules.assignmentIds.length > 0) {
      query['_id'] = {
        $in: rules.assignmentIds
          .filter(id => Types.ObjectId.isValid(id))
          .map(id => new Types.ObjectId(id)),
      }
    }

    const assignments = await this.employeeAssignmentModel.find(query)
      .sort({ createdAt: 1 })
      .lean()
      .exec() as AssignmentRecord[]

    const taskPlatform = this.resolveTaskPlatform(task)
    const taskCategories = this.resolveTaskCategories(task)
    const requestedPlatforms = new Set(rules.preferredPlatforms)
    const requestedCategories = new Set(rules.preferredCategories)
    const platformLookup = await this.buildAssignmentPlatformLookup(assignments)

    return assignments.filter((assignment) => {
      if (!this.isWithinDailyLimit(assignment)) {
        return false
      }

      if (requestedPlatforms.size > 0 && taskPlatform && !requestedPlatforms.has(taskPlatform)) {
        return false
      }

      const assignmentPlatforms = new Set([
        ...this.normalizeStringList(assignment['distributionRules']?.['preferredPlatforms']),
        ...platformLookup.get(assignment['_id'].toString()) || [],
      ])
      if (taskPlatform && assignmentPlatforms.size > 0 && !assignmentPlatforms.has(taskPlatform)) {
        return false
      }

      const categoryFilters = new Set([
        ...this.normalizeStringList(assignment['distributionRules']?.['preferredCategories']),
        ...requestedCategories,
      ])
      if (categoryFilters.size === 0 || taskCategories.length === 0) {
        return true
      }

      return taskCategories.some(category => categoryFilters.has(category))
    })
  }

  private selectAssignment(
    assignments: AssignmentRecord[],
    task: VideoTaskRecord,
    rules: Required<DispatchRulesInput>,
    roundRobinIndex: number,
  ) {
    if (assignments.length === 0) {
      return null
    }

    const strategy = rules.strategy as DispatchStrategy
    if (strategy === 'load-balance') {
      return [...assignments].sort((left, right) => {
        const pendingDelta = Number(left['stats']?.['totalPending'] || 0) - Number(right['stats']?.['totalPending'] || 0)
        if (pendingDelta !== 0) {
          return pendingDelta
        }

        const assignedDelta = Number(left['stats']?.['totalAssigned'] || 0) - Number(right['stats']?.['totalAssigned'] || 0)
        if (assignedDelta !== 0) {
          return assignedDelta
        }

        return this.toTimestamp(left['stats']?.['lastAssignedAt']) - this.toTimestamp(right['stats']?.['lastAssignedAt'])
      })[0]
    }

    if (strategy === 'category-match') {
      const taskCategories = this.resolveTaskCategories(task)
      const matched = assignments.filter((assignment) => {
        const preferredCategories = this.normalizeStringList(assignment['distributionRules']?.['preferredCategories'])
        if (preferredCategories.length === 0 || taskCategories.length === 0) {
          return false
        }

        return preferredCategories.some(category => taskCategories.includes(category))
      })
      return matched[0] || assignments[0]
    }

    return assignments[roundRobinIndex % assignments.length]
  }

  private async pushVideoCard(
    channel: DeliveryChannel,
    assignment: AssignmentRecord,
    videoData: DispatchVideoCard,
  ) {
    if (channel === DeliveryChannel.FEISHU) {
      const binding = assignment['imBinding']?.['feishu'] || {}
      if (!binding['openId']) {
        return {
          success: false,
          payload: {},
          errorMessage: 'feishu_binding_missing',
        }
      }
      return this.feishuPushService.pushVideoCard(binding, videoData)
    }

    if (channel === DeliveryChannel.WECOM) {
      const binding = assignment['imBinding']?.['wecom'] || {}
      if (!binding['userId']) {
        return {
          success: false,
          payload: {},
          errorMessage: 'wecom_binding_missing',
        }
      }
      return this.wecomPushService.pushVideoCard(binding, videoData)
    }

    return {
      success: true,
      payload: {
        channel: DeliveryChannel.MANUAL,
        stub: true,
        videoData,
      },
    }
  }

  private resolveDeliveryChannel(assignment: AssignmentRecord) {
    if (assignment['imBinding']?.['feishu']?.['openId']) {
      return DeliveryChannel.FEISHU
    }
    if (assignment['imBinding']?.['wecom']?.['userId']) {
      return DeliveryChannel.WECOM
    }
    return DeliveryChannel.MANUAL
  }

  private async buildAssignmentPlatformLookup(assignments: AssignmentRecord[]) {
    const accountIds = Array.from(new Set(assignments.flatMap((assignment) => {
      const ids = Array.isArray(assignment['platformAccountIds']) ? assignment['platformAccountIds'] : []
      return ids.filter((id: string) => Types.ObjectId.isValid(id)).map((id: string) => new Types.ObjectId(id))
    })))

    if (accountIds.length === 0) {
      return new Map<string, string[]>()
    }

    const accounts = await this.platformAccountModel.find({ _id: { $in: accountIds } }).lean().exec() as PlatformAccountRecord[]
    const accountPlatformMap = new Map(accounts.map(account => [account['_id'].toString(), String(account['platform'] || '').toLowerCase()]))
    const assignmentPlatforms = new Map<string, string[]>()

    for (const assignment of assignments) {
      const platforms = this.normalizeStringList((assignment['platformAccountIds'] || []).map((id: string) => accountPlatformMap.get(id) || ''))
      assignmentPlatforms.set(assignment['_id'].toString(), platforms)
    }

    return assignmentPlatforms
  }

  private async normalizeAssignmentPayload(orgId: string, data: Record<string, unknown>, existing?: AssignmentRecord) {
    const employeeName = this.normalizeRequiredString(data['employeeName'], 'employeeName', existing?.['employeeName'])
    const employeePhone = this.normalizeRequiredString(data['employeePhone'], 'employeePhone', existing?.['employeePhone'])
    const employeeUserId = this.normalizeOptionalString(data['employeeUserId'] ?? existing?.['employeeUserId'])
    const platformAccountIds = await this.normalizePlatformAccountIds(orgId, data['platformAccountIds'] ?? existing?.['platformAccountIds'] ?? [])
    const status = this.normalizeStatus(data['status'], existing?.['status']) || EmployeeAssignmentStatus.ACTIVE
    const distributionRules = this.normalizeDistributionRules(data['distributionRules'] ?? existing?.['distributionRules'])
    const imBinding = this.normalizeImBindingPayload(data['imBinding'] ?? existing?.['imBinding'])
    const platforms = await this.resolvePlatformsForAccounts(platformAccountIds)
    const previousStats = existing?.['stats'] || {}

    return {
      employeeName,
      employeePhone,
      employeeUserId,
      platformAccountIds,
      imBinding,
      status,
      distributionRules,
      stats: {
        totalAssigned: Number(previousStats['totalAssigned'] || 0),
        totalPublished: Number(previousStats['totalPublished'] || 0),
        totalPending: Number(previousStats['totalPending'] || 0),
        lastAssignedAt: previousStats['lastAssignedAt'] || null,
        lastPublishedAt: previousStats['lastPublishedAt'] || null,
      },
      platforms,
    }
  }

  private normalizeDistributionRules(value: unknown) {
    const source = this.asRecord(value)
    return {
      maxDailyVideos: this.toPositiveInt(source?.['maxDailyVideos']),
      preferredPlatforms: this.normalizeStringList(source?.['preferredPlatforms']),
      preferredCategories: this.normalizeStringList(source?.['preferredCategories']),
    }
  }

  private normalizeDispatchRules(value: DispatchRulesInput): Required<DispatchRulesInput> {
    return {
      pipelineId: this.normalizeOptionalString(value.pipelineId),
      assignmentIds: this.normalizeStringList(value.assignmentIds),
      preferredPlatforms: this.normalizeStringList(value.preferredPlatforms),
      preferredCategories: this.normalizeStringList(value.preferredCategories),
      strategy: this.normalizeStrategy(value.strategy),
    }
  }

  private normalizeImBindingPayload(value: unknown) {
    const source = this.asRecord(value)
    return {
      feishu: source?.['feishu'] ? this.normalizeImBinding(DeliveryChannel.FEISHU, source['feishu']) : undefined,
      wecom: source?.['wecom'] ? this.normalizeImBinding(DeliveryChannel.WECOM, source['wecom']) : undefined,
    }
  }

  private normalizeImBinding(channel: DeliveryChannel, value: unknown) {
    const source = this.asRecord(value)
    if (!source) {
      throw new BadRequestException('binding is required')
    }

    if (channel === DeliveryChannel.FEISHU) {
      const openId = this.normalizeRequiredString(source['openId'], 'binding.openId')
      return {
        openId,
        chatId: this.normalizeOptionalString(source['chatId']),
      }
    }

    const userId = this.normalizeRequiredString(source['userId'], 'binding.userId')
    return {
      userId,
      chatId: this.normalizeOptionalString(source['chatId']),
    }
  }

  private async normalizePlatformAccountIds(orgId: string, value: unknown) {
    const accountIds = this.normalizeStringList(value)
    if (accountIds.length === 0) {
      return []
    }

    const orgObjectId = this.toObjectIdIfValid(orgId)
    if (!orgObjectId) {
      return accountIds
    }

    const objectIds = accountIds
      .filter(id => Types.ObjectId.isValid(id))
      .map(id => new Types.ObjectId(id))

    const accounts = await this.platformAccountModel.find({
      _id: { $in: objectIds },
      orgId: orgObjectId,
    }).lean().exec() as PlatformAccountRecord[]

    return Array.from(new Set(accounts.map(account => account['_id'].toString())))
  }

  private async resolvePlatformsForAccounts(platformAccountIds: string[]) {
    const objectIds = platformAccountIds
      .filter(id => Types.ObjectId.isValid(id))
      .map(id => new Types.ObjectId(id))

    if (objectIds.length === 0) {
      return []
    }

    const accounts = await this.platformAccountModel.find({ _id: { $in: objectIds } }).lean().exec() as PlatformAccountRecord[]
    return this.normalizeStringList(accounts.map(account => String(account['platform'] || '')))
  }

  private isWithinDailyLimit(assignment: AssignmentRecord) {
    const dailyLimit = Number(assignment['distributionRules']?.['maxDailyVideos'] || assignment['dailyQuota'] || 0)
    if (dailyLimit <= 0) {
      return true
    }

    const lastAssignedAt = assignment['stats']?.['lastAssignedAt'] || assignment['lastDispatchedAt']
    const currentCount = this.isSameUtcDay(lastAssignedAt, new Date())
      ? Number(assignment['dailyAssignedCount'] || 0)
      : 0

    return currentCount < dailyLimit
  }

  private buildVideoCard(task: VideoTaskRecord): DispatchVideoCard {
    return {
      videoTaskId: task['_id'].toString(),
      title: this.normalizeOptionalString(task['copy']?.['title']) || this.normalizeOptionalString(task['outputVideoUrl']) || task['_id'].toString(),
      description: this.normalizeOptionalString(task['copy']?.['description']),
      outputVideoUrl: this.normalizeOptionalString(task['output']?.['url']) || this.normalizeOptionalString(task['outputVideoUrl']),
      publishPlatforms: this.resolveTaskPlatform(task) ? [this.resolveTaskPlatform(task)] : [],
      tags: this.resolveTaskCategories(task),
    }
  }

  private resolveTaskPlatform(task: VideoTaskRecord) {
    const candidates = [
      task['metadata']?.['publishInfo']?.['platform'],
      task['metadata']?.['distribution']?.['platform'],
      task['metadata']?.['platform'],
      task['metadata']?.['sourcePlatform'],
      task['source']?.['type'],
    ]

    for (const candidate of candidates) {
      const normalized = this.normalizeOptionalString(candidate).toLowerCase()
      if (!normalized) {
        continue
      }
      if (normalized === 'xhs' || normalized === 'rednote') {
        return 'xiaohongshu'
      }
      return normalized
    }

    return ''
  }

  private resolveTaskCategories(task: VideoTaskRecord) {
    return this.normalizeStringList(
      task['metadata']?.['contentTags']
        || task['metadata']?.['tags']
        || task['metadata']?.['keywords']
        || task['metadata']?.['categories']
        || [],
    )
  }

  private resolveTaskOrgId(task: VideoTaskRecord) {
    const orgId = task['orgId']?.toString?.() || this.normalizeOptionalString(task['metadata']?.['orgId'])
    if (!orgId) {
      throw new BadRequestException('video task orgId is missing')
    }
    return orgId
  }

  private async appendTaskDistributionHistory(videoTaskId: string, status: string, details: Record<string, unknown>) {
    const timestamp = new Date().toISOString()
    await this.videoTaskModel.findByIdAndUpdate(videoTaskId, {
      $set: {
        'metadata.distribution.lastStatusAt': timestamp,
      },
      $push: {
        'metadata.distribution.history': {
          status,
          timestamp,
          details,
        },
      },
    }).exec()
  }

  private buildPeriodFilter(period: Record<string, unknown>) {
    const startAt = this.parseDate(period['startAt'])
    const endAt = this.parseDate(period['endAt'])
    if (startAt || endAt) {
      return {
        createdAt: {
          ...(startAt ? { $gte: startAt } : {}),
          ...(endAt ? { $lte: endAt } : {}),
        },
      }
    }

    const keyword = this.normalizeOptionalString(period['period'])
    if (keyword === '7d') {
      return { createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }
    }
    if (keyword === '30d') {
      return { createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } }
    }

    return {}
  }

  private parseDate(value: unknown) {
    if (typeof value !== 'string' || !value.trim()) {
      return null
    }

    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  private normalizeOrgId(orgId: string) {
    const normalized = orgId.trim()
    if (!normalized) {
      throw new BadRequestException('orgId is required')
    }
    return normalized
  }

  private normalizeStrategy(value: unknown): DispatchStrategy {
    if (value === 'category-match' || value === 'load-balance') {
      return value
    }
    return 'round-robin'
  }

  private normalizeStatus(value: unknown, fallback?: unknown) {
    const normalized = this.normalizeOptionalString(value ?? fallback)
    if (!normalized) {
      return null
    }

    switch (normalized) {
      case EmployeeAssignmentStatus.ACTIVE:
        return EmployeeAssignmentStatus.ACTIVE
      case EmployeeAssignmentStatus.INACTIVE:
      case 'paused':
        return EmployeeAssignmentStatus.INACTIVE
      case EmployeeAssignmentStatus.REMOVED:
      case 'disabled':
        return EmployeeAssignmentStatus.REMOVED
      default:
        throw new BadRequestException('Invalid assignment status')
    }
  }

  private normalizeChannel(value: unknown) {
    return this.normalizeOptionalString(value).toLowerCase()
  }

  private normalizeRequiredString(value: unknown, field: string, fallback?: unknown) {
    const normalized = this.normalizeOptionalString(value ?? fallback)
    if (!normalized) {
      throw new BadRequestException(`${field} is required`)
    }
    return normalized
  }

  private normalizeOptionalString(value: unknown) {
    return typeof value === 'string' ? value.trim() : ''
  }

  private normalizeStringList(value: unknown) {
    if (!Array.isArray(value)) {
      return []
    }

    return Array.from(new Set(value
      .map(item => typeof item === 'string' ? item.trim().toLowerCase() : '')
      .filter(Boolean)))
  }

  private toPositiveInt(value: unknown) {
    const normalized = Number(value || 0)
    if (!Number.isFinite(normalized) || normalized <= 0) {
      return 0
    }
    return Math.trunc(normalized)
  }

  private asRecord(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
  }

  private isSameUtcDay(value: unknown, date: Date) {
    if (!value) {
      return false
    }

    const parsed = new Date(value as string | number | Date)
    if (Number.isNaN(parsed.getTime())) {
      return false
    }

    return parsed.getUTCFullYear() === date.getUTCFullYear()
      && parsed.getUTCMonth() === date.getUTCMonth()
      && parsed.getUTCDate() === date.getUTCDate()
  }

  private toTimestamp(value: unknown) {
    if (!value) {
      return 0
    }

    const parsed = new Date(value as string | number | Date)
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime()
  }

  private toObjectIdIfValid(value: string) {
    return Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : null
  }

  private async getAssignmentOrFail(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('assignmentId is invalid')
    }

    const assignment = await this.employeeAssignmentModel.findById(new Types.ObjectId(id)).lean().exec() as AssignmentRecord | null
    if (!assignment) {
      throw new NotFoundException('Employee assignment not found')
    }

    return assignment
  }

  private async getTaskOrFail(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('videoTaskId is invalid')
    }

    const task = await this.videoTaskModel.findById(new Types.ObjectId(id)).lean().exec() as VideoTaskRecord | null
    if (!task) {
      throw new NotFoundException('Video task not found')
    }

    return task
  }

  private async getDeliveryRecordOrFail(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('deliveryRecordId is invalid')
    }

    const record = await this.deliveryRecordModel.findById(new Types.ObjectId(id)).lean().exec() as DeliveryRecordDocument | null
    if (!record) {
      throw new NotFoundException('Delivery record not found')
    }

    return record
  }

  private toAssignmentResponse(assignment: AssignmentRecord | null) {
    if (!assignment) {
      throw new NotFoundException('Employee assignment not found')
    }

    return {
      id: assignment['_id'].toString(),
      orgId: assignment['orgId'],
      employeeName: assignment['employeeName'] || '',
      employeePhone: assignment['employeePhone'] || '',
      employeeUserId: assignment['employeeUserId'] || '',
      platformAccountIds: assignment['platformAccountIds'] || [],
      imBinding: assignment['imBinding'] || {},
      status: assignment['status'] || EmployeeAssignmentStatus.ACTIVE,
      distributionRules: assignment['distributionRules'] || {},
      stats: assignment['stats'] || {
        totalAssigned: 0,
        totalPublished: 0,
        totalPending: 0,
        lastAssignedAt: null,
        lastPublishedAt: null,
      },
      createdAt: assignment['createdAt'] || null,
      updatedAt: assignment['updatedAt'] || null,
    }
  }

  private toDeliveryResponse(record: DeliveryRecordDocument | null) {
    if (!record) {
      throw new NotFoundException('Delivery record not found')
    }

    return {
      id: record['_id'].toString(),
      orgId: record['orgId'],
      videoTaskId: record['videoTaskId'],
      employeeAssignmentId: record['employeeAssignmentId'],
      deliveryChannel: record['deliveryChannel'],
      status: record['status'],
      deliveredAt: record['deliveredAt'] || null,
      confirmedAt: record['confirmedAt'] || null,
      publishedAt: record['publishedAt'] || null,
      publishUrl: record['publishUrl'] || '',
      publishPlatform: record['publishPlatform'] || '',
      publishPostId: record['publishPostId'] || '',
      retryCount: Number(record['retryCount'] || 0),
      failReason: record['failReason'] || '',
      deliveryPayload: record['deliveryPayload'] || null,
      createdAt: record['createdAt'] || null,
      updatedAt: record['updatedAt'] || null,
    }
  }
}
