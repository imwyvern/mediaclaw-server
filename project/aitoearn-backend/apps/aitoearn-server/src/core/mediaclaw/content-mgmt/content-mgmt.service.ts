import { PassThrough } from 'node:stream'
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
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
import AdmZip from 'adm-zip'
import archiver from 'archiver'
import { Model, Types } from 'mongoose'
import { EmployeeDispatchService } from '../employee-dispatch/employee-dispatch.service'
import { NotificationService } from '../notification/notification.service'
import { createStatusTransitionIterationEntry, mapVideoTaskStatusToProductionStage } from '../video-task-lifecycle.util'
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

interface CalendarFilters {
  startDate?: string
  endDate?: string
  month?: string
  status?: string
  platform?: string
}

interface BatchUpdateInput {
  ids: string[]
  caption?: string
  status?: string
}

interface BatchApproveResultItem {
  id: string
  approved: boolean
  content?: Record<string, unknown>
  error?: string
}

type BatchDownloadFormat = 'links' | 'zip'
type ExportContentFormat = 'json' | 'csv' | 'excel' | 'zip'

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

interface CalendarScheduleInput {
  scheduledAt: string
  platform?: string
  note?: string
}

interface CalendarBatchScheduleInput {
  ids: string[]
  startDate: string
  time?: string
  platform?: string
  strategy?: 'daily' | 'weekdays'
}

interface CalendarRange {
  start: Date
  end: Date
}

interface CalendarRow {
  id: string
  detailId: string
  title: string
  brand: string
  status: string
  rawStatus: string
  scheduledAt: string
  platform: string
  publishStatus: string
  outputVideoUrl: string
  canApprove: boolean
  approvalStatus: string | null
  note: string
  conflict: boolean
  conflictCount: number
  conflictIds: string[]
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
    @Optional()
    private readonly employeeDispatchService?: EmployeeDispatchService,
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
          'status': VideoTaskStatus.PENDING_REVIEW,
          approval,
          'metadata.productionStage': mapVideoTaskStatusToProductionStage(VideoTaskStatus.PENDING_REVIEW),
        },
        $push: {
          'iterationLog': createStatusTransitionIterationEntry(task.iterationLog as Array<Record<string, any>> || [], {
            fromStatus: task.status,
            toStatus: VideoTaskStatus.PENDING_REVIEW,
            timestamp: submittedAt,
            detail: {
              source: 'content-mgmt',
              action: 'submit_review',
            },
          }),
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
    blueWords?: string[],
    commentGuides?: string[],
  ) {
    const task = await this.getTaskOrFail(orgId, contentId)
    const nextCopy = {
      title: title ?? task.copy?.title ?? '',
      subtitle: subtitle ?? task.copy?.subtitle ?? '',
      hashtags: hashtags ?? task.copy?.hashtags ?? [],
      blueWords: blueWords ?? task.copy?.blueWords ?? [],
      commentGuide: commentGuides ? commentGuides.join('\n') : task.copy?.commentGuide ?? '',
      commentGuides: commentGuides ?? task.copy?.commentGuides ?? [],
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
          'status': nextStatus,
          'approval': nextApproval,
          'metadata.productionStage': mapVideoTaskStatusToProductionStage(nextStatus),
        },
        $push: {
          'iterationLog': createStatusTransitionIterationEntry(task.iterationLog as Array<Record<string, any>> || [], {
            fromStatus: task.status,
            toStatus: nextStatus,
            timestamp: reviewedAt,
            detail: {
              source: 'content-mgmt',
              action,
              reviewerId,
            },
          }),
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
          'status': VideoTaskStatus.PUBLISHED,
          approval,
          'publishedAt': publishedAt,
          'metadata.publishInfo': {
            platform: platform.trim(),
            publishUrl: publishUrl.trim(),
            publishedAt: timestamp,
          },
          'metadata.publishedAt': timestamp,
          'metadata.productionStage': mapVideoTaskStatusToProductionStage(VideoTaskStatus.PUBLISHED),
          'metadata.distribution.publishStatus': 'published',
          'metadata.distribution.lastStatusAt': timestamp,
        },
        $push: {
          'iterationLog': createStatusTransitionIterationEntry(task.iterationLog as Array<Record<string, any>> || [], {
            fromStatus: task.status,
            toStatus: VideoTaskStatus.PUBLISHED,
            timestamp: publishedAt,
            detail: {
              source: 'content-mgmt',
              action: 'publish',
              platform: platform.trim(),
            },
          }),
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

    if (this.employeeDispatchService) {
      await this.employeeDispatchService.confirmPublished(orgId, contentId).catch(() => undefined)
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
      'orgId': this.toObjectId(orgId, 'orgId'),
      'status': VideoTaskStatus.PENDING_REVIEW,
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

  async listCalendar(orgId: string, filters: CalendarFilters = {}) {
    const range = this.resolveCalendarRange(filters)
    const query = this.buildCalendarQuery(orgId, filters, range)
    const tasks = await this.videoTaskModel.find(query)
      .sort({
        'metadata.contentCalendar.scheduledAtDate': 1,
        'publishedAt': 1,
        'createdAt': -1,
      })
      .limit(500)
      .lean()
      .exec()

    const items = this.annotateCalendarConflicts(
      tasks
        .map(task => this.toCalendarRow(task))
        .filter((item) => {
          const scheduledAt = new Date(item.scheduledAt)
          if (Number.isNaN(scheduledAt.getTime())) {
            return false
          }
          if (scheduledAt < range.start || scheduledAt > range.end) {
            return false
          }
          if (filters.platform && filters.platform !== 'all' && item.platform !== filters.platform) {
            return false
          }
          return true
        }),
    )

    return {
      items,
      total: items.length,
      conflictCount: items.filter(item => item.conflict).length,
      range: {
        start: range.start.toISOString(),
        end: range.end.toISOString(),
      },
    }
  }

  async scheduleContent(
    orgId: string,
    contentId: string,
    schedulerId: string,
    input: CalendarScheduleInput,
  ) {
    const task = await this.getTaskOrFail(orgId, contentId)
    if (task.status === VideoTaskStatus.PUBLISHED) {
      throw new BadRequestException('Published content cannot be rescheduled')
    }

    const updated = await this.applyScheduleUpdate(task, schedulerId, input)
    return this.resolveCalendarRowWithConflicts(
      orgId,
      updated,
      this.resolveCalendarDayRange(this.resolveCalendarScheduledAt(updated)),
    )
  }

  async batchScheduleCalendar(
    orgId: string,
    schedulerId: string,
    input: CalendarBatchScheduleInput,
  ) {
    const ids = Array.from(
      new Set(
        (input.ids || [])
          .map(item => String(item || '').trim())
          .filter(Boolean),
      ),
    )

    if (ids.length === 0) {
      throw new BadRequestException('ids is required')
    }

    const strategy = this.normalizeCalendarStrategy(input.strategy)
    const scheduledItems: CalendarRow[] = []
    const failures: Array<{ id: string, error: string }> = []
    let cursor = this.normalizeBatchScheduleDate(input.startDate, input.time)

    for (const id of ids) {
      if (strategy === 'weekdays') {
        cursor = this.skipWeekend(cursor)
      }

      try {
        const task = await this.getTaskOrFail(orgId, id)
        if (task.status === VideoTaskStatus.PUBLISHED) {
          throw new BadRequestException('Published content cannot be rescheduled')
        }

        const updated = await this.applyScheduleUpdate(task, schedulerId, {
          scheduledAt: cursor.toISOString(),
          platform: input.platform,
          note: `batch:${strategy}`,
        })
        scheduledItems.push(this.toCalendarRow(updated))
      }
      catch (error) {
        failures.push({
          id,
          error: error instanceof Error ? error.message : 'batch_schedule_failed',
        })
      }

      cursor = this.advanceCalendarCursor(cursor, strategy)
    }

    const items = this.annotateCalendarConflicts(scheduledItems)

    return {
      total: ids.length,
      successCount: items.length,
      failureCount: failures.length,
      conflictCount: items.filter(item => item.conflict).length,
      items,
      failures,
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

  async batchDownload(
    orgId: string,
    contentIds: string[],
    format: BatchDownloadFormat = 'links',
  ) {
    if (!Array.isArray(contentIds) || contentIds.length === 0) {
      throw new BadRequestException('ids is required')
    }

    const normalizedFormat = this.normalizeBatchDownloadFormat(format)
    const results = await Promise.allSettled(
      contentIds.map(contentId => this.buildDownloadDescriptor(orgId, contentId)),
    )

    const items = results.map((result, index) =>
      result.status === 'fulfilled'
        ? result.value
        : {
            id: contentIds[index],
            error: result.reason instanceof Error ? result.reason.message : 'download_failed',
          },
    )

    if (normalizedFormat === 'zip') {
      return this.buildDownloadArchive(items)
    }

    return {
      format: 'links',
      items,
      total: items.length,
      successCount: items.filter(item => 'downloadUrl' in item).length,
    }
  }

  async batchUpdate(orgId: string, input: BatchUpdateInput) {
    const ids = Array.from(new Set(input.ids || []))
    if (ids.length === 0) {
      throw new BadRequestException('ids is required')
    }

    if (typeof input.caption === 'string') {
      return this.batchEditCopy(orgId, ids, {
        subtitle: input.caption,
      })
    }

    if (input.status?.trim().toLowerCase() === 'published') {
      const items = await Promise.all(
        ids.map(contentId =>
          this.markPublished(
            orgId,
            contentId,
            'manual',
            `https://mediaclaw.local/content/${contentId}`,
          ),
        ),
      )

      return {
        matchedCount: ids.length,
        modifiedCount: items.length,
        items,
      }
    }

    throw new BadRequestException('caption 或 status=published 至少提供一个')
  }

  async batchApprove(
    orgId: string,
    contentIds: string[],
    reviewerId: string,
    comment?: string,
  ) {
    const ids = Array.from(
      new Set(
        (contentIds || [])
          .map(item => String(item || '').trim())
          .filter(Boolean),
      ),
    )

    if (ids.length === 0) {
      throw new BadRequestException('ids is required')
    }

    const results = await Promise.allSettled(
      ids.map(contentId => this.approveContent(orgId, contentId, reviewerId, comment)),
    )

    const items = results.map<BatchApproveResultItem>((result, index) =>
      result.status === 'fulfilled'
        ? {
            id: ids[index],
            approved: true,
            content: result.value,
          }
        : {
            id: ids[index],
            approved: false,
            error: result.reason instanceof Error ? result.reason.message : 'approve_failed',
          },
    )

    return {
      total: ids.length,
      successCount: items.filter(item => item.approved).length,
      failureCount: items.filter(item => !item.approved).length,
      items,
    }
  }

  async exportContent(orgId: string, format: string, filters: ContentFilters) {
    const normalizedFormat = this.normalizeExportFormat(format)
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

    if (normalizedFormat === 'excel') {
      return {
        format: 'excel',
        fileName: `content-export-${new Date().toISOString()}.xls`,
        mimeType: 'application/vnd.ms-excel',
        data: this.toSpreadsheetXml(rows),
      }
    }

    if (normalizedFormat === 'zip') {
      const exportedAt = new Date().toISOString()
      const bundle = this.buildExportArchive(rows, filters, exportedAt)
      return {
        format: 'zip',
        fileName: `content-export-${exportedAt}.zip`,
        mimeType: 'application/zip',
        encoding: 'base64',
        data: bundle.toString('base64'),
        total: rows.length,
      }
    }

    throw new BadRequestException('format must be csv, excel, json or zip')
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

  async legacyEditCopy(orgId: string, contentId: string, caption?: string) {
    return this.editCopy(
      orgId,
      contentId,
      undefined,
      caption,
    )
  }

  async getDownloadUrl(orgId: string, contentId: string) {
    const task = await this.getTaskOrFail(orgId, contentId)
    return this.resolveDownloadUrl(task, contentId)
  }

  private resolveDownloadUrl(task: Record<string, any>, contentId: string) {
    const outputVideoUrl = String(task['outputVideoUrl'] || '').trim()
    if (!outputVideoUrl) {
      throw new BadRequestException('Content is not ready for download')
    }

    try {
      const url = new URL(outputVideoUrl)
      url.searchParams.set('download', '1')
      if (!url.searchParams.has('filename')) {
        url.searchParams.set('filename', `mediaclaw-${contentId}.mp4`)
      }
      return url.toString()
    }
    catch {
      return outputVideoUrl
    }
  }

  private async buildDownloadDescriptor(orgId: string, contentId: string) {
    const task = await this.getTaskOrFail(orgId, contentId)
    return {
      id: contentId,
      fileName: this.buildVideoFileName(task, contentId),
      downloadUrl: this.resolveDownloadUrl(task, contentId),
      title: task.copy?.title || '',
      status: task.status,
    }
  }

  private async buildDownloadArchive(
    items: Array<Record<string, unknown>>,
  ) {
    const archivedItems: Array<Record<string, unknown>> = []
    const files: Array<{ name: string, data: Buffer | string }> = []

    for (const item of items) {
      const downloadUrl = typeof item['downloadUrl'] === 'string' ? item['downloadUrl'] : ''
      const fileName = typeof item['fileName'] === 'string'
        ? item['fileName']
        : `mediaclaw-${item['id'] || 'content'}.mp4`
      if (!downloadUrl) {
        archivedItems.push(item)
        continue
      }

      try {
        const response = await fetch(downloadUrl)
        if (!response.ok) {
          throw new Error(`download responded with ${response.status}`)
        }

        const arrayBuffer = await response.arrayBuffer()
        files.push({
          name: fileName,
          data: Buffer.from(arrayBuffer),
        })
        archivedItems.push({
          ...item,
          archived: true,
          bytes: arrayBuffer.byteLength,
        })
      }
      catch (error) {
        archivedItems.push({
          ...item,
          archived: false,
          error: error instanceof Error ? error.message : 'download_failed',
        })
      }
    }

    const manifest = {
      exportedAt: new Date().toISOString(),
      total: archivedItems.length,
      successCount: archivedItems.filter(item => item['archived'] === true).length,
      failureCount: archivedItems.filter(item => item['archived'] !== true).length,
      items: archivedItems,
    }
    files.push({
      name: 'manifest.json',
      data: Buffer.from(JSON.stringify(manifest, null, 2)),
    })
    const archiveBuffer = await this.buildZipBuffer(files)

    return {
      format: 'zip',
      fileName: `content-download-${manifest.exportedAt}.zip`,
      mimeType: 'application/zip',
      encoding: 'base64',
      data: archiveBuffer.toString('base64'),
      total: archivedItems.length,
      successCount: manifest.successCount,
      failureCount: manifest.failureCount,
      items: archivedItems,
    }
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

  private buildCalendarQuery(
    orgId: string,
    filters: CalendarFilters,
    range: CalendarRange,
  ) {
    const query: Record<string, unknown> = {
      orgId: this.toObjectId(orgId, 'orgId'),
    }

    if (filters.status && filters.status !== 'all') {
      query['status'] = filters.status
    }

    query['$or'] = [
      {
        'metadata.contentCalendar.scheduledAtDate': {
          $gte: range.start,
          $lte: range.end,
        },
      },
      {
        publishedAt: {
          $gte: range.start,
          $lte: range.end,
        },
      },
      {
        createdAt: {
          $gte: range.start,
          $lte: range.end,
        },
      },
    ]

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

  private toCalendarRow(task: Record<string, any>): CalendarRow {
    const id = task['_id']?.toString() || ''
    const status = String(task['status'] || '').trim()
    const scheduledAt = this.resolveCalendarScheduledAt(task)
    const platform = this.resolveCalendarPlatform(task)

    return {
      id,
      detailId: id,
      title: this.resolveCalendarTitle(task, id),
      brand: this.resolveCalendarBrand(task),
      status,
      rawStatus: status,
      scheduledAt,
      platform,
      publishStatus: String(
        task['metadata']?.['distribution']?.['publishStatus']
        || (status === VideoTaskStatus.PUBLISHED ? 'published' : 'scheduled'),
      ),
      outputVideoUrl: String(task['outputVideoUrl'] || ''),
      canApprove: status === VideoTaskStatus.PENDING_REVIEW,
      approvalStatus: task['approval']?.['lastAction'] || null,
      note: String(task['metadata']?.['contentCalendar']?.['note'] || ''),
      conflict: false,
      conflictCount: 0,
      conflictIds: [],
    }
  }

  private annotateCalendarConflicts(items: CalendarRow[]) {
    const buckets = new Map<string, string[]>()
    for (const item of items) {
      const bucketKey = this.buildCalendarConflictBucket(item.platform, item.scheduledAt)
      if (!bucketKey) {
        continue
      }
      const bucket = buckets.get(bucketKey) || []
      bucket.push(item.id)
      buckets.set(bucketKey, bucket)
    }

    return items.map((item) => {
      const bucketKey = this.buildCalendarConflictBucket(item.platform, item.scheduledAt)
      const bucket = bucketKey ? buckets.get(bucketKey) || [] : []
      const conflictIds = bucket.filter(id => id !== item.id)
      return {
        ...item,
        conflict: conflictIds.length > 0,
        conflictCount: conflictIds.length,
        conflictIds,
      }
    })
  }

  private buildCalendarConflictBucket(platform: string, scheduledAt: string) {
    if (!scheduledAt) {
      return null
    }
    const scheduledDate = new Date(scheduledAt)
    if (Number.isNaN(scheduledDate.getTime())) {
      return null
    }

    return [
      platform || 'unspecified',
      scheduledDate.getUTCFullYear(),
      String(scheduledDate.getUTCMonth() + 1).padStart(2, '0'),
      String(scheduledDate.getUTCDate()).padStart(2, '0'),
      String(scheduledDate.getUTCHours()).padStart(2, '0'),
    ].join(':')
  }

  private resolveCalendarTitle(task: Record<string, any>, id: string) {
    return String(
      task['copy']?.['title']
      || task['copy']?.['subtitle']
      || task['metadata']?.['title']
      || `内容 ${id.slice(-6)}`,
    )
  }

  private resolveCalendarBrand(task: Record<string, any>) {
    return String(
      task['metadata']?.['brandName']
      || task['metadata']?.['brand']?.['name']
      || task['brandName']
      || '',
    )
  }

  private resolveCalendarPlatform(task: Record<string, any>) {
    return String(
      task['metadata']?.['contentCalendar']?.['platform']
      || task['metadata']?.['publishInfo']?.['platform']
      || 'unspecified',
    )
  }

  private resolveCalendarScheduledAt(task: Record<string, any>) {
    const scheduledAt = task['metadata']?.['contentCalendar']?.['scheduledAt']
      || task['publishedAt']
      || task['metadata']?.['publishedAt']
      || task['createdAt']

    const normalized = new Date(scheduledAt)
    if (Number.isNaN(normalized.getTime())) {
      return new Date().toISOString()
    }

    return normalized.toISOString()
  }

  private resolveCalendarRange(filters: CalendarFilters): CalendarRange {
    if (filters.startDate || filters.endDate) {
      const start = filters.startDate
        ? this.parseCalendarBoundary(filters.startDate, 'start')
        : this.parseCalendarBoundary(new Date().toISOString(), 'start')
      const end = filters.endDate
        ? this.parseCalendarBoundary(filters.endDate, 'end')
        : this.parseCalendarBoundary(start.toISOString(), 'end')
      return { start, end }
    }

    if (filters.month) {
      const [yearText, monthText] = String(filters.month).split('-')
      const year = Number(yearText)
      const month = Number(monthText)
      if (Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12) {
        return {
          start: new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0)),
          end: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)),
        }
      }
    }

    const current = new Date()
    return {
      start: new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1, 0, 0, 0, 0)),
      end: new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 0, 23, 59, 59, 999)),
    }
  }

  private resolveCalendarDayRange(scheduledAt: string): CalendarRange {
    const target = new Date(scheduledAt)
    const start = new Date(Date.UTC(
      target.getUTCFullYear(),
      target.getUTCMonth(),
      target.getUTCDate(),
      0,
      0,
      0,
      0,
    ))
    const end = new Date(Date.UTC(
      target.getUTCFullYear(),
      target.getUTCMonth(),
      target.getUTCDate(),
      23,
      59,
      59,
      999,
    ))
    return {
      start,
      end,
    }
  }

  private async resolveCalendarRowWithConflicts(
    orgId: string,
    task: Record<string, any>,
    range: CalendarRange,
  ) {
    const query = this.buildCalendarQuery(orgId, {}, range)
    const related = await this.videoTaskModel.find(query).lean().exec()
    const items = this.annotateCalendarConflicts(related.map(item => this.toCalendarRow(item)))
    return items.find(item => item.id === task['_id']?.toString()) || this.toCalendarRow(task)
  }

  private async applyScheduleUpdate(
    task: Record<string, any>,
    schedulerId: string,
    input: CalendarScheduleInput,
  ) {
    const scheduledAt = this.normalizeCalendarScheduleTimestamp(input.scheduledAt)
    const scheduleDate = new Date(scheduledAt)
    const platform = String(input.platform || this.resolveCalendarPlatform(task)).trim() || 'unspecified'
    const note = String(input.note || '').trim()
    const scheduledBy = schedulerId || task['userId'] || ''
    const now = new Date()
    const existingTimeline = Array.isArray(task['metadata']?.['timeline'])
      ? task['metadata']['timeline']
      : []

    const updated = await this.videoTaskModel.findByIdAndUpdate(
      task['_id'],
      {
        $set: {
          'metadata.contentCalendar': {
            scheduledAt,
            scheduledAtDate: scheduleDate,
            platform,
            note,
            lastScheduledAt: now.toISOString(),
            lastScheduledBy: scheduledBy,
          },
          'metadata.distribution.publishStatus': task['status'] === VideoTaskStatus.PUBLISHED
            ? 'published'
            : (task['metadata']?.['distribution']?.['publishStatus'] || 'scheduled'),
        },
        $push: {
          'metadata.timeline': this.createTimelineEntry(
            'scheduled',
            now,
            `Content scheduled for ${platform}`,
            task['status'],
          ),
          'iterationLog': createStatusTransitionIterationEntry(task['iterationLog'] as Array<Record<string, any>> || [], {
            fromStatus: task['status'],
            toStatus: task['status'],
            timestamp: now,
            detail: {
              source: 'content-calendar',
              action: 'schedule',
              scheduledAt,
              platform,
              timelineSize: existingTimeline.length + 1,
            },
          }),
        },
      },
      { new: true },
    ).lean().exec()

    if (!updated) {
      throw new NotFoundException('Content not found')
    }

    return updated
  }

  private normalizeCalendarScheduleTimestamp(value: string) {
    const normalized = new Date(value)
    if (Number.isNaN(normalized.getTime())) {
      throw new BadRequestException('scheduledAt is invalid')
    }
    return normalized.toISOString()
  }

  private normalizeBatchScheduleDate(dateText: string, timeText?: string) {
    const rawDate = String(dateText || '').trim()
    if (!rawDate) {
      throw new BadRequestException('startDate is required')
    }

    const normalizedTime = String(timeText || '10:00').trim() || '10:00'
    const combined = rawDate.includes('T') ? rawDate : `${rawDate}T${normalizedTime}:00.000Z`
    const normalized = new Date(combined)
    if (Number.isNaN(normalized.getTime())) {
      throw new BadRequestException('startDate is invalid')
    }
    return normalized
  }

  private normalizeCalendarStrategy(strategy?: string) {
    return strategy === 'weekdays' ? 'weekdays' : 'daily'
  }

  private parseCalendarBoundary(value: string, boundary: 'start' | 'end') {
    const text = String(value || '').trim()
    const dateOnlyMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (dateOnlyMatch) {
      const [, yearText, monthText, dayText] = dateOnlyMatch
      return new Date(Date.UTC(
        Number(yearText),
        Number(monthText) - 1,
        Number(dayText),
        boundary === 'start' ? 0 : 23,
        boundary === 'start' ? 0 : 59,
        boundary === 'start' ? 0 : 59,
        boundary === 'start' ? 0 : 999,
      ))
    }

    const normalized = new Date(text)
    if (Number.isNaN(normalized.getTime())) {
      throw new BadRequestException(`${boundary === 'start' ? 'startDate' : 'endDate'} is invalid`)
    }

    return normalized
  }

  private skipWeekend(date: Date) {
    const next = new Date(date)
    while (next.getUTCDay() === 0 || next.getUTCDay() === 6) {
      next.setUTCDate(next.getUTCDate() + 1)
    }
    return next
  }

  private advanceCalendarCursor(date: Date, strategy: 'daily' | 'weekdays') {
    const next = new Date(date)
    next.setUTCDate(next.getUTCDate() + 1)
    return strategy === 'weekdays' ? this.skipWeekend(next) : next
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

  private toSpreadsheetXml(rows: Array<Record<string, any>>) {
    const headers = [
      'ID',
      '组织',
      '品牌',
      '管线',
      '用户',
      '任务类型',
      '状态',
      '标题',
      '副标题',
      '话题标签',
      '蓝词',
      '评论引导',
      '发布平台',
      '发布链接',
      '发布状态',
      '创建时间',
      '更新时间',
    ]
    const tableRows = rows.map(row => [
      row['id'],
      row['orgId'],
      row['brandId'],
      row['pipelineId'],
      row['userId'],
      row['taskType'],
      row['status'],
      row['copy']?.['title'] || '',
      row['copy']?.['subtitle'] || '',
      Array.isArray(row['copy']?.['hashtags']) ? row['copy']['hashtags'].join(' | ') : '',
      Array.isArray(row['copy']?.['blueWords']) ? row['copy']['blueWords'].join(' | ') : '',
      Array.isArray(row['copy']?.['commentGuides']) ? row['copy']['commentGuides'].join(' | ') : '',
      row['publishInfo']?.['platform'] || '',
      row['publishInfo']?.['publishUrl'] || '',
      row['publishStatus'] || '',
      row['createdAt'] instanceof Date ? row['createdAt'].toISOString() : row['createdAt'] || '',
      row['updatedAt'] instanceof Date ? row['updatedAt'].toISOString() : row['updatedAt'] || '',
    ])

    const rowsXml = [headers, ...tableRows]
      .map(columns => `<Row>${columns.map(column => `<Cell><Data ss:Type="String">${this.escapeXmlValue(column)}</Data></Cell>`).join('')}</Row>`)
      .join('')

    return [
      '<?xml version="1.0"?>',
      '<?mso-application progid="Excel.Sheet"?>',
      '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">',
      '<Worksheet ss:Name="MediaClawExport">',
      '<Table>',
      rowsXml,
      '</Table>',
      '</Worksheet>',
      '</Workbook>',
    ].join('')
  }

  private buildExportArchive(
    rows: Array<Record<string, any>>,
    filters: ContentFilters,
    exportedAt: string,
  ) {
    const zip = new AdmZip()
    zip.addFile('content-export.json', Buffer.from(JSON.stringify(rows, null, 2)))
    zip.addFile('content-export.csv', Buffer.from(this.toCsv(rows)))
    zip.addFile('content-export.xls', Buffer.from(this.toSpreadsheetXml(rows)))
    zip.addFile(
      'manifest.json',
      Buffer.from(
        JSON.stringify(
          {
            exportedAt,
            total: rows.length,
            filters,
            includedFiles: ['content-export.json', 'content-export.csv', 'content-export.xls'],
          },
          null,
          2,
        ),
      ),
    )

    return zip.toBuffer()
  }

  private async buildZipBuffer(files: Array<{ name: string, data: Buffer | string }>) {
    const archive = archiver('zip', {
      zlib: { level: 9 },
    })
    const output = new PassThrough()
    const chunks: Buffer[] = []

    const completion = new Promise<Buffer>((resolve, reject) => {
      output.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      })
      output.on('end', () => resolve(Buffer.concat(chunks)))
      output.on('error', reject)
      archive.on('error', reject)
    })

    archive.pipe(output)

    for (const file of files) {
      archive.append(file.data, { name: file.name })
    }

    archive.finalize()
    return completion
  }

  private escapeCsvValue(value: unknown) {
    const text = String(value ?? '')
    if (!text.includes(',') && !text.includes('"') && !text.includes('\n')) {
      return text
    }
    return `"${text.replace(/"/g, '""')}"`
  }

  private escapeXmlValue(value: unknown) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
  }

  private buildVideoFileName(task: Record<string, any>, contentId: string) {
    const title = this.sanitizeFileNameSegment(task['copy']?.['title'])
      || this.sanitizeFileNameSegment(task['copy']?.['subtitle'])
      || `mediaclaw-${contentId}`

    return `${title}.mp4`
  }

  private sanitizeFileNameSegment(value: unknown) {
    return String(value ?? '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^\w\u4E00-\u9FA5.-]/g, '')
      .replace(/-+/g, '-')
      .slice(0, 64)
  }

  private normalizeBatchDownloadFormat(format?: string): BatchDownloadFormat {
    return format === 'zip' ? 'zip' : 'links'
  }

  private normalizeExportFormat(format: string): ExportContentFormat {
    const normalized = String(format || '').trim().toLowerCase()
    if (normalized === 'json' || normalized === 'csv' || normalized === 'excel' || normalized === 'zip') {
      return normalized
    }

    throw new BadRequestException('format must be csv, excel, json or zip')
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
      return [UserRole.ENTERPRISE_ADMIN]
    }

    if (level === 1) {
      return [UserRole.OPERATOR, UserRole.ENTERPRISE_ADMIN]
    }

    return [UserRole.ENTERPRISE_ADMIN]
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
