import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { MailService } from '@yikart/mail'
import {
  NotificationChannel,
  NotificationConfig,
  NotificationEvent,
} from '@yikart/mongodb'
import { Model, Types } from 'mongoose'

interface NotificationConfigInput {
  channel: NotificationChannel
  events?: NotificationEvent[]
  config?: Record<string, any>
  isActive?: boolean
}

interface NotificationConfigRecord {
  _id: { toString: () => string }
  orgId: { toString: () => string }
  channel: NotificationChannel
  config?: Record<string, any>
  events?: NotificationEvent[]
  isActive?: boolean
  [key: string]: any
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
    private readonly mailService: MailService,
  ) {}

  async createConfig(orgId: string, data: NotificationConfigInput) {
    const created = await this.notificationConfigModel.create({
      orgId: new Types.ObjectId(orgId),
      channel: data.channel,
      events: this.normalizeEvents(data.events),
      config: data.config || {},
      isActive: data.isActive ?? true,
    })

    return this.toResponse(created.toObject())
  }

  async listConfigs(orgId: string) {
    const configs = await this.notificationConfigModel.find({
      orgId: new Types.ObjectId(orgId),
    }).sort({ createdAt: -1 }).lean().exec()

    return configs.map(config => this.toResponse(config))
  }

  async getConfig(orgId: string, id: string) {
    const config = await this.notificationConfigModel.findOne(this.buildOwnedQuery(orgId, id)).lean().exec()
    if (!config) {
      throw new NotFoundException('Notification config not found')
    }

    return this.toResponse(config)
  }

  async updateConfig(orgId: string, id: string, data: Partial<NotificationConfigInput>) {
    const payload: Record<string, any> = {}

    if ('channel' in data && data.channel) {
      payload['channel'] = data.channel
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

  async send(orgId: string, event: NotificationEvent, payload: Record<string, any>) {
    return this.sendNotification(orgId, event, payload)
  }

  async sendNotification(orgId: string, event: NotificationEvent, payload: Record<string, any>) {
    const configs = await this.notificationConfigModel.find({
      orgId: new Types.ObjectId(orgId),
      isActive: true,
      events: event,
    }).lean().exec()

    const results = await Promise.all(
      configs.map(config => this.deliver(config as NotificationConfigRecord, event, payload, false)),
    )

    return {
      orgId,
      event,
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

  private async deliver(
    config: NotificationConfigRecord,
    event: NotificationEvent,
    payload: Record<string, any>,
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
    payload: Record<string, any>,
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
    payload: Record<string, any>,
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
      _id: new Types.ObjectId(id),
      orgId: new Types.ObjectId(orgId),
    }
  }

  private isSmtpConfigured() {
    return Boolean(
      process.env['SMTP_HOST']
      || process.env['MEDIACLAW_SMTP_HOST']
      || process.env['SMTP_FROM']
      || process.env['MEDIACLAW_SMTP_FROM'],
    )
  }

  private pickString(source: Record<string, any> | undefined, keys: string[]) {
    for (const key of keys) {
      const value = source?.[key]
      if (typeof value === 'string' && value.trim()) {
        return value.trim()
      }
    }

    return ''
  }

  private readRecord(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, any>
      : null
  }

  private interpolate(template: string, context: Record<string, any>) {
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

  private readContextValue(context: Record<string, any>, path: string) {
    return path.split('.').reduce<any>((current, segment) => {
      if (current && typeof current === 'object') {
        return current[segment]
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
    events: NotificationEvent[]
    config?: Record<string, any>
    isActive: boolean
    createdAt?: Date
    updatedAt?: Date
  }) {
    return {
      id: config._id.toString(),
      orgId: config.orgId.toString(),
      channel: config.channel,
      events: config.events,
      config: config.config || {},
      isActive: config.isActive,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    }
  }
}
