import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import {
  DeliveryChannel,
  DeliveryRecord,
  DeliveryRecordStatus,
  EmployeeAssignment,
  EmployeeAssignmentStatus,
  ImSessionRole,
  PlatformAccount,
  VideoTask,
  VideoTaskStatus,
} from '@yikart/mongodb'
import { Model, Types } from 'mongoose'

import { ClawHostGatewayPushService } from '../clawhost/clawhost-gateway-push.service'
import { DistributionPublishStatus } from '../distribution/distribution.constants'
import { escapeMongoRegex } from '../shared/query.utils'
import { DingtalkPushService } from './dingtalk-push.service'
import { FeishuPushService } from './feishu-push.service'
import { ImChannelRegistryService } from './im-channel-registry.service'
import { ImDeliveryService } from './im-delivery.service'
import {
  DispatchEmployeeTarget,
  DispatchVideoCard,
  ImPushContext,
  ImPushResult,
  WebhookDeliveryRecord,
} from './im-push.service'
import { ImSessionService } from './im-session.service'
import { TelegramPushService } from './telegram-push.service'
import { WecomPushService } from './wecom-push.service'

type DispatchStrategy = 'round-robin' | 'category-match' | 'load-balance'

type AssignmentRecord = Record<string, any>
type DeliveryRecordDocument = Record<string, any>
type VideoTaskRecord = Record<string, any>
type PlatformAccountRecord = Record<string, any>

interface PlatformAccountSummary {
  id: string
  platform: string
  accountId: string
  accountName: string
  avatarUrl: string
}

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
  templateIds?: string[]
  accountTypes?: string[]
  platformAccountIds?: string[]
  platformAccountId?: string
  strategy?: string
}

interface PublishData {
  publishUrl?: string
  publishPlatform?: string
  publishPostId?: string
}

interface ExpireDeliveryOptions {
  expiredAt?: string
  reason?: string
}

@Injectable()
export class EmployeeDispatchService {
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
    private readonly imDeliveryService: ImDeliveryService,
    @Optional()
    private readonly clawHostGatewayPushService?: ClawHostGatewayPushService,
    @Optional()
    private readonly dingtalkPushService?: DingtalkPushService,
    @Optional()
    private readonly telegramPushService?: TelegramPushService,
    @Optional()
    private readonly imChannelRegistryService?: ImChannelRegistryService,
    @Optional()
    private readonly imSessionService?: ImSessionService,
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

  async updateAssignment(orgId: string, id: string, data: Record<string, unknown>) {
    const existing = await this.getAssignmentOrFail(id, orgId)
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

  async removeAssignment(orgId: string, id: string) {
    const assignment = await this.getAssignmentOrFail(id, orgId)
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
      const escapedKeyword = escapeMongoRegex(keyword)
      query['$or'] = [
        { employeeName: { $regex: escapedKeyword, $options: 'i' } },
        { employeePhone: { $regex: escapedKeyword, $options: 'i' } },
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
      items: await this.buildAssignmentResponses(items),
      total,
      page,
      limit,
    }
  }

  async bindImAccount(orgId: string, assignmentId: string, channel: string, binding: Record<string, unknown>) {
    const normalizedChannel = this.normalizeChannel(channel)
    const assignment = await this.getAssignmentOrFail(assignmentId, orgId)
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

  async dispatchToEmployee(orgId: string, videoTaskId: string, assignmentId: string) {
    const task = await this.getTaskOrFail(videoTaskId, orgId)
    const assignment = await this.getAssignmentOrFail(assignmentId, orgId)
    const taskOrgId = this.resolveTaskOrgId(task)

    if (assignment['orgId'] !== taskOrgId) {
      throw new BadRequestException('Assignment does not belong to the video task organization')
    }

    return this.dispatchTaskWithAssignment(task, assignment)
  }

  async batchDispatch(orgId: string, videoTaskIds: string[], dispatchRules: DispatchRulesInput = {}) {
    if (!Array.isArray(videoTaskIds) || videoTaskIds.length === 0) {
      throw new BadRequestException('videoTaskIds is required')
    }

    const normalizedOrgId = this.normalizeOrgId(orgId)
    const normalizedTaskIds = Array.from(new Set(videoTaskIds.map(id => id.trim()).filter(Boolean)))
    const tasks = await this.videoTaskModel.find({
      orgId: normalizedOrgId,
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
    let pending = 0
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
      else if (delivery['status'] === DeliveryRecordStatus.PENDING) {
        pending += 1
      }
      else {
        failed += 1
      }
      results.push(delivery)
    }

    return {
      total: normalizedTaskIds.length,
      dispatched,
      pending,
      failed,
      strategy: rules.strategy,
      results,
    }
  }

  async confirmDelivery(orgId: string, deliveryRecordId: string) {
    const record = await this.getDeliveryRecordOrFail(deliveryRecordId, orgId)
    if (
      record['status'] === DeliveryRecordStatus.RECEIVED
      || record['status'] === DeliveryRecordStatus.PUBLISHED
    ) {
      return this.toDeliveryResponse(record)
    }

    const confirmedAt = new Date()
    const updated = await this.deliveryRecordModel.findByIdAndUpdate(
      record['_id'],
      {
        $set: {
          status: DeliveryRecordStatus.RECEIVED,
          confirmedAt,
          receivedAt: confirmedAt,
        },
      },
      { new: true },
    ).lean().exec()

    await Promise.all([
      this.videoTaskModel.findByIdAndUpdate(record['videoTaskId'], {
        $set: {
          'metadata.distribution.publishStatus': DistributionPublishStatus.PUSHED,
          'metadata.distribution.lastStatusAt': confirmedAt.toISOString(),
          'metadata.distribution.heartbeatPending': false,
          'metadata.distribution.manualPickupRequired': false,
          'metadata.distribution.employeeDispatch.receivedAt': confirmedAt.toISOString(),
          'metadata.distribution.employeeDispatch.deliveryStatus': DeliveryRecordStatus.RECEIVED,
        },
      }).exec(),
      this.appendTaskDistributionHistory(record['videoTaskId'], 'received', {
        deliveryRecordId,
        confirmedAt: confirmedAt.toISOString(),
      }),
      this.imSessionService?.markDeliveryReceived(record['orgId'], record['_id'].toString()),
    ])

    return this.toDeliveryResponse(updated)
  }

  async markPublished(orgId: string, deliveryRecordId: string, publishData: PublishData = {}) {
    const record = await this.getDeliveryRecordOrFail(deliveryRecordId, orgId)
    if (record['status'] === DeliveryRecordStatus.PUBLISHED) {
      return this.toDeliveryResponse(record)
    }

    const publishedAt = new Date()
    const normalizedPublishUrl = this.normalizeOptionalString(publishData.publishUrl)
    const normalizedPlatform = this.normalizeOptionalString(publishData.publishPlatform)
    const normalizedPostId = this.normalizeOptionalString(publishData.publishPostId)

    if (!normalizedPublishUrl && !normalizedPostId) {
      throw new BadRequestException('publishUrl or publishPostId is required')
    }

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
          'totalConfirmedPublished': 1,
        },
        $set: {
          'stats.lastPublishedAt': publishedAt,
          'lastConfirmedAt': publishedAt,
        },
      }).exec(),
      this.videoTaskModel.findByIdAndUpdate(record['videoTaskId'], {
        $set: {
          'status': VideoTaskStatus.PUBLISHED,
          publishedAt,
          'platformPostId': normalizedPostId,
          'platformPostUrl': normalizedPublishUrl,
          'metadata.publishedAt': publishedAt.toISOString(),
          'metadata.platformPostId': normalizedPostId,
          'metadata.platformPostUrl': normalizedPublishUrl,
          'metadata.publishInfo': {
            platform: normalizedPlatform,
            publishUrl: normalizedPublishUrl,
            publishPostId: normalizedPostId,
            publishedAt: publishedAt.toISOString(),
          },
          'metadata.distribution.publishStatus': DistributionPublishStatus.PUBLISHED,
          'metadata.distribution.publishUrl': normalizedPublishUrl,
          'metadata.distribution.platform': normalizedPlatform,
          'metadata.distribution.publishPostId': normalizedPostId,
          'metadata.distribution.lastStatusAt': publishedAt.toISOString(),
          'metadata.distribution.employeeDispatch.publishedAt': publishedAt.toISOString(),
          'metadata.distribution.employeeDispatch.publishConfirmed': true,
          'metadata.distribution.employeeDispatch.deliveryStatus': DeliveryRecordStatus.PUBLISHED,
          'metadata.distribution.heartbeatPending': false,
          'metadata.distribution.manualPickupRequired': false,
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
      this.imSessionService?.markPublished(record['orgId'], record['_id'].toString(), {
        publishUrl: normalizedPublishUrl,
        publishPlatform: normalizedPlatform,
        publishPostId: normalizedPostId,
      }),
    ])

    await this.pushSessionTemplate(
      record['orgId'],
      record,
      {
        kind: 'report-card',
        title: '内容已确认发布',
        summary: normalizedPlatform || '发布回传已完成',
        body: [
          normalizedPublishUrl ? `发布链接：${normalizedPublishUrl}` : '',
          normalizedPostId ? `帖子 ID：${normalizedPostId}` : '',
        ].filter(Boolean),
        metrics: [
          {
            label: '状态',
            value: DeliveryRecordStatus.PUBLISHED,
          },
        ],
      },
    )

    return this.toDeliveryResponse(updatedRecord)
  }

  async listPendingDeliveries(orgId: string, filters: Record<string, unknown> = {}, pagination: PaginationInput = {}) {
    const normalizedOrgId = this.normalizeOrgId(orgId)
    const page = Math.max(Number(pagination.page || 1), 1)
    const limit = Math.min(Math.max(Number(pagination.limit || 20), 1), 100)
    const skip = (page - 1) * limit
    const query: Record<string, unknown> = {
      orgId: normalizedOrgId,
      status: {
        $in: [
          DeliveryRecordStatus.PENDING,
          DeliveryRecordStatus.PUSHED,
          DeliveryRecordStatus.RECEIVED,
          DeliveryRecordStatus.DOWNLOADED,
        ],
      },
    }

    if (typeof filters['assignmentId'] === 'string' && Types.ObjectId.isValid(filters['assignmentId'])) {
      query['employeeAssignmentId'] = filters['assignmentId']
    }
    if (typeof filters['videoTaskId'] === 'string' && Types.ObjectId.isValid(filters['videoTaskId'])) {
      query['videoTaskId'] = filters['videoTaskId']
    }
    if (typeof filters['channel'] === 'string' && filters['channel']) {
      query['deliveryChannel'] = filters['channel']
    }

    const [records, total] = await Promise.all([
      this.deliveryRecordModel.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec() as Promise<DeliveryRecordDocument[]>,
      this.deliveryRecordModel.countDocuments(query),
    ])

    const assignmentIds = Array.from(new Set(records.map(record => record['employeeAssignmentId']).filter(Boolean)))
    const taskIds = Array.from(new Set(records.map(record => record['videoTaskId']).filter(Boolean)))
    const [assignments, tasks] = await Promise.all([
      this.employeeAssignmentModel.find({ _id: { $in: assignmentIds } }).lean().exec() as Promise<AssignmentRecord[]>,
      this.videoTaskModel.find({ _id: { $in: taskIds } }).lean().exec() as Promise<VideoTaskRecord[]>,
    ])

    const assignmentMap = new Map(assignments.map(assignment => [assignment['_id'].toString(), assignment]))
    const taskMap = new Map(tasks.map(task => [task['_id'].toString(), task]))

    return {
      items: records.map((record) => {
        const task = taskMap.get(String(record['videoTaskId']))
        const assignment = assignmentMap.get(String(record['employeeAssignmentId']))
        return {
          ...this.toDeliveryResponse(record),
          heartbeatPending: Boolean(task?.['metadata']?.['distribution']?.['heartbeatPending']),
          assignment: assignment
            ? {
                id: assignment['_id'].toString(),
                employeeName: assignment['employeeName'] || '',
                employeePhone: assignment['employeePhone'] || '',
              }
            : null,
          task: task
            ? {
                id: task['_id'].toString(),
                title: this.normalizeOptionalString(task['copy']?.['title']) || task['_id'].toString(),
                outputVideoUrl: this.normalizeOptionalString(task['outputVideoUrl']),
                publishStatus: task['metadata']?.['distribution']?.['publishStatus'] || DistributionPublishStatus.COMPLETED,
              }
            : null,
        }
      }),
      total,
      page,
      limit,
    }
  }

  async expireDeliveryRecord(orgId: string, deliveryRecordId: string, options: ExpireDeliveryOptions = {}) {
    const record = await this.getDeliveryRecordOrFail(deliveryRecordId, orgId)
    if (
      record['status'] === DeliveryRecordStatus.EXPIRED
      || record['status'] === DeliveryRecordStatus.PUBLISHED
      || record['status'] === DeliveryRecordStatus.FAILED
    ) {
      return this.toDeliveryResponse(record)
    }

    const expiredAt = new Date(options.expiredAt || new Date().toISOString())
    const failReason = this.normalizeOptionalString(options.reason) || 'delivery_expired'

    const updated = await this.deliveryRecordModel.findByIdAndUpdate(
      record['_id'],
      {
        $set: {
          status: DeliveryRecordStatus.EXPIRED,
          expiredAt,
          failReason,
        },
      },
      { new: true },
    ).lean().exec()

    await Promise.all([
      this.employeeAssignmentModel.findByIdAndUpdate(record['employeeAssignmentId'], {
        $inc: {
          'stats.totalPending': -1,
        },
      }).exec(),
      this.videoTaskModel.findByIdAndUpdate(record['videoTaskId'], {
        $set: {
          'metadata.distribution.employeeDispatch.deliveryStatus': DeliveryRecordStatus.EXPIRED,
          'metadata.distribution.employeeDispatch.expiredAt': expiredAt.toISOString(),
          'metadata.distribution.heartbeatPending': false,
        },
      }).exec(),
      this.appendTaskDistributionHistory(record['videoTaskId'], 'expired', {
        deliveryRecordId,
        expiredAt: expiredAt.toISOString(),
        reason: failReason,
      }),
      this.imSessionService?.markExpired(record['orgId'], record['_id'].toString(), failReason),
    ])

    return this.toDeliveryResponse(updated)
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
      pendingCount: (byStatus[DeliveryRecordStatus.PENDING] || 0)
        + (byStatus[DeliveryRecordStatus.PUSHED] || 0)
        + (byStatus[DeliveryRecordStatus.RECEIVED] || 0)
        + (byStatus[DeliveryRecordStatus.DOWNLOADED] || 0),
    }
  }

  async createDispatchSession(
    orgId: string,
    deliveryRecordId: string,
    options: {
      conversationId?: string
      participants?: Array<{
        memberId: string
        displayName?: string
        role?: string
        channelUserId?: string
      }>
    } = {},
  ) {
    if (!this.imSessionService) {
      throw new BadRequestException('im session service is not configured')
    }

    const record = await this.getDeliveryRecordOrFail(deliveryRecordId, orgId)
    const [assignment, task] = await Promise.all([
      this.employeeAssignmentModel.findById(record['employeeAssignmentId']).lean().exec() as Promise<AssignmentRecord | null>,
      this.videoTaskModel.findById(record['videoTaskId']).lean().exec() as Promise<VideoTaskRecord | null>,
    ])

    if (!task) {
      throw new NotFoundException('video task not found')
    }

    const seedParticipant = assignment
      ? {
          memberId: this.normalizeOptionalString(assignment['employeeUserId'])
            || this.normalizeOptionalString(assignment['employeePhone'])
            || assignment['_id'].toString(),
          displayName: this.normalizeOptionalString(assignment['employeeName']),
          role: ImSessionRole.EDITOR,
          channelUserId:
            this.normalizeOptionalString(assignment['imBinding']?.['feishu']?.['openId'])
            || this.normalizeOptionalString(assignment['imBinding']?.['wecom']?.['userId'])
            || this.normalizeOptionalString(assignment['imBinding']?.['telegram']?.['chatId'])
            || this.normalizeOptionalString(assignment['imBinding']?.['dingtalk']?.['chatId']),
        }
      : null

    const session = await this.imSessionService.ensureDispatchSession({
      orgId,
      videoTaskId: record['videoTaskId'],
      deliveryRecordId: record['_id'].toString(),
      employeeAssignmentId: record['employeeAssignmentId'],
      channel: record['deliveryChannel'],
      conversationId: options.conversationId || this.resolveConversationId(assignment || {}),
      title: this.normalizeOptionalString(this.asRecord(task['copy'])?.['title']) || record['videoTaskId'],
      summary: this.normalizeOptionalString(task['outputVideoUrl']) || '待协作发布内容',
      initialMessage: '已创建群协作会话，等待审批与发布确认。',
      participant: seedParticipant,
    })
    if (!session) {
      throw new BadRequestException('failed to create dispatch session')
    }

    if (options.participants && options.participants.length > 0) {
      return this.imSessionService.upsertParticipants(orgId, session.id, options.participants)
    }

    return session
  }

  async confirmSessionPublished(orgId: string, sessionId: string, publishData: PublishData = {}) {
    if (!this.imSessionService) {
      throw new BadRequestException('im session service is not configured')
    }

    const session = await this.imSessionService.getSession(orgId, sessionId)
    if (!session) {
      throw new NotFoundException('dispatch session not found')
    }
    return this.markPublished(orgId, session.deliveryRecordId, publishData)
  }

  async appendSessionMessage(orgId: string, sessionId: string, memberId: string, content: string, role?: string) {
    if (!this.imSessionService) {
      throw new BadRequestException('im session service is not configured')
    }

    return this.imSessionService.appendMessage(orgId, sessionId, {
      memberId,
      content,
      role,
    })
  }

  async startSessionApproval(
    orgId: string,
    sessionId: string,
    memberId: string,
    requiredVotes = 1,
    hoursToExpire = 24,
  ) {
    if (!this.imSessionService) {
      throw new BadRequestException('im session service is not configured')
    }

    const session = await this.imSessionService.startApproval(
      orgId,
      sessionId,
      memberId,
      requiredVotes,
      hoursToExpire,
    )
    if (!session) {
      throw new NotFoundException('dispatch session not found')
    }

    await this.pushSessionTemplateBySessionId(orgId, sessionId, {
      kind: 'approval-card',
      title: session.deliverySnapshot?.title || '内容审批',
      summary: '群内审批已开启',
      body: [
        session.deliverySnapshot?.summary || '',
        `所需票数：${session.approval?.requiredVotes || requiredVotes}`,
        session.approval?.expiresAt ? `截止时间：${session.approval.expiresAt}` : '',
      ].filter(Boolean),
      actions: [
        {
          key: 'approve',
          text: '通过',
          value: 'approve',
        },
        {
          key: 'reject',
          text: '驳回',
          value: 'reject',
        },
      ],
    })

    return session
  }

  async submitSessionVote(
    orgId: string,
    sessionId: string,
    memberId: string,
    decision: string,
    reason?: string,
  ) {
    if (!this.imSessionService) {
      throw new BadRequestException('im session service is not configured')
    }

    const session = await this.imSessionService.submitVote(
      orgId,
      sessionId,
      memberId,
      decision,
      reason,
    )
    if (!session) {
      throw new NotFoundException('dispatch session not found')
    }

    const approvedVotes = Array.isArray(session.approval?.votes)
      ? session.approval.votes.filter((item: Record<string, unknown>) => item['decision'] === 'approve').length
      : 0
    const nextMessage = session.state === 'confirmed'
      ? {
          kind: 'report-card' as const,
          title: '审批通过',
          summary: '群内审批已完成，可确认发布',
          body: [
            reason ? `备注：${reason}` : '',
          ].filter(Boolean),
        }
      : session.state === 'rejected'
        ? {
            kind: 'report-card' as const,
            title: '审批驳回',
            summary: '群内审批未通过',
            body: [
              reason ? `原因：${reason}` : '',
            ].filter(Boolean),
          }
        : {
            kind: 'approval-card' as const,
            title: '审批投票进行中',
            summary: '审批尚未结束',
            body: [
              `当前赞成票：${approvedVotes}/${session.approval?.requiredVotes || 1}`,
              reason ? `本次备注：${reason}` : '',
            ].filter(Boolean),
          }

    await this.pushSessionTemplateBySessionId(orgId, sessionId, nextMessage)
    return session
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

    const published = await this.markPublished(orgId, record['_id'].toString(), publishData)
    return {
      confirmed: true,
      ...published,
    }
  }

  private async dispatchTaskWithAssignment(task: VideoTaskRecord, assignment: AssignmentRecord) {
    const taskOrgId = this.resolveTaskOrgId(task)
    const deliveryChannel = this.resolveDeliveryChannel(assignment)
    const selectedPlatformAccount = this.asRecord(assignment['selectedPlatformAccount'])
    const selectedPlatformAccountId = this.normalizeOptionalString(selectedPlatformAccount?.['id'])
    const selectedPlatformAccountName = this.normalizeOptionalString(selectedPlatformAccount?.['accountName'])
    const selectedPlatform = this.normalizePlatformName(selectedPlatformAccount?.['platform'])
      || this.resolveTaskPlatform(task)
    const taskAccountType = this.resolveTaskAccountType(task) || selectedPlatform
    const created = await this.deliveryRecordModel.create({
      orgId: assignment['orgId'],
      videoTaskId: task['_id'].toString(),
      employeeAssignmentId: assignment['_id'].toString(),
      deliveryChannel,
      status: DeliveryRecordStatus.PENDING,
      retryCount: 0,
    })

    const deliveryRecord = this.toWebhookDeliveryRecord(created, deliveryChannel)
    const videoData = this.buildVideoCard(task)
    const pushResult = await this.pushVideoCard(deliveryChannel, assignment, deliveryRecord, videoData)
    const manualPickupRequired = Boolean(pushResult.manualPickupRequired)
    const processedAt = pushResult.deliveredAt || new Date()
    const nextStatus = manualPickupRequired
      ? DeliveryRecordStatus.PENDING
      : pushResult.success
        ? DeliveryRecordStatus.PUSHED
        : pushResult.status || DeliveryRecordStatus.FAILED
    const reason = manualPickupRequired
      ? 'manual_pickup_required'
      : nextStatus === DeliveryRecordStatus.FAILED
        ? pushResult.errorMessage || 'push_failed'
        : ''
    await this.deliveryRecordModel.findByIdAndUpdate(
      created._id,
      {
        $set: {
          status: nextStatus,
          deliveredAt: nextStatus === DeliveryRecordStatus.PUSHED ? processedAt : null,
          pushedAt: nextStatus === DeliveryRecordStatus.PUSHED ? processedAt : null,
          failReason: nextStatus === DeliveryRecordStatus.FAILED ? reason : '',
          deliveryPayload: pushResult.payload,
          retryCount: Number(pushResult.retryCount || 0),
        },
      },
    ).exec()

    if (pushResult.success || manualPickupRequired) {
      const eventStatus = manualPickupRequired ? 'heartbeat_pending' : 'pushed'
      const publishStatus = manualPickupRequired
        ? DistributionPublishStatus.COMPLETED
        : DistributionPublishStatus.PUSHED
      await Promise.all([
        this.employeeAssignmentModel.findByIdAndUpdate(assignment['_id'], {
          $inc: {
            'stats.totalAssigned': 1,
            'stats.totalPending': 1,
            'dailyAssignedCount': 1,
          },
          $set: {
            'stats.lastAssignedAt': processedAt,
            'lastDispatchedAt': processedAt,
          },
        }).exec(),
        this.videoTaskModel.findByIdAndUpdate(task['_id'], {
          $set: {
            'metadata.distribution.employeeDispatch': {
              assignmentId: assignment['_id'].toString(),
              employeeName: assignment['employeeName'] || '',
              employeePhone: assignment['employeePhone'] || '',
              webhookUrl: this.normalizeOptionalString(assignment['webhookUrl']),
              selectedPlatformAccount: selectedPlatformAccount
                ? {
                    id: selectedPlatformAccountId,
                    platform: selectedPlatform,
                    accountId: this.normalizeOptionalString(selectedPlatformAccount['accountId']),
                    accountName: selectedPlatformAccountName,
                    avatarUrl: this.normalizeOptionalString(selectedPlatformAccount['avatarUrl']),
                  }
                : null,
              platformAccountId: selectedPlatformAccountId,
              platformAccountName: selectedPlatformAccountName,
              platform: selectedPlatform,
              deliveryRecordId: created._id.toString(),
              deliveryChannel,
              assignedAt: processedAt.toISOString(),
              deliveredAt: nextStatus === DeliveryRecordStatus.PUSHED ? processedAt.toISOString() : null,
              pushedAt: nextStatus === DeliveryRecordStatus.PUSHED ? processedAt.toISOString() : null,
              deliveryStatus: nextStatus,
              publishConfirmed: false,
              manualPickupRequired,
              heartbeatPending: manualPickupRequired,
            },
            'metadata.distribution.publishStatus': publishStatus,
            'metadata.distribution.lastDistributedAt': processedAt.toISOString(),
            'metadata.distribution.lastStatusAt': processedAt.toISOString(),
            'metadata.distribution.manualPickupRequired': manualPickupRequired,
            'metadata.distribution.heartbeatPending': manualPickupRequired,
            'metadata.distribution.deliveryStatus': nextStatus,
            'metadata.distribution.platform': selectedPlatform || this.resolveTaskPlatform(task),
            'metadata.distribution.platformAccountId': selectedPlatformAccountId,
            'metadata.distribution.accountType': taskAccountType,
            'metadata.distribution.pushedAt': nextStatus === DeliveryRecordStatus.PUSHED ? processedAt.toISOString() : null,
          },
          $push: {
            'metadata.distribution.history': {
              status: eventStatus,
              timestamp: processedAt.toISOString(),
              details: {
                deliveryRecordId: created._id.toString(),
                assignmentId: assignment['_id'].toString(),
                deliveryChannel,
                manualPickupRequired,
                webhookUrl: this.normalizeOptionalString(assignment['webhookUrl']),
                platform: selectedPlatform,
                platformAccountId: selectedPlatformAccountId,
                platformAccountName: selectedPlatformAccountName,
              },
            },
          },
        }).exec(),
      ])

      await this.clawHostGatewayPushService?.pushRealtimeEvent(taskOrgId, {
        event: 'delivery.pending',
        capability: 'delivery',
        input: {
          deliveryRecordId: created._id.toString(),
          videoTaskId: task['_id'].toString(),
          assignmentId: assignment['_id'].toString(),
          deliveryChannel,
          manualPickupRequired,
          publishStatus,
          platform: selectedPlatform,
          platformAccountId: selectedPlatformAccountId,
          outputVideoUrl: this.normalizeOptionalString(task['outputVideoUrl']),
          title: this.normalizeOptionalString(this.asRecord(task['copy'])?.['title']),
        },
      })

      if (this.imSessionService && this.supportsSessionChannel(deliveryChannel)) {
        await this.imSessionService.ensureDispatchSession({
          orgId: taskOrgId,
          videoTaskId: task['_id'].toString(),
          deliveryRecordId: created._id.toString(),
          employeeAssignmentId: assignment['_id'].toString(),
          channel: deliveryChannel,
          conversationId: this.resolveConversationId(assignment, deliveryChannel),
          title: videoData.title,
          summary: videoData.description || videoData.publishGuide || videoData.outputVideoUrl,
          initialMessage: '已生成群协作分发会话，请在群内完成审批与发布。',
          participant: {
            memberId: this.normalizeOptionalString(assignment['employeeUserId'])
              || this.normalizeOptionalString(assignment['employeePhone'])
              || assignment['_id'].toString(),
            displayName: this.normalizeOptionalString(assignment['employeeName']),
            role: ImSessionRole.EDITOR,
            channelUserId: this.resolveConversationId(assignment, deliveryChannel),
          },
        })
      }
    }
    else {
      await this.videoTaskModel.findByIdAndUpdate(task['_id'], {
        $set: {
          'metadata.distribution.employeeDispatch': {
            assignmentId: assignment['_id'].toString(),
            employeeName: assignment['employeeName'] || '',
            employeePhone: assignment['employeePhone'] || '',
            webhookUrl: this.normalizeOptionalString(assignment['webhookUrl']),
            selectedPlatformAccount: selectedPlatformAccount
              ? {
                  id: selectedPlatformAccountId,
                  platform: selectedPlatform,
                  accountId: this.normalizeOptionalString(selectedPlatformAccount['accountId']),
                  accountName: selectedPlatformAccountName,
                  avatarUrl: this.normalizeOptionalString(selectedPlatformAccount['avatarUrl']),
                }
              : null,
            platformAccountId: selectedPlatformAccountId,
            platformAccountName: selectedPlatformAccountName,
            platform: selectedPlatform,
            deliveryRecordId: created._id.toString(),
            deliveryChannel,
            assignedAt: processedAt.toISOString(),
            deliveredAt: null,
            deliveryStatus: DeliveryRecordStatus.FAILED,
            publishConfirmed: false,
            manualPickupRequired: false,
            heartbeatPending: false,
            failReason: reason,
          },
          'metadata.distribution.publishStatus': DistributionPublishStatus.COMPLETED,
          'metadata.distribution.lastStatusAt': processedAt.toISOString(),
          'metadata.distribution.manualPickupRequired': false,
          'metadata.distribution.heartbeatPending': false,
          'metadata.distribution.deliveryStatus': DeliveryRecordStatus.FAILED,
          'metadata.distribution.platform': selectedPlatform || this.resolveTaskPlatform(task),
          'metadata.distribution.platformAccountId': selectedPlatformAccountId,
          'metadata.distribution.accountType': taskAccountType,
        },
        $push: {
          'metadata.distribution.history': {
            status: 'delivery_failed',
            timestamp: processedAt.toISOString(),
            details: {
              deliveryRecordId: created._id.toString(),
              assignmentId: assignment['_id'].toString(),
              deliveryChannel,
              failReason: reason,
              platform: selectedPlatform,
              platformAccountId: selectedPlatformAccountId,
              platformAccountName: selectedPlatformAccountName,
            },
          },
        },
      }).exec()
    }

    return {
      dispatched: pushResult.success,
      pendingManualPickup: manualPickupRequired,
      manualPickupRequired,
      videoTaskId: task['_id'].toString(),
      assignmentId: assignment['_id'].toString(),
      deliveryRecordId: created._id.toString(),
      status: nextStatus,
      reason,
      deliveryChannel,
      platform: selectedPlatform,
      platformAccountId: selectedPlatformAccountId,
      platformAccountName: selectedPlatformAccountName,
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
    const accountLookup = await this.buildAssignmentAccountLookup(assignments)
    const taskTemplateId = this.resolveTaskTemplateId(task)
    const taskAccountType = this.resolveTaskAccountType(task)

    return assignments.flatMap((assignment) => {
      if (!this.isWithinDailyLimit(assignment)) {
        return []
      }

      if (requestedPlatforms.size > 0 && taskPlatform && !requestedPlatforms.has(taskPlatform)) {
        return []
      }

      const platformAccounts = accountLookup.get(assignment['_id'].toString()) || []
      const assignmentPlatforms = new Set([
        ...this.normalizeStringList(assignment['distributionRules']?.['preferredPlatforms']),
        ...platformAccounts.map(account => account.platform),
      ])
      const shouldEnforcePlatformMatch = rules.platformAccountIds.length === 0
      if (taskPlatform && shouldEnforcePlatformMatch && assignmentPlatforms.size > 0 && !assignmentPlatforms.has(taskPlatform)) {
        return []
      }

      const categoryFilters = new Set([
        ...this.normalizeStringList(assignment['distributionRules']?.['preferredCategories']),
        ...requestedCategories,
      ])
      if (categoryFilters.size > 0 && taskCategories.length > 0 && !taskCategories.some(category => categoryFilters.has(category))) {
        return []
      }

      if (!this.matchesTemplateRouting(taskTemplateId, assignment, rules)) {
        return []
      }

      if (!this.matchesAccountTypeRouting(taskAccountType, assignment, rules)) {
        return []
      }

      const selectedPlatformAccount = this.selectPlatformAccount(
        assignment,
        platformAccounts,
        taskPlatform,
        rules,
      )
      if (!selectedPlatformAccount) {
        return []
      }

      return [
        {
          ...assignment,
          selectedPlatformAccount,
          platformAccounts,
        },
      ]
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
    deliveryRecord: WebhookDeliveryRecord,
    videoData: DispatchVideoCard,
  ): Promise<ImPushResult> {
    const target = this.buildDispatchTarget(assignment)
    if (!target.webhookUrl) {
      return this.buildManualPickupResult(channel, videoData)
    }

    const channelBinding = this.resolveChannelBinding(assignment, channel)
    const registryResult = await this.imChannelRegistryService?.pushVideoCard(
      channel,
      {
        binding: channelBinding,
        target,
        deliveryRecord,
      },
      videoData,
    )
    if (registryResult) {
      return registryResult
    }

    if (channel === DeliveryChannel.FEISHU) {
      const context: ImPushContext<Record<string, unknown>> = {
        binding: channelBinding,
        target,
        deliveryRecord,
      }
      return this.feishuPushService.pushVideoCard(context, videoData)
    }

    if (channel === DeliveryChannel.WECOM) {
      const context: ImPushContext<Record<string, unknown>> = {
        binding: channelBinding,
        target,
        deliveryRecord,
      }
      return this.wecomPushService.pushVideoCard(context, videoData)
    }

    if (channel === DeliveryChannel.WEBHOOK) {
      const payload = this.imDeliveryService.buildGenericWebhookPayload(videoData, target, deliveryRecord)
      return this.imDeliveryService.deliverViaWebhook(deliveryRecord, target.webhookUrl, payload)
    }

    return this.buildManualPickupResult(channel, videoData)
  }

  private resolveDeliveryChannel(assignment: AssignmentRecord) {
    if (assignment['imBinding']?.['feishu']?.['openId'] || assignment['imBinding']?.['feishu']?.['chatId']) {
      return DeliveryChannel.FEISHU
    }
    if (assignment['imBinding']?.['wecom']?.['userId'] || assignment['imBinding']?.['wecom']?.['chatId']) {
      return DeliveryChannel.WECOM
    }
    if (assignment['imBinding']?.['dingtalk']?.['chatId']) {
      return DeliveryChannel.DINGTALK
    }
    if (assignment['imBinding']?.['telegram']?.['chatId']) {
      return DeliveryChannel.TELEGRAM
    }

    const webhookUrl = this.normalizeOptionalString(assignment['webhookUrl'])
    if (webhookUrl) {
      const host = this.readWebhookHost(webhookUrl)
      if (host.includes('feishu') || host.includes('larksuite') || host.includes('larkoffice')) {
        return DeliveryChannel.FEISHU
      }
      if (host.includes('qyapi.weixin.qq.com') || host.includes('wecom') || host.includes('weixin.qq.com')) {
        return DeliveryChannel.WECOM
      }
      if (host.includes('dingtalk.com') || host.includes('aliyuncs.com')) {
        return DeliveryChannel.DINGTALK
      }
      if (host.includes('telegram.org') || host.includes('t.me')) {
        return DeliveryChannel.TELEGRAM
      }
      return DeliveryChannel.WEBHOOK
    }

    return DeliveryChannel.MANUAL
  }

  private async buildAssignmentAccountLookup(assignments: AssignmentRecord[]) {
    const accountIds = Array.from(new Set(assignments.flatMap((assignment) => {
      const ids = this.normalizeIdList(assignment['platformAccountIds'])
      return ids.filter((id: string) => Types.ObjectId.isValid(id)).map((id: string) => new Types.ObjectId(id))
    })))

    if (accountIds.length === 0) {
      return new Map<string, PlatformAccountSummary[]>()
    }

    const accounts = await this.platformAccountModel.find({ _id: { $in: accountIds } }).lean().exec() as PlatformAccountRecord[]
    const accountSummaryMap = new Map(accounts.map(account => [
      account['_id'].toString(),
      this.toPlatformAccountSummary(account),
    ]))
    const assignmentPlatforms = new Map<string, PlatformAccountSummary[]>()

    for (const assignment of assignments) {
      const platformAccounts = this.normalizeIdList(assignment['platformAccountIds'])
        .map((id: string) => accountSummaryMap.get(id))
        .filter(Boolean) as PlatformAccountSummary[]
      assignmentPlatforms.set(assignment['_id'].toString(), platformAccounts)
    }

    return assignmentPlatforms
  }

  private async normalizeAssignmentPayload(orgId: string, data: Record<string, unknown>, existing?: AssignmentRecord) {
    const employeeName = this.normalizeRequiredString(data['employeeName'], 'employeeName', existing?.['employeeName'])
    const employeePhone = this.normalizeRequiredString(data['employeePhone'], 'employeePhone', existing?.['employeePhone'])
    const employeeUserId = this.normalizeOptionalString(data['employeeUserId'] ?? existing?.['employeeUserId'])
    const platformAccountIds = await this.normalizePlatformAccountIds(orgId, data['platformAccountIds'] ?? existing?.['platformAccountIds'] ?? [])
    const status = this.normalizeStatus(data['status'], existing?.['status']) || EmployeeAssignmentStatus.ACTIVE
    const distributionRules = this.normalizeDistributionRules(
      data['distributionRules'] ?? existing?.['distributionRules'],
      platformAccountIds,
    )
    const imBinding = this.normalizeImBindingPayload(data['imBinding'] ?? existing?.['imBinding'])
    const webhookUrl = this.normalizeWebhookUrl(
      this.hasOwn(data, 'webhookUrl') ? data['webhookUrl'] : existing?.['webhookUrl'],
    )
    const platforms = await this.resolvePlatformsForAccounts(platformAccountIds)
    const previousStats = existing?.['stats'] || {}

    return {
      employeeName,
      employeePhone,
      employeeUserId,
      platformAccountIds,
      imBinding,
      webhookUrl,
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

  private normalizeDistributionRules(value: unknown, platformAccountIds: string[] = []) {
    const source = this.asRecord(value)
    const defaultPlatformAccountId = this.normalizeOptionalString(source?.['defaultPlatformAccountId'])
    if (defaultPlatformAccountId && !platformAccountIds.includes(defaultPlatformAccountId)) {
      throw new BadRequestException('defaultPlatformAccountId must belong to platformAccountIds')
    }

    return {
      maxDailyVideos: this.toPositiveInt(source?.['maxDailyVideos']),
      preferredPlatforms: this.normalizeStringList(source?.['preferredPlatforms']),
      preferredCategories: this.normalizeStringList(source?.['preferredCategories']),
      templateIds: this.normalizeStringList(source?.['templateIds']),
      accountTypes: this.normalizeStringList(source?.['accountTypes']),
      defaultPlatformAccountId,
    }
  }

  private normalizeDispatchRules(value: DispatchRulesInput): Required<DispatchRulesInput> {
    return {
      pipelineId: this.normalizeOptionalString(value.pipelineId),
      assignmentIds: this.normalizeStringList(value.assignmentIds),
      preferredPlatforms: this.normalizeStringList(value.preferredPlatforms),
      preferredCategories: this.normalizeStringList(value.preferredCategories),
      templateIds: this.normalizeStringList(value.templateIds),
      accountTypes: this.normalizeStringList(value.accountTypes),
      platformAccountIds: this.normalizeStringList([
        ...(Array.isArray(value.platformAccountIds) ? value.platformAccountIds : []),
        this.normalizeOptionalString(value.platformAccountId),
      ]),
      platformAccountId: this.normalizeOptionalString(value.platformAccountId),
      strategy: this.normalizeStrategy(value.strategy),
    }
  }

  private normalizeImBindingPayload(value: unknown) {
    const source = this.asRecord(value)
    return {
      feishu: source?.['feishu'] ? this.normalizeImBinding(DeliveryChannel.FEISHU, source['feishu']) : undefined,
      wecom: source?.['wecom'] ? this.normalizeImBinding(DeliveryChannel.WECOM, source['wecom']) : undefined,
      dingtalk: source?.['dingtalk'] ? this.normalizeImBinding(DeliveryChannel.DINGTALK, source['dingtalk']) : undefined,
      telegram: source?.['telegram'] ? this.normalizeImBinding(DeliveryChannel.TELEGRAM, source['telegram']) : undefined,
    }
  }

  private normalizeImBinding(channel: DeliveryChannel, value: unknown) {
    const source = this.asRecord(value)
    if (!source) {
      throw new BadRequestException('binding is required')
    }

    if (channel === DeliveryChannel.FEISHU) {
      return {
        openId: this.normalizeOptionalString(source['openId']),
        chatId: this.normalizeOptionalString(source['chatId']),
      }
    }

    if (channel === DeliveryChannel.WECOM) {
      return {
        userId: this.normalizeOptionalString(source['userId']),
        chatId: this.normalizeOptionalString(source['chatId']),
      }
    }

    return {
      chatId: this.normalizeOptionalString(source['chatId']),
    }
  }

  private async normalizePlatformAccountIds(orgId: string, value: unknown) {
    const accountIds = this.normalizeIdList(value)
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

  private resolveTaskTemplateId(task: VideoTaskRecord) {
    const candidates = [
      task['metadata']?.['templateId'],
      task['metadata']?.['distribution']?.['templateId'],
      task['metadata']?.['productionBatch']?.['templateId'],
      task['metadata']?.['subtitlePreferences']?.['templateId'],
      task['templateId'],
    ]

    for (const candidate of candidates) {
      const normalized = this.normalizeOptionalString(candidate).toLowerCase()
      if (normalized) {
        return normalized
      }
    }

    return ''
  }

  private resolveTaskAccountType(task: VideoTaskRecord) {
    const candidates = [
      task['metadata']?.['accountType'],
      task['metadata']?.['distribution']?.['accountType'],
      task['metadata']?.['publishInfo']?.['accountType'],
      task['metadata']?.['platformType'],
    ]

    for (const candidate of candidates) {
      const normalized = this.normalizePlatformName(candidate)
      if (normalized) {
        return normalized
      }
    }

    return this.resolveTaskPlatform(task)
  }

  private matchesTemplateRouting(
    taskTemplateId: string,
    assignment: AssignmentRecord,
    rules: Required<DispatchRulesInput>,
  ) {
    const requestedTemplateIds = new Set(rules.templateIds)
    if (requestedTemplateIds.size > 0 && (!taskTemplateId || !requestedTemplateIds.has(taskTemplateId))) {
      return false
    }

    const assignmentTemplateIds = new Set(
      this.normalizeStringList(assignment['distributionRules']?.['templateIds']),
    )
    if (assignmentTemplateIds.size > 0 && (!taskTemplateId || !assignmentTemplateIds.has(taskTemplateId))) {
      return false
    }

    return true
  }

  private matchesAccountTypeRouting(
    taskAccountType: string,
    assignment: AssignmentRecord,
    rules: Required<DispatchRulesInput>,
  ) {
    const requestedAccountTypes = new Set(rules.accountTypes)
    if (requestedAccountTypes.size > 0 && (!taskAccountType || !requestedAccountTypes.has(taskAccountType))) {
      return false
    }

    const assignmentAccountTypes = new Set(
      this.normalizeStringList(assignment['distributionRules']?.['accountTypes']),
    )
    if (assignmentAccountTypes.size > 0 && (!taskAccountType || !assignmentAccountTypes.has(taskAccountType))) {
      return false
    }

    return true
  }

  private selectPlatformAccount(
    assignment: AssignmentRecord,
    platformAccounts: PlatformAccountSummary[],
    taskPlatform: string,
    rules: Required<DispatchRulesInput>,
  ) {
    const requestedPlatformAccountIds = new Set(rules.platformAccountIds)
    const defaultPlatformAccountId = this.normalizeOptionalString(
      assignment['distributionRules']?.['defaultPlatformAccountId'],
    )
    const candidates = requestedPlatformAccountIds.size > 0
      ? platformAccounts.filter(account => requestedPlatformAccountIds.has(account.id))
      : [...platformAccounts]

    if (requestedPlatformAccountIds.size > 0 && candidates.length === 0) {
      return null
    }

    if (taskPlatform) {
      const taskMatchedCandidates = candidates.filter(account => account.platform === taskPlatform)
      const taskDefaultCandidate = defaultPlatformAccountId
        ? taskMatchedCandidates.find(account => account.id === defaultPlatformAccountId)
        : null
      if (taskDefaultCandidate) {
        return taskDefaultCandidate
      }
      if (taskMatchedCandidates.length > 0) {
        return taskMatchedCandidates[0]
      }
      if (requestedPlatformAccountIds.size === 0 && platformAccounts.length > 0) {
        return null
      }
    }

    if (defaultPlatformAccountId) {
      const defaultCandidate = candidates.find(account => account.id === defaultPlatformAccountId)
      if (defaultCandidate) {
        return defaultCandidate
      }
    }

    if (candidates.length > 0) {
      return candidates[0]
    }

    if (requestedPlatformAccountIds.size > 0) {
      return null
    }

    return this.buildFallbackPlatformAccountSummary(
      taskPlatform || this.normalizeStringList(assignment['distributionRules']?.['preferredPlatforms'])[0] || '',
    )
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
    const title = this.normalizeOptionalString(task['copy']?.['title'])
      || this.normalizeOptionalString(task['metadata']?.['title'])
      || this.normalizeOptionalString(task['outputVideoUrl'])
      || task['_id'].toString()
    const description = this.normalizeOptionalString(task['copy']?.['description'])
    const subtitle = this.normalizeOptionalString(task['copy']?.['subtitle'])
    const hashtags = this.normalizeStringList(task['copy']?.['hashtags']).map(tag => `#${tag}`)
    const publishGuide = this.resolvePublishGuide(task)
    const selectedPlatformAccount = this.asRecord(task['metadata']?.['distribution']?.['employeeDispatch']?.['selectedPlatformAccount'])
    const primaryPlatform = this.normalizePlatformName(selectedPlatformAccount?.['platform']) || this.resolveTaskPlatform(task)

    return {
      videoTaskId: task['_id'].toString(),
      title,
      description,
      copy: [title, subtitle, description, hashtags.join(' ')].filter(Boolean).join('\n'),
      coverUrl: this.resolveTaskCoverUrl(task),
      outputVideoUrl: this.normalizeOptionalString(task['output']?.['url'])
        || this.normalizeOptionalString(task['outputVideoUrl']),
      publishGuide,
      publishPlatforms: primaryPlatform ? [primaryPlatform] : [],
      primaryPlatform,
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
      const normalized = this.normalizePlatformName(candidate)
      if (!normalized) {
        continue
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

  private resolveTaskCoverUrl(task: VideoTaskRecord) {
    const candidates = [
      task['output']?.['metadata']?.['coverUrl'],
      task['output']?.['metadata']?.['thumbnailUrl'],
      task['output']?.['metadata']?.['posterUrl'],
      task['metadata']?.['coverUrl'],
      task['metadata']?.['thumbnailUrl'],
      task['source']?.['metadata']?.['coverUrl'],
      task['source']?.['metadata']?.['thumbnailUrl'],
    ]

    for (const candidate of candidates) {
      const normalized = this.normalizeOptionalString(candidate)
      if (normalized) {
        return normalized
      }
    }

    return ''
  }

  private resolvePublishGuide(task: VideoTaskRecord) {
    const primaryGuide = this.normalizeOptionalString(task['copy']?.['commentGuide'])
    const guideList = this.normalizeStringList(task['copy']?.['commentGuides'])
    return [primaryGuide, ...guideList].filter(Boolean).join(' | ')
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
    const normalized = this.normalizeOptionalString(value).toLowerCase()
    switch (normalized) {
      case DeliveryChannel.FEISHU:
        return DeliveryChannel.FEISHU
      case DeliveryChannel.WECOM:
        return DeliveryChannel.WECOM
      case DeliveryChannel.DINGTALK:
        return DeliveryChannel.DINGTALK
      case DeliveryChannel.TELEGRAM:
        return DeliveryChannel.TELEGRAM
      default:
        throw new BadRequestException('channel must be feishu, wecom, dingtalk or telegram')
    }
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

  private normalizeIdList(value: unknown) {
    if (!Array.isArray(value)) {
      return []
    }

    return Array.from(new Set(value
      .map((item) => {
        if (typeof item === 'string') {
          return item.trim().toLowerCase()
        }
        if (item && typeof (item as { toString?: () => string }).toString === 'function') {
          const normalized = String(item).trim().toLowerCase()
          return normalized && normalized !== '[object object]' ? normalized : ''
        }
        return ''
      })
      .filter(Boolean)))
  }

  private normalizePlatformName(value: unknown) {
    const normalized = this.normalizeOptionalString(value).toLowerCase()
    if (normalized === 'xhs' || normalized === 'rednote') {
      return 'xiaohongshu'
    }
    return normalized
  }

  private normalizeWebhookUrl(value: unknown) {
    const normalized = this.normalizeOptionalString(value)
    if (!normalized) {
      return ''
    }

    try {
      const parsed = new URL(normalized)
      return parsed.toString()
    }
    catch {
      throw new BadRequestException('webhookUrl must be a valid URL')
    }
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

  private toPlatformAccountSummary(account: PlatformAccountRecord): PlatformAccountSummary {
    return {
      id: account['_id'].toString(),
      platform: this.normalizePlatformName(account['platform']),
      accountId: this.normalizeOptionalString(account['accountId']),
      accountName: this.normalizeOptionalString(account['accountName']),
      avatarUrl: this.normalizeOptionalString(account['avatarUrl']),
    }
  }

  private buildFallbackPlatformAccountSummary(platform: string): PlatformAccountSummary {
    return {
      id: '',
      platform: this.normalizePlatformName(platform),
      accountId: '',
      accountName: '',
      avatarUrl: '',
    }
  }

  private buildDispatchTarget(assignment: AssignmentRecord): DispatchEmployeeTarget {
    return {
      assignmentId: assignment['_id'].toString(),
      employeeName: assignment['employeeName'] || '',
      employeePhone: assignment['employeePhone'] || '',
      webhookUrl: this.normalizeOptionalString(assignment['webhookUrl']),
    }
  }

  private resolveChannelBinding(assignment: AssignmentRecord, channel: DeliveryChannel) {
    const imBinding = this.asRecord(assignment['imBinding']) || {}
    switch (channel) {
      case DeliveryChannel.FEISHU:
        return this.asRecord(imBinding['feishu']) || {}
      case DeliveryChannel.WECOM:
        return this.asRecord(imBinding['wecom']) || {}
      case DeliveryChannel.DINGTALK:
        return this.asRecord(imBinding['dingtalk']) || {}
      case DeliveryChannel.TELEGRAM:
        return this.asRecord(imBinding['telegram']) || {}
      default:
        return {}
    }
  }

  private resolveConversationId(assignment: AssignmentRecord, channel?: DeliveryChannel) {
    const bindingChannel = channel || this.resolveDeliveryChannel(assignment)
    const binding = this.resolveChannelBinding(assignment, bindingChannel)
    return this.normalizeOptionalString(
      binding['chatId']
      || binding['openId']
      || binding['userId']
      || assignment['employeeUserId']
      || assignment['employeePhone'],
    )
  }

  private supportsSessionChannel(channel: DeliveryChannel) {
    return [
      DeliveryChannel.FEISHU,
      DeliveryChannel.WECOM,
      DeliveryChannel.DINGTALK,
      DeliveryChannel.TELEGRAM,
    ].includes(channel)
  }

  private async pushSessionTemplateBySessionId(
    orgId: string,
    sessionId: string,
    message: {
      kind: 'approval-card' | 'report-card'
      title: string
      summary: string
      body: string[]
      actions?: Array<{ key: string, text: string, value?: string, url?: string }>
      metrics?: Array<{ label: string, value: string }>
    },
  ) {
    if (!this.imSessionService) {
      return null
    }

    const session = await this.imSessionService.getSession(orgId, sessionId)
    if (!session) {
      throw new NotFoundException('dispatch session not found')
    }
    const record = await this.getDeliveryRecordOrFail(session.deliveryRecordId, orgId)
    return this.pushSessionTemplate(orgId, record, message)
  }

  private async pushSessionTemplate(
    orgId: string,
    record: DeliveryRecordDocument,
    message: {
      kind: 'approval-card' | 'report-card'
      title: string
      summary: string
      body: string[]
      actions?: Array<{ key: string, text: string, value?: string, url?: string }>
      metrics?: Array<{ label: string, value: string }>
    },
  ) {
    if (!this.imChannelRegistryService) {
      return null
    }

    const assignment = await this.employeeAssignmentModel.findById(record['employeeAssignmentId']).lean().exec() as AssignmentRecord | null
    if (!assignment) {
      return null
    }

    const channel = record['deliveryChannel'] as DeliveryChannel
    if (!this.supportsSessionChannel(channel)) {
      return null
    }

    const deliveryRecord = this.toWebhookDeliveryRecord(record as unknown as DeliveryRecord, channel)
    const target = this.buildDispatchTarget(assignment)
    if (!target.webhookUrl) {
      return null
    }

    return await this.imChannelRegistryService.pushTemplateMessage(
      channel,
      {
        binding: this.resolveChannelBinding(assignment, channel),
        target,
        deliveryRecord,
      },
      message,
    )
  }

  private buildManualPickupResult(channel: DeliveryChannel, videoData: DispatchVideoCard): ImPushResult {
    return {
      success: false,
      manualPickupRequired: true,
      status: DeliveryRecordStatus.PENDING,
      deliveredAt: null,
      retryCount: 0,
      payload: {
        channel,
        reason: 'webhook_missing',
        manualPickupRequired: true,
        videoData,
      },
    }
  }

  private readWebhookHost(webhookUrl: string) {
    try {
      return new URL(webhookUrl).host.toLowerCase()
    }
    catch {
      return ''
    }
  }

  private toWebhookDeliveryRecord(record: DeliveryRecord, deliveryChannel: DeliveryChannel): WebhookDeliveryRecord {
    return {
      id: record._id.toString(),
      orgId: record.orgId,
      videoTaskId: record.videoTaskId,
      employeeAssignmentId: record.employeeAssignmentId,
      deliveryChannel,
    }
  }

  private hasOwn(value: Record<string, unknown>, key: string) {
    return Object.prototype.hasOwnProperty.call(value, key)
  }

  private async getAssignmentOrFail(id: string, expectedOrgId?: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('assignmentId is invalid')
    }

    const assignment = await this.employeeAssignmentModel.findById(new Types.ObjectId(id)).lean().exec() as AssignmentRecord | null
    if (!assignment) {
      throw new NotFoundException('Employee assignment not found')
    }

    if (expectedOrgId && assignment['orgId'] !== this.normalizeOrgId(expectedOrgId)) {
      throw new NotFoundException('Employee assignment not found')
    }

    return assignment
  }

  private async getTaskOrFail(id: string, expectedOrgId?: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('videoTaskId is invalid')
    }

    const task = await this.videoTaskModel.findById(new Types.ObjectId(id)).lean().exec() as VideoTaskRecord | null
    if (!task) {
      throw new NotFoundException('Video task not found')
    }

    if (expectedOrgId && this.resolveTaskOrgId(task) !== this.normalizeOrgId(expectedOrgId)) {
      throw new NotFoundException('Video task not found')
    }

    return task
  }

  private async getDeliveryRecordOrFail(id: string, expectedOrgId?: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('deliveryRecordId is invalid')
    }

    const record = await this.deliveryRecordModel.findById(new Types.ObjectId(id)).lean().exec() as DeliveryRecordDocument | null
    if (!record) {
      throw new NotFoundException('Delivery record not found')
    }

    if (expectedOrgId && record['orgId'] !== this.normalizeOrgId(expectedOrgId)) {
      throw new NotFoundException('Delivery record not found')
    }

    return record
  }

  private async buildAssignmentResponses(assignments: AssignmentRecord[]) {
    const accountLookup = await this.buildAssignmentAccountLookup(assignments)
    return assignments.map(assignment => this.serializeAssignmentResponse(
      assignment,
      accountLookup.get(assignment['_id'].toString()) || [],
    ))
  }

  private async toAssignmentResponse(assignment: AssignmentRecord | null) {
    if (!assignment) {
      throw new NotFoundException('Employee assignment not found')
    }

    const accountLookup = await this.buildAssignmentAccountLookup([assignment])
    return this.serializeAssignmentResponse(
      assignment,
      accountLookup.get(assignment['_id'].toString()) || [],
    )
  }

  private serializeAssignmentResponse(assignment: AssignmentRecord, platformAccounts: PlatformAccountSummary[]) {
    const platformAccountIds = this.normalizeIdList(assignment['platformAccountIds'])
    const defaultPlatformAccountId = this.normalizeOptionalString(
      assignment['distributionRules']?.['defaultPlatformAccountId'],
    )

    return {
      id: assignment['_id'].toString(),
      orgId: assignment['orgId'],
      employeeName: assignment['employeeName'] || '',
      employeePhone: assignment['employeePhone'] || '',
      employeeUserId: assignment['employeeUserId'] || '',
      platformAccountIds,
      platformAccounts,
      defaultPlatformAccount: defaultPlatformAccountId
        ? platformAccounts.find(account => account.id === defaultPlatformAccountId) || null
        : null,
      imBinding: assignment['imBinding'] || {},
      webhookUrl: assignment['webhookUrl'] || '',
      status: assignment['status'] || EmployeeAssignmentStatus.ACTIVE,
      distributionRules: assignment['distributionRules'] || {},
      platforms: this.normalizeStringList(assignment['platforms']),
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
      pushedAt: record['pushedAt'] || null,
      confirmedAt: record['confirmedAt'] || null,
      receivedAt: record['receivedAt'] || null,
      downloadedAt: record['downloadedAt'] || null,
      publishedAt: record['publishedAt'] || null,
      expiredAt: record['expiredAt'] || null,
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
