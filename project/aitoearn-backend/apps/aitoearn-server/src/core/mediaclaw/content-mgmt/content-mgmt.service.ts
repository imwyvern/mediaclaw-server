import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import {
  MediaClawUser,
  NotificationEvent,
  Organization,
  OrgType,
  Subscription,
  SubscriptionPlan,
  SubscriptionStatus,
  UserRole,
  VideoTask,
  VideoTaskApprovalAction,
  VideoTaskStatus,
} from '@yikart/mongodb'
import { Model, Types } from 'mongoose'
import { NotificationService } from '../notification/notification.service'
import { WebhookService } from '../webhook/webhook.service'

interface ContentFilters {
  status?: VideoTaskStatus
  publishStatus?: string
  brandId?: string
  startDate?: string
  endDate?: string
}

interface PaginationInput {
  page?: number
  limit?: number
}

interface CopyUpdateInput {
  title?: string
  subtitle?: string
  hashtags?: string[]
  blueWords?: string[]
  commentGuides?: string[]
}

interface ContentReviewInput {
  action: 'approve' | 'reject' | 'changes_requested'
  comment?: string
}

interface ReviewerContext {
  id: string
  name: string
  role: UserRole
}

@Injectable()
export class ContentMgmtService {
  constructor(
    @InjectModel(VideoTask.name)
    private readonly videoTaskModel: Model<VideoTask>,
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<Organization>,
    @InjectModel(Subscription.name)
    private readonly subscriptionModel: Model<Subscription>,
    @InjectModel(MediaClawUser.name)
    private readonly mediaClawUserModel: Model<MediaClawUser>,
    private readonly notificationService: NotificationService,
    private readonly webhookService: WebhookService,
  ) {}

  async initializeWorkflowForTask(taskId: string) {
    const task = await this.videoTaskModel.findById(this.toObjectId(taskId, 'taskId')).exec()
    if (!task) {
      throw new NotFoundException('Content not found')
    }

    const maxLevel = await this.resolveApprovalLevels(task.orgId || null)
    if (maxLevel <= 0 || task.status !== VideoTaskStatus.COMPLETED) {
      return task.toObject()
    }

    const submittedAt = new Date()
    const approval = this.buildApprovalState(maxLevel, submittedAt)
    const updated = await this.videoTaskModel.findByIdAndUpdate(
      task._id,
      {
        $set: {
          status: VideoTaskStatus.PENDING_REVIEW,
          approval,
        },
        $push: {
          'metadata.timeline': this.createTimelineEntry(
            'pending_review',
            submittedAt,
            'Content submitted for review',
            VideoTaskStatus.PENDING_REVIEW,
          ),
        },
      },
      { new: true },
    ).lean().exec()

    if (!updated) {
      throw new NotFoundException('Content not found')
    }

    await this.emitContentEvent(updated, NotificationEvent.CONTENT_PENDING_REVIEW, {
      currentLevel: approval.currentLevel,
      maxLevel: approval.maxLevel,
    })

    return updated
  }

  async editCopy(
    orgId: string,
    contentId: string,
    title?: string,
    subtitle?: string,
    hashtags?: string[],
  ) {
    const task = await this.getTaskOrFail(orgId, contentId)
    const nextCopy = {
      title: title ?? task.copy?.title ?? '',
      subtitle: subtitle ?? task.copy?.subtitle ?? '',
      hashtags: hashtags ?? task.copy?.hashtags ?? [],
      blueWords: task.copy?.blueWords ?? [],
      commentGuide: task.copy?.commentGuide ?? '',
      commentGuides: task.copy?.commentGuides ?? [],
    }

    const updated = await this.videoTaskModel.findByIdAndUpdate(
      task._id,
      {
        $set: {
          'copy': nextCopy,
          'metadata.contentManagement.lastEditedAt': new Date().toISOString(),
        },
      },
      { new: true },
    ).lean().exec()

    if (!updated) {
      throw new NotFoundException('Content not found')
    }

    return this.toContentResponse(updated)
  }

  async approveContent(
    orgId: string,
    contentId: string,
    reviewerId: string,
    comment?: string,
  ) {
    return this.reviewContent(orgId, contentId, reviewerId, {
      action: 'approve',
      comment,
    })
  }

  async reviewContent(
    orgId: string,
    contentId: string,
    reviewerId: string,
    input: ContentReviewInput,
  ) {
    const action = this.normalizeReviewAction(input.action)
    const task = await this.getTaskOrFail(orgId, contentId)
    if (task.status !== VideoTaskStatus.PENDING_REVIEW || !task.approval) {
      throw new BadRequestException('Content is not pending review')
    }

    const reviewer = await this.getReviewerContext(orgId, reviewerId)
    const approval = this.normalizeApproval(task.approval)
    if (!approval.pendingRoles.includes(reviewer.role)) {
      throw new ForbiddenException('Reviewer is not allowed to approve this level')
    }

    const reviewedAt = new Date()
    const comment = input.comment?.trim() || ''
    const historyEntry = {
      level: approval.currentLevel,
      reviewerId: reviewer.id,
      reviewerName: reviewer.name,
      reviewerRole: reviewer.role,
      action: this.toApprovalAction(action),
      comment,
      at: reviewedAt,
    }

    let nextStatus = VideoTaskStatus.PENDING_REVIEW
    let nextTimelineStatus = 'pending_review'
    let nextTimelineRawStatus = VideoTaskStatus.PENDING_REVIEW
    let nextTimelineMessage = 'Review approved and escalated'
    let nextNotificationEvent = NotificationEvent.CONTENT_PENDING_REVIEW
    let nextApproval = {
      ...approval,
      lastAction: historyEntry.action,
      lastComment: comment,
      reviewedAt,
      history: [...approval.history, historyEntry],
    }
    const eventPayload: Record<string, unknown> = {
      reviewer,
      currentLevel: approval.currentLevel,
      maxLevel: approval.maxLevel,
      comment,
    }

    if (action === 'approve') {
      if (approval.currentLevel >= approval.maxLevel) {
        nextStatus = VideoTaskStatus.APPROVED
        nextTimelineStatus = 'approved'
        nextTimelineRawStatus = VideoTaskStatus.APPROVED
        nextTimelineMessage = 'Content approved'
        nextNotificationEvent = NotificationEvent.CONTENT_APPROVED
        nextApproval = {
          ...nextApproval,
          currentLevel: approval.maxLevel,
          pendingRoles: [],
        }
      }
      else {
        const nextLevel = approval.currentLevel + 1
        nextTimelineMessage = `Review approved at level ${approval.currentLevel}, escalated to level ${nextLevel}`
        nextApproval = {
          ...nextApproval,
          currentLevel: nextLevel,
          pendingRoles: this.getPendingRoles(approval.maxLevel, nextLevel),
        }
        eventPayload['currentLevel'] = nextLevel
        eventPayload['pendingRoles'] = nextApproval.pendingRoles
      }
    }
    else {
      nextStatus = VideoTaskStatus.REJECTED
      nextTimelineStatus = 'rejected'
      nextTimelineRawStatus = VideoTaskStatus.REJECTED
      nextTimelineMessage = action === 'changes_requested'
        ? 'Changes requested during review'
        : 'Content rejected'
      nextNotificationEvent = action === 'changes_requested'
        ? NotificationEvent.CONTENT_CHANGES_REQUESTED
        : NotificationEvent.CONTENT_REJECTED
      nextApproval = {
        ...nextApproval,
        pendingRoles: [],
      }
    }

    const updated = await this.videoTaskModel.findByIdAndUpdate(
      task._id,
      {
        $set: {
          status: nextStatus,
          approval: nextApproval,
        },
        $push: {
          'metadata.timeline': this.createTimelineEntry(
            nextTimelineStatus,
            reviewedAt,
            nextTimelineMessage,
            nextTimelineRawStatus,
          ),
        },
      },
      { new: true },
    ).lean().exec()

    if (!updated) {
      throw new NotFoundException('Content not found')
    }

    await this.emitContentEvent(updated, nextNotificationEvent, eventPayload)
    return this.toContentResponse(updated)
  }

  async markPublished(
    orgId: string,
    contentId: string,
    platform: string,
    publishUrl: string,
    publisherId?: string,
  ) {
    if (!platform?.trim()) {
      throw new BadRequestException('platform is required')
    }
    if (!publishUrl?.trim()) {
      throw new BadRequestException('publishUrl is required')
    }

    const task = await this.getTaskOrFail(orgId, contentId)
    const maxLevel = task.approval?.maxLevel || await this.resolveApprovalLevels(task.orgId || null)
    const allowedStatuses = maxLevel > 0
      ? [VideoTaskStatus.APPROVED, VideoTaskStatus.PUBLISHED]
      : [VideoTaskStatus.COMPLETED, VideoTaskStatus.APPROVED, VideoTaskStatus.PUBLISHED]

    if (!allowedStatuses.includes(task.status)) {
      throw new BadRequestException('Content must be approved before publishing')
    }

    const publisher = publisherId
      ? await this.tryGetReviewerContext(orgId, publisherId)
      : null
    const timestamp = new Date().toISOString()
    const publishedAt = new Date(timestamp)
    const approval = task.approval
      ? {
          ...this.normalizeApproval(task.approval),
          lastAction: VideoTaskApprovalAction.PUBLISHED,
          lastComment: `Published to ${platform.trim()}`,
          history: [
            ...this.normalizeApproval(task.approval).history,
            {
              level: task.approval.currentLevel || task.approval.maxLevel || 0,
              reviewerId: publisher?.id || '',
              reviewerName: publisher?.name || '',
              reviewerRole: publisher?.role || '',
              action: VideoTaskApprovalAction.PUBLISHED,
              comment: `Published to ${platform.trim()}`,
              at: publishedAt,
            },
          ],
        }
      : null
    const updated = await this.videoTaskModel.findByIdAndUpdate(
      task._id,
      {
        $set: {
          status: VideoTaskStatus.PUBLISHED,
          approval,
          'publishedAt': publishedAt,
          'metadata.publishInfo': {
            platform: platform.trim(),
            publishUrl: publishUrl.trim(),
            publishedAt: timestamp,
          },
          'metadata.publishedAt': timestamp,
          'metadata.distribution.publishStatus': 'published',
          'metadata.distribution.lastStatusAt': timestamp,
        },
        $push: {
          'metadata.distribution.history': {
            status: 'published',
            timestamp,
            details: {
              platform: platform.trim(),
              publishUrl: publishUrl.trim(),
            },
          },
          'metadata.timeline': this.createTimelineEntry(
            'published',
            publishedAt,
            'Content published',
            VideoTaskStatus.PUBLISHED,
          ),
        },
      },
      { new: true },
    ).lean().exec()

    if (!updated) {
      throw new NotFoundException('Content not found')
    }

    await this.emitContentEvent(updated, NotificationEvent.CONTENT_PUBLISHED, {
      platform: platform.trim(),
      publishUrl: publishUrl.trim(),
      publisher,
    })

    return this.toContentResponse(updated)
  }

  async setStylePreferences(orgId: string, prefs: Record<string, unknown>) {
    const updated = await this.organizationModel.findByIdAndUpdate(
      this.toObjectId(orgId, 'orgId'),
      {
        $set: {
          'settings.contentManagement.stylePreferences': prefs || {},
        },
      },
      { new: true },
    ).lean().exec()

    if (!updated) {
      throw new NotFoundException('Organization not found')
    }

    return {
      orgId: updated._id.toString(),
      preferences: this.extractStylePreferences(updated),
    }
  }

  async getStylePreferences(orgId: string) {
    const organization = await this.organizationModel.findById(
      this.toObjectId(orgId, 'orgId'),
    ).lean().exec()

    if (!organization) {
      throw new NotFoundException('Organization not found')
    }

    return {
      orgId: organization._id.toString(),
      preferences: this.extractStylePreferences(organization),
    }
  }

  async listContent(
    orgId: string,
    filters: ContentFilters,
    pagination: PaginationInput,
  ) {
    const page = this.normalizePage(pagination.page)
    const limit = this.normalizeLimit(pagination.limit)
    const skip = (page - 1) * limit
    const query = this.buildQuery(orgId, filters)

    const [items, total] = await Promise.all([
      this.videoTaskModel.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.videoTaskModel.countDocuments(query),
    ])

    return {
      items: items.map(item => this.toContentResponse(item)),
      total,
      page,
      limit,
    }
  }

  async listPendingContent(orgId: string, reviewerId: string) {
    const reviewer = await this.getReviewerContext(orgId, reviewerId)
    const items = await this.videoTaskModel.find({
      orgId: this.toObjectId(orgId, 'orgId'),
      status: VideoTaskStatus.PENDING_REVIEW,
      'approval.pendingRoles': reviewer.role,
    })
      .sort({ updatedAt: -1, createdAt: -1 })
      .lean()
      .exec()

    return {
      reviewer,
      total: items.length,
      items: items.map(item => this.toContentResponse(item)),
    }
  }

  async batchEditCopy(orgId: string, contentIds: string[], updates: CopyUpdateInput) {
    if (!Array.isArray(contentIds) || contentIds.length === 0) {
      throw new BadRequestException('contentIds is required')
    }

    const setPayload: Record<string, unknown> = {}
    if ('title' in updates) {
      setPayload['copy.title'] = updates.title ?? ''
    }
    if ('subtitle' in updates) {
      setPayload['copy.subtitle'] = updates.subtitle ?? ''
    }
    if ('hashtags' in updates) {
      setPayload['copy.hashtags'] = updates.hashtags ?? []
    }
    if ('blueWords' in updates) {
      setPayload['copy.blueWords'] = updates.blueWords ?? []
    }
    if ('commentGuides' in updates) {
      setPayload['copy.commentGuides'] = updates.commentGuides ?? []
      setPayload['copy.commentGuide'] = (updates.commentGuides ?? []).join('\n')
    }

    if (Object.keys(setPayload).length === 0) {
      throw new BadRequestException('updates is required')
    }

    setPayload['metadata.contentManagement.lastEditedAt'] = new Date().toISOString()

    const objectIds = contentIds.map(contentId => this.toObjectId(contentId, 'contentId'))
    const result = await this.videoTaskModel.updateMany(
      {
        _id: { $in: objectIds },
        orgId: this.toObjectId(orgId, 'orgId'),
      },
      { $set: setPayload },
    ).exec()

    const updatedItems = await this.videoTaskModel.find({
      _id: { $in: objectIds },
      orgId: this.toObjectId(orgId, 'orgId'),
    }).lean().exec()

    return {
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
      items: updatedItems.map(item => this.toContentResponse(item)),
    }
  }

  async exportContent(orgId: string, format: string, filters: ContentFilters) {
    const normalizedFormat = format.toLowerCase()
    const query = this.buildQuery(orgId, filters)
    const items = await this.videoTaskModel.find(query)
      .sort({ createdAt: -1 })
      .lean()
      .exec()

    const rows = items.map(item => this.toContentResponse(item))
    if (normalizedFormat === 'json') {
      return {
        format: 'json',
        fileName: `content-export-${new Date().toISOString()}.json`,
        mimeType: 'application/json',
        data: JSON.stringify(rows, null, 2),
      }
    }

    if (normalizedFormat === 'csv') {
      return {
        format: 'csv',
        fileName: `content-export-${new Date().toISOString()}.csv`,
        mimeType: 'text/csv',
        data: this.toCsv(rows),
      }
    }

    throw new BadRequestException('format must be csv or json')
  }

  async getContent(orgId: string, contentId: string) {
    const task = await this.videoTaskModel.findOne({
      _id: this.toObjectId(contentId, 'contentId'),
      orgId: this.toObjectId(orgId, 'orgId'),
    }).lean().exec()
    if (!task) {
      throw new NotFoundException('Content not found')
    }

    return this.toContentResponse(task)
  }

  private buildQuery(orgId: string, filters: ContentFilters) {
    const query: Record<string, unknown> = {
      orgId: this.toObjectId(orgId, 'orgId'),
    }

    if (filters.status) {
      query['status'] = filters.status
    }

    if (filters.publishStatus) {
      query['metadata.distribution.publishStatus'] = filters.publishStatus
    }

    if (filters.brandId) {
      query['brandId'] = this.toObjectId(filters.brandId, 'brandId')
    }

    if (filters.startDate || filters.endDate) {
      const createdAt: Record<string, Date> = {}
      if (filters.startDate) {
        createdAt['$gte'] = new Date(filters.startDate)
      }
      if (filters.endDate) {
        createdAt['$lte'] = new Date(filters.endDate)
      }
      query['createdAt'] = createdAt
    }

    return query
  }

  private extractStylePreferences(organization: Record<string, any>) {
    return organization['settings']?.['contentManagement']?.['stylePreferences'] || {}
  }

  private toContentResponse(task: Record<string, any>) {
    return {
      id: task['_id']?.toString(),
      orgId: task['orgId']?.toString() || null,
      brandId: task['brandId']?.toString() || null,
      pipelineId: task['pipelineId']?.toString() || null,
      userId: task['userId'],
      taskType: task['taskType'],
      status: task['status'],
      sourceVideoUrl: task['sourceVideoUrl'],
      outputVideoUrl: task['outputVideoUrl'],
      copy: {
        title: task['copy']?.['title'] || '',
        subtitle: task['copy']?.['subtitle'] || '',
        hashtags: task['copy']?.['hashtags'] || [],
        blueWords: task['copy']?.['blueWords'] || [],
        commentGuide: task['copy']?.['commentGuide'] || '',
        commentGuides: task['copy']?.['commentGuides'] || [],
      },
      publishInfo: task['metadata']?.['publishInfo'] || null,
      publishStatus: task['metadata']?.['distribution']?.['publishStatus'] || null,
      approval: this.toApprovalResponse(task['approval']),
      createdAt: task['createdAt'],
      updatedAt: task['updatedAt'],
      startedAt: task['startedAt'] || null,
      completedAt: task['completedAt'] || null,
      publishedAt: task['publishedAt'] || task['metadata']?.['publishedAt'] || null,
    }
  }

  private toCsv(rows: Array<Record<string, any>>) {
    const headers = [
      'id',
      'orgId',
      'brandId',
      'pipelineId',
      'userId',
      'taskType',
      'status',
      'title',
      'subtitle',
      'hashtags',
      'publishPlatform',
      'publishUrl',
      'publishStatus',
      'createdAt',
      'updatedAt',
    ]

    const lines = rows.map(row => [
      row['id'],
      row['orgId'],
      row['brandId'],
      row['pipelineId'],
      row['userId'],
      row['taskType'],
      row['status'],
      row['copy']?.['title'] || '',
      row['copy']?.['subtitle'] || '',
      Array.isArray(row['copy']?.['hashtags']) ? row['copy']['hashtags'].join('|') : '',
      row['publishInfo']?.['platform'] || '',
      row['publishInfo']?.['publishUrl'] || '',
      row['publishStatus'] || '',
      row['createdAt'] instanceof Date ? row['createdAt'].toISOString() : row['createdAt'] || '',
      row['updatedAt'] instanceof Date ? row['updatedAt'].toISOString() : row['updatedAt'] || '',
    ])

    return [
      headers.join(','),
      ...lines.map(columns => columns.map(column => this.escapeCsvValue(column)).join(',')),
    ].join('\n')
  }

  private escapeCsvValue(value: unknown) {
    const text = String(value ?? '')
    if (!text.includes(',') && !text.includes('"') && !text.includes('\n')) {
      return text
    }
    return `"${text.replace(/"/g, '""')}"`
  }

  private async getTaskOrFail(orgId: string, contentId: string) {
    const task = await this.videoTaskModel.findOne({
      _id: this.toObjectId(contentId, 'contentId'),
      orgId: this.toObjectId(orgId, 'orgId'),
    }).exec()
    if (!task) {
      throw new NotFoundException('Content not found')
    }
    return task
  }

  private normalizePage(page?: number) {
    return Math.max(1, Math.trunc(Number(page) || 1))
  }

  private normalizeLimit(limit?: number) {
    return Math.max(1, Math.min(Math.trunc(Number(limit) || 20), 100))
  }

  private normalizeReviewAction(action: string) {
    if (action === 'approve' || action === 'reject' || action === 'changes_requested') {
      return action
    }

    throw new BadRequestException('action must be approve, reject or changes_requested')
  }

  private toApprovalAction(action: ContentReviewInput['action']) {
    switch (action) {
      case 'approve':
        return VideoTaskApprovalAction.APPROVED
      case 'changes_requested':
        return VideoTaskApprovalAction.CHANGES_REQUESTED
      default:
        return VideoTaskApprovalAction.REJECTED
    }
  }

  private async resolveApprovalLevels(orgId: unknown) {
    const normalizedOrgId = this.toMaybeObjectId(orgId)
    if (!normalizedOrgId) {
      return 0
    }

    const [organization, subscription] = await Promise.all([
      this.organizationModel.findById(normalizedOrgId).lean().exec(),
      this.subscriptionModel.findOne({
        orgId: normalizedOrgId,
        status: {
          $in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE],
        },
      }).sort({ createdAt: -1 }).lean().exec(),
    ])

    if (!organization) {
      return 0
    }

    if (subscription) {
      switch (subscription.plan) {
        case SubscriptionPlan.TEAM:
          return 1
        case SubscriptionPlan.PRO:
          return 2
        case SubscriptionPlan.FLAGSHIP:
          return this.resolveConfiguredMaxLevel(organization, 3)
      }
    }

    switch (organization.type) {
      case OrgType.TEAM:
        return 1
      case OrgType.PROFESSIONAL:
        return 2
      case OrgType.ENTERPRISE:
        return this.resolveConfiguredMaxLevel(organization, 3)
      default:
        return 0
    }
  }

  private resolveConfiguredMaxLevel(organization: Record<string, any>, fallback: number) {
    const configured = Number(
      organization['settings']?.['contentManagement']?.['approval']?.['maxLevel'],
    )

    if (Number.isInteger(configured) && configured >= 1 && configured <= 3) {
      return configured
    }

    return fallback
  }

  private getPendingRoles(maxLevel: number, level: number) {
    if (maxLevel <= 1) {
      return [UserRole.ADMIN]
    }

    if (level === 1) {
      return [UserRole.EDITOR, UserRole.ADMIN]
    }

    return [UserRole.ADMIN]
  }

  private buildApprovalState(maxLevel: number, submittedAt: Date) {
    return {
      currentLevel: 1,
      maxLevel,
      pendingRoles: this.getPendingRoles(maxLevel, 1),
      lastAction: VideoTaskApprovalAction.SUBMITTED,
      lastComment: '',
      submittedAt,
      reviewedAt: null,
      history: [
        {
          level: 1,
          reviewerId: '',
          reviewerName: '',
          reviewerRole: '',
          action: VideoTaskApprovalAction.SUBMITTED,
          comment: 'Content submitted for review',
          at: submittedAt,
        },
      ],
    }
  }

  private normalizeApproval(approval: Record<string, any>) {
    const maxLevel = Math.max(1, Number(approval['maxLevel']) || 1)
    const currentLevel = Math.min(
      maxLevel,
      Math.max(1, Number(approval['currentLevel']) || 1),
    )
    const pendingRoles = Array.isArray(approval['pendingRoles'])
      ? approval['pendingRoles']
      : this.getPendingRoles(maxLevel, currentLevel)

    return {
      currentLevel,
      maxLevel,
      pendingRoles,
      lastAction: approval['lastAction'] || VideoTaskApprovalAction.SUBMITTED,
      lastComment: approval['lastComment'] || '',
      submittedAt: approval['submittedAt'] || null,
      reviewedAt: approval['reviewedAt'] || null,
      history: Array.isArray(approval['history']) ? approval['history'] : [],
    }
  }

  private toApprovalResponse(approval: Record<string, any> | null | undefined) {
    if (!approval) {
      return null
    }

    const normalized = this.normalizeApproval(approval)
    return {
      currentLevel: normalized.currentLevel,
      maxLevel: normalized.maxLevel,
      pendingRoles: normalized.pendingRoles,
      lastAction: normalized.lastAction,
      lastComment: normalized.lastComment,
      submittedAt: normalized.submittedAt,
      reviewedAt: normalized.reviewedAt,
      history: normalized.history.map((entry: Record<string, any>) => ({
        level: entry['level'] || 0,
        reviewerId: entry['reviewerId'] || '',
        reviewerName: entry['reviewerName'] || '',
        reviewerRole: entry['reviewerRole'] || '',
        action: entry['action'] || VideoTaskApprovalAction.SUBMITTED,
        comment: entry['comment'] || '',
        at: entry['at'] || null,
      })),
    }
  }

  private createTimelineEntry(
    status: string,
    timestamp: Date,
    message: string,
    rawStatus: VideoTaskStatus,
  ) {
    return {
      status,
      rawStatus,
      timestamp: timestamp.toISOString(),
      message,
    }
  }

  private async getReviewerContext(orgId: string, reviewerId: string): Promise<ReviewerContext> {
    const reviewer = await this.tryGetReviewerContext(orgId, reviewerId)
    if (!reviewer) {
      throw new ForbiddenException('Reviewer does not belong to the organization')
    }

    return reviewer
  }

  private async tryGetReviewerContext(orgId: string, reviewerId: string) {
    const user = await this.mediaClawUserModel.findById(this.toObjectId(reviewerId, 'reviewerId')).lean().exec()
    if (!user || user.isActive === false) {
      return null
    }

    const membership = Array.isArray(user.orgMemberships)
      ? user.orgMemberships.find(item => item.orgId?.toString() === orgId)
      : null
    const role = membership?.role || (user.orgId?.toString() === orgId ? user.role : null)

    if (!role) {
      return null
    }

    return {
      id: user._id.toString(),
      name: user.name || user.email || user.phone || user._id.toString(),
      role,
    }
  }

  private async emitContentEvent(
    task: Record<string, any>,
    event: NotificationEvent,
    extras: Record<string, unknown> = {},
  ) {
    const orgId = task['orgId']?.toString?.() || task['orgId']
    if (!orgId || !Types.ObjectId.isValid(orgId)) {
      return
    }

    const payload = {
      orgId,
      contentId: task['_id']?.toString?.() || task['_id'],
      status: task['status'],
      approval: this.toApprovalResponse(task['approval']),
      publishInfo: task['metadata']?.['publishInfo'] || null,
      ...extras,
    }

    await Promise.allSettled([
      this.notificationService.send(orgId, event, payload),
      this.webhookService.trigger(event, payload),
    ])
  }

  private toObjectId(value: string, field: string) {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`${field} is invalid`)
    }

    return new Types.ObjectId(value)
  }

  private toMaybeObjectId(value: unknown) {
    if (value instanceof Types.ObjectId) {
      return value
    }

    const normalized = value?.toString?.()
    if (typeof normalized === 'string' && Types.ObjectId.isValid(normalized)) {
      return new Types.ObjectId(normalized)
    }

    return null
  }
}
