import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { NotificationType, UserType } from '@yikart/common'
import { MailService } from '@yikart/mail'
import {
  DiscoveryNotification,
  Notification,
  NotificationChannel,
  NotificationConfig,
  NotificationEvent,
  NotificationStatus,
} from '@yikart/mongodb'
import { Model, Types } from 'mongoose'
import { MediaclawConfigService } from '../mediaclaw-config.service'

interface NotificationConfigInput {
  channel: NotificationChannel
  name?: string
  events?: NotificationEvent[]
  config?: Record<string, unknown>
  isActive?: boolean
}

interface NotificationConfigRecord {
  _id: { toString: () => string }
  orgId: { toString: () => string }
  channel: NotificationChannel
  name?: string
  config?: Record<string, unknown>
  events?: NotificationEvent[]
  isActive?: boolean
  [key: string]: unknown
}

interface NotificationListItem {
  id: string
  source: 'task' | 'discovery'
  event: NotificationEvent
  notificationType: NotificationType | null
  title: string
  content: string
  status: string
  relatedId: string
  createdAt: Date
  data: Record<string, unknown>
}

interface PersistedEventNotification {
  id: string
  relatedId: string
  type: NotificationType
  title: string
  content: string
  status: NotificationStatus
  createdAt?: Date
}

interface EventNotificationDraft {
  type: NotificationType
  title: string
  content: string
  relatedId: string
}

type NotificationDeliveryResult =
  | {
      id: string
      channel: NotificationChannel
      delivered: true
      statusCode?: number
      target?: string
      recipients?: string[]
      subject?: string
    }
  | {
      id: string
      channel: NotificationChannel
      delivered: false
      reason: string
      skipped?: boolean
    }

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name)

  constructor(
    @InjectModel(NotificationConfig.name)
    private readonly notificationConfigModel: Model<NotificationConfig>,
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<Notification>,
    @InjectModel(DiscoveryNotification.name)
    private readonly discoveryNotificationModel: Model<DiscoveryNotification>,
    private readonly mailService: MailService,
    private readonly configService: MediaclawConfigService,
  ) {}

  async createConfig(orgId: string, data: NotificationConfigInput) {
    const created = await this.notificationConfigModel.create({
      orgId: this.toObjectId(orgId, 'orgId'),
      channel: data.channel,
      name: this.normalizeConfigName(data.name, data.channel),
      events: this.normalizeEvents(data.events),
      config: data.config || {},
      isActive: data.isActive ?? true,
    })

    return this.toResponse(created.toObject())
  }

  async listConfigs(orgId: string) {
    const configs = await this.notificationConfigModel.find({
      orgId: this.toObjectId(orgId, 'orgId'),
    }).sort({ createdAt: -1 }).lean().exec()

    return configs.map(config => this.toResponse(config))
  }

  async listNotifications(ownerId: string, pageInput?: number, limitInput?: number) {
    const ownerObjectId = this.toObjectId(ownerId, 'ownerId')
    const page = this.normalizePage(pageInput)
    const limit = this.normalizeLimit(limitInput)
    const fetchCount = page * limit

    const [taskNotifications, taskTotal, discoveryNotifications, discoveryTotal] = await Promise.all([
      this.notificationModel.find({
        userId: ownerObjectId,
        $or: [
          { deletedAt: { $exists: false } },
          { deletedAt: null },
        ],
      })
        .sort({ createdAt: -1 })
        .limit(fetchCount)
        .lean()
        .exec(),
      this.notificationModel.countDocuments({
        userId: ownerObjectId,
        $or: [
          { deletedAt: { $exists: false } },
          { deletedAt: null },
        ],
      }),
      this.discoveryNotificationModel.find({
        orgId: ownerObjectId,
      })
        .sort({ notifiedAt: -1, createdAt: -1 })
        .limit(fetchCount)
        .lean()
        .exec(),
      this.discoveryNotificationModel.countDocuments({
        orgId: ownerObjectId,
      }),
    ])

    const merged = [
      ...taskNotifications.map(notification => this.toTaskNotificationItem(notification)),
      ...discoveryNotifications.map(notification => this.toDiscoveryNotificationItem(notification)),
    ].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())

    const skip = (page - 1) * limit
    return {
      items: merged.slice(skip, skip + limit).map(item => ({
        ...item,
        createdAt: item.createdAt,
      })),
      total: taskTotal + discoveryTotal,
      page,
      limit,
    }
  }

  async getConfig(orgId: string, id: string) {
    const config = await this.notificationConfigModel.findOne(this.buildOwnedQuery(orgId, id)).lean().exec()
    if (!config) {
      throw new NotFoundException('Notification config not found')
    }

    return this.toResponse(config)
  }

  async updateConfig(orgId: string, id: string, data: Partial<NotificationConfigInput>) {
    const payload: Record<string, unknown> = {}

    if ('channel' in data && data.channel) {
      payload['channel'] = data.channel
    }

    if ('name' in data) {
      payload['name'] = this.normalizeConfigName(
        data.name,
        data.channel || undefined,
      )
    }

    if ('events' in data) {
      payload['events'] = this.normalizeEvents(data.events)
    }

    if ('config' in data) {
      payload['config'] = data.config || {}
    }

    if ('isActive' in data && typeof data.isActive === 'boolean') {
      payload['isActive'] = data.isActive
    }

    const updated = await this.notificationConfigModel.findOneAndUpdate(this.buildOwnedQuery(orgId, id), payload, {
      new: true,
    }).lean().exec()

    if (!updated) {
      throw new NotFoundException('Notification config not found')
    }

    return this.toResponse(updated)
  }

  async deleteConfig(orgId: string, id: string) {
    const deleted = await this.notificationConfigModel.findOneAndDelete(this.buildOwnedQuery(orgId, id)).lean().exec()
    if (!deleted) {
      throw new NotFoundException('Notification config not found')
    }

    return {
      id,
      deleted: true,
    }
  }

  async send(orgId: string, event: NotificationEvent, payload: Record<string, unknown>) {
    return this.sendNotification(orgId, event, payload)
  }

  async sendNotification(orgId: string, event: NotificationEvent, payload: Record<string, unknown>) {
    let persisted: PersistedEventNotification | null = null

    try {
      persisted = await this.persistEventNotification(orgId, event, payload)
    }
    catch (error) {
      this.logger.warn(`Notification persistence failed for ${event}: ${error instanceof Error ? error.message : String(error)}`)
    }

    const orgObjectId = this.toMaybeObjectId(orgId)
    if (!orgObjectId) {
      return {
        orgId,
        event,
        persisted,
        total: 0,
        delivered: 0,
        results: [],
      }
    }

    const configs = await this.notificationConfigModel.find({
      orgId: orgObjectId,
      isActive: true,
      events: event,
    }).lean().exec()

    const results = await Promise.all(
      configs.map(config => this.deliver(config as NotificationConfigRecord, event, payload, false)),
    )

    return {
      orgId,
      event,
      persisted,
      total: results.length,
      delivered: results.filter(result => result.delivered).length,
      results,
    }
  }

  async testConfig(orgId: string, id: string) {
    const config = await this.notificationConfigModel.findOne(this.buildOwnedQuery(orgId, id)).lean().exec()
    if (!config) {
      throw new NotFoundException('Notification config not found')
    }

    const events = Array.isArray(config['events']) ? config['events'] : []
    const event = events[0] || NotificationEvent.TASK_COMPLETED
    const payload = {
      test: true,
      event,
      message: 'Notification config test',
      testedAt: new Date().toISOString(),
    }
    const result = await this.deliver(config as NotificationConfigRecord, event, payload, true)
    const success = result.delivered || ('reason' in result && result.reason === 'smtp_not_configured')

    return {
      success,
      ...result,
    }
  }

  async persistEventNotification(orgId: string, event: NotificationEvent, payload: Record<string, unknown>) {
    if (event === NotificationEvent.DISCOVERY_VIRAL_ALERT) {
      return null
    }

    const ownerObjectId = this.toMaybeObjectId(orgId)
    if (!ownerObjectId) {
      return null
    }

    const draft = this.buildEventNotificationDraft(event, payload, orgId)
    if (!draft) {
      return null
    }

    const created = await this.notificationModel.create({
      userId: ownerObjectId,
      userType: UserType.User,
      title: draft.title,
      content: draft.content,
      type: draft.type,
      status: NotificationStatus.Unread,
      relatedId: draft.relatedId,
      data: {
        event,
        payload,
      },
    })

    const notification = created.toObject()
    return {
      id: notification._id.toString(),
      relatedId: notification.relatedId,
      type: notification.type,
      title: notification.title,
      content: notification.content,
      status: notification.status,
      createdAt: notification.createdAt,
    }
  }

  private async deliver(
    config: NotificationConfigRecord,
    event: NotificationEvent,
    payload: Record<string, unknown>,
    isTest: boolean,
  ): Promise<NotificationDeliveryResult> {
    try {
      switch (config.channel) {
        case NotificationChannel.WEBHOOK:
          return await this.sendWebhook(config, event, payload, isTest)
        case NotificationChannel.EMAIL:
          return await this.sendEmail(config, event, payload, isTest)
        default:
          return {
            id: config._id.toString(),
            channel: config.channel,
            delivered: false,
            reason: 'unsupported_channel',
          }
      }
    }
    catch (error) {
      this.logger.warn(`Notification delivery failed for config ${config['_id']?.toString?.() || 'unknown'}: ${error instanceof Error ? error.message : String(error)}`)
      return {
        id: config['_id'].toString(),
        channel: config['channel'],
        delivered: false,
        reason: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private async sendWebhook(
    config: NotificationConfigRecord,
    event: NotificationEvent,
    payload: Record<string, unknown>,
    isTest: boolean,
  ): Promise<NotificationDeliveryResult> {
    const configData = this.readRecord(config['config']) || {}
    const url = this.pickString(configData, ['url', 'webhookUrl'])
    if (!url) {
      throw new BadRequestException('Webhook notification config requires url')
    }

    const headers = {
      'Content-Type': 'application/json',
      ...(this.readRecord(configData['headers']) || {}),
    }
    const body = {
      orgId: config['orgId']?.toString?.() || '',
      configId: config['_id'].toString(),
      event,
      channel: config['channel'],
      isTest,
      payload,
      ...(this.readRecord(configData['payload']) || {}),
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    })

    if (!response.ok) {
      throw new Error(`Webhook returned ${response.status}`)
    }

    return {
      id: config['_id'].toString(),
      channel: config['channel'],
      delivered: true,
      statusCode: response.status,
      target: url,
    }
  }

  private async sendEmail(
    config: NotificationConfigRecord,
    event: NotificationEvent,
    payload: Record<string, unknown>,
    isTest: boolean,
  ): Promise<NotificationDeliveryResult> {
    if (!this.isSmtpConfigured()) {
      return {
        id: config['_id'].toString(),
        channel: config['channel'],
        delivered: false,
        skipped: true,
        reason: 'smtp_not_configured',
      }
    }

    const configData = this.readRecord(config['config']) || {}
    const to = this.normalizeRecipients(configData['to'])
    if (to.length === 0) {
      throw new BadRequestException('Email notification config requires at least one recipient')
    }

    const context = {
      orgId: config['orgId']?.toString?.() || '',
      configId: config['_id'].toString(),
      event,
      isTest,
      payload,
    }

    const subjectTemplate = this.pickString(configData, ['subject']) || '[MediaClaw] {{event}}'
    const subject = this.interpolate(subjectTemplate, context)
    const textTemplate = this.pickString(configData, ['text'])
    const htmlTemplate = this.pickString(configData, ['html'])
    const text = textTemplate
      ? this.interpolate(textTemplate, context)
      : JSON.stringify(context, null, 2)
    const html = htmlTemplate
      ? this.interpolate(htmlTemplate, context)
      : `<pre>${this.escapeHtml(JSON.stringify(context, null, 2))}</pre>`

    const delivered = await this.mailService.sendEmail({
      to,
      cc: this.normalizeRecipients(configData['cc']),
      bcc: this.normalizeRecipients(configData['bcc']),
      from: this.pickString(configData, ['from']) || undefined,
      replyTo: this.pickString(configData, ['replyTo']) || undefined,
      subject,
      text,
      html,
    })

    if (!delivered) {
      throw new Error('Mail delivery failed')
    }

    return {
      id: config['_id'].toString(),
      channel: config['channel'],
      delivered: true,
      recipients: to,
      subject,
    }
  }

  private buildEventNotificationDraft(
    event: NotificationEvent,
    payload: Record<string, unknown>,
    fallbackRelatedId: string,
  ): EventNotificationDraft | null {
    const relatedId = this.pickPayloadString(payload, ['contentId', 'taskId', 'relatedId']) || fallbackRelatedId
    const status = this.pickPayloadString(payload, ['status'])
    const platform = this.pickPayloadString(payload, ['platform'])
    const comment = this.pickPayloadString(payload, ['comment'])
    const errorMessage = this.pickPayloadString(payload, ['errorMessage'])

    switch (event) {
      case NotificationEvent.TASK_COMPLETED:
        return {
          type: NotificationType.TaskSettled,
          title: '任务已完成',
          content: `任务 ${this.describeRelatedId(relatedId)} 已完成，可进入审核或分发。`,
          relatedId,
        }
      case NotificationEvent.TASK_FAILED:
        return {
          type: NotificationType.TaskReminder,
          title: '任务执行失败',
          content: errorMessage
            ? `任务 ${this.describeRelatedId(relatedId)} 执行失败：${errorMessage}`
            : `任务 ${this.describeRelatedId(relatedId)} 执行失败，请检查处理日志。`,
          relatedId,
        }
      case NotificationEvent.CONTENT_PENDING_REVIEW:
        return {
          type: NotificationType.TaskSubmitted,
          title: '内容待审核',
          content: `内容 ${this.describeRelatedId(relatedId)} 已提交审核${status ? `，当前状态 ${status}` : ''}。`,
          relatedId,
        }
      case NotificationEvent.CONTENT_APPROVED:
        return {
          type: NotificationType.TaskReviewApproved,
          title: '内容审核通过',
          content: `内容 ${this.describeRelatedId(relatedId)} 已审核通过，可继续发布。`,
          relatedId,
        }
      case NotificationEvent.CONTENT_REJECTED:
        return {
          type: NotificationType.TaskReviewRejected,
          title: '内容审核未通过',
          content: `内容 ${this.describeRelatedId(relatedId)} 未通过审核${comment ? `：${comment}` : '。'}`,
          relatedId,
        }
      case NotificationEvent.CONTENT_CHANGES_REQUESTED:
        return {
          type: NotificationType.TaskReviewRejected,
          title: '内容需要修改',
          content: `内容 ${this.describeRelatedId(relatedId)} 被要求修改${comment ? `：${comment}` : '。'}`,
          relatedId,
        }
      case NotificationEvent.CONTENT_PUBLISHED:
        return {
          type: NotificationType.TaskSettled,
          title: '内容已发布',
          content: `内容 ${this.describeRelatedId(relatedId)} 已发布${platform ? ` 到 ${platform}` : ''}。`,
          relatedId,
        }
      case NotificationEvent.TOKEN_QUOTA_WARNING: {
        const usageRate = this.pickPayloadString(payload, ['usageRate'])
        const usedTokens = this.pickPayloadString(payload, ['usedTokens'])
        const totalTokens = this.pickPayloadString(payload, ['totalTokens'])
        return {
          type: NotificationType.TaskReminder,
          title: '对话 Token 即将用完',
          content: `本月对话 Token 已使用 ${usageRate || '80'}%，当前 ${usedTokens || '--'} / ${totalTokens || '--'}。建议评估是否升级套餐或切换到 BYOK。`,
          relatedId,
        }
      }
      case NotificationEvent.TOKEN_QUOTA_EXCEEDED: {
        const usedTokens = this.pickPayloadString(payload, ['usedTokens'])
        const totalTokens = this.pickPayloadString(payload, ['totalTokens'])
        return {
          type: NotificationType.TaskReminder,
          title: '本月对话 Token 已超额',
          content: `本月对话 Token 已达到或超过配额，当前 ${usedTokens || '--'} / ${totalTokens || '--'}。系统不会阻断使用，但建议尽快升级或改为 BYOK。`,
          relatedId,
        }
      }
      default:
        return null
    }
  }

  private toTaskNotificationItem(notification: Record<string, unknown>): NotificationListItem {
    const payload = this.readRecord(notification['data'])?.['payload']
    const id = this.toStringValue(notification['_id'], this.toStringValue(notification['id']))
    return {
      id,
      source: 'task',
      event: this.normalizeNotificationEvent(this.readRecord(notification['data'])?.['event']),
      notificationType: this.normalizeNotificationType(notification['type']),
      title: this.toStringValue(notification['title']),
      content: this.toStringValue(notification['content']),
      status: this.toStringValue(notification['status'], NotificationStatus.Unread),
      relatedId: this.toStringValue(notification['relatedId']),
      createdAt: this.toDate(notification['createdAt']),
      data: this.readRecord(payload) || this.readRecord(notification['data']) || {},
    }
  }

  private toDiscoveryNotificationItem(notification: Record<string, unknown>): NotificationListItem {
    const id = this.toStringValue(notification['_id'], this.toStringValue(notification['id']))
    return {
      id,
      source: 'discovery',
      event: NotificationEvent.DISCOVERY_VIRAL_ALERT,
      notificationType: null,
      title: this.toStringValue(notification['title']),
      content: this.toStringValue(notification['summary']),
      status: this.toStringValue(notification['status'], 'pending'),
      relatedId: id,
      createdAt: this.toDate(notification['notifiedAt'] || notification['createdAt']),
      data: {
        industry: this.toStringValue(notification['industry']),
        platform: this.toStringValue(notification['platform']),
        itemCount: this.toNumberValue(notification['itemCount']),
        topItems: Array.isArray(notification['topItems']) ? notification['topItems'] : [],
      },
    }
  }

  private normalizeEvents(events?: NotificationEvent[]) {
    return [...new Set((events || []).filter(Boolean))]
  }

  private normalizeRecipients(value: unknown) {
    if (Array.isArray(value)) {
      return value
        .map(item => typeof item === 'string' ? item.trim() : '')
        .filter(Boolean)
    }

    if (typeof value === 'string' && value.trim()) {
      return value.split(/[;,]/).map(item => item.trim()).filter(Boolean)
    }

    return []
  }

  private buildOwnedQuery(orgId: string, id: string) {
    return {
      _id: this.toObjectId(id, 'id'),
      orgId: this.toObjectId(orgId, 'orgId'),
    }
  }

  private isSmtpConfigured() {
    return this.configService.has([
      'SMTP_HOST',
      'MEDIACLAW_SMTP_HOST',
      'SMTP_FROM',
      'MEDIACLAW_SMTP_FROM',
    ])
  }

  private pickString(source: Record<string, unknown> | undefined, keys: string[]) {
    for (const key of keys) {
      const value = source?.[key]
      if (typeof value === 'string' && value.trim()) {
        return value.trim()
      }
    }

    return ''
  }

  private pickPayloadString(payload: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
      const value = payload[key]
      if (typeof value === 'string' && value.trim()) {
        return value.trim()
      }
      if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value)
      }
    }

    return ''
  }

  private readRecord(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
  }

  private interpolate(template: string, context: Record<string, unknown>) {
    return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, rawPath: string) => {
      const value = this.readContextValue(context, rawPath)
      if (value === null || value === undefined) {
        return ''
      }

      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return String(value)
      }

      return JSON.stringify(value)
    })
  }

  private readContextValue(context: Record<string, unknown>, path: string) {
    return path.split('.').reduce<unknown>((current, segment) => {
      if (current && typeof current === 'object') {
        return (current as Record<string, unknown>)[segment]
      }
      return undefined
    }, context)
  }

  private escapeHtml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  }

  private toResponse(config: {
    _id: { toString: () => string }
    orgId: { toString: () => string }
    channel: NotificationChannel
    name?: string
    events: NotificationEvent[]
    config?: Record<string, unknown>
    isActive: boolean
    createdAt?: Date
    updatedAt?: Date
  }) {
    return {
      id: config._id.toString(),
      orgId: config.orgId.toString(),
      channel: config.channel,
      name: this.normalizeConfigName(config.name, config.channel),
      events: config.events,
      config: config.config || {},
      isActive: config.isActive,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    }
  }

  private toObjectId(value: string, field: string) {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`${field} is invalid`)
    }

    return new Types.ObjectId(value)
  }

  private toMaybeObjectId(value: string | null | undefined) {
    if (!value || !Types.ObjectId.isValid(value)) {
      return null
    }

    return new Types.ObjectId(value)
  }

  private normalizePage(page?: number) {
    return Math.max(1, Math.trunc(Number(page) || 1))
  }

  private normalizeLimit(limit?: number) {
    return Math.max(1, Math.min(Math.trunc(Number(limit) || 20), 100))
  }

  private toDate(value: unknown) {
    if (value instanceof Date) {
      return value
    }

    const normalized = typeof value === 'string' || typeof value === 'number'
      ? new Date(value)
      : null

    return normalized && !Number.isNaN(normalized.getTime()) ? normalized : new Date(0)
  }

  private toStringValue(value: unknown, fallback = '') {
    if (typeof value === 'string') {
      const normalized = value.trim()
      return normalized || fallback
    }

    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
      return String(value)
    }

    if (value && typeof value === 'object' && typeof (value as { toString?: () => string }).toString === 'function') {
      const normalized = (value as { toString: () => string }).toString().trim()
      return normalized && normalized !== '[object Object]' ? normalized : fallback
    }

    return fallback
  }

  private toNumberValue(value: unknown, fallback = 0) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }

    if (typeof value === 'string' && value.trim()) {
      const normalized = Number(value)
      return Number.isFinite(normalized) ? normalized : fallback
    }

    return fallback
  }

  private normalizeNotificationType(value: unknown) {
    return Object.values(NotificationType).includes(value as NotificationType)
      ? value as NotificationType
      : null
  }

  private normalizeNotificationEvent(value: unknown) {
    return Object.values(NotificationEvent).includes(value as NotificationEvent)
      ? value as NotificationEvent
      : NotificationEvent.TASK_COMPLETED
  }

  private normalizeConfigName(name: string | undefined, channel?: NotificationChannel) {
    if (typeof name === 'string' && name.trim()) {
      return name.trim()
    }

    return channel ? channel.toUpperCase() : 'SYSTEM'
  }

  private describeRelatedId(value: string) {
    if (!value) {
      return '未命名对象'
    }

    return value.length > 12 ? value.slice(-12) : value
  }
}
