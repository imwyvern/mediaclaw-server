import { randomBytes } from 'node:crypto'
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Webhook } from '@yikart/mongodb'
import axios from 'axios'
import { Model, Types } from 'mongoose'
import {
  buildWebhookRequest,
  canonicalizeWebhookEvent,
  detectWebhookProvider,
  expandWebhookEvents,
  normalizeWebhookEvents,
  verifyGenericWebhookSignature,
} from './webhook-delivery.util'

interface RegisterWebhookOptions {
  name?: string
  secret?: string
  isActive?: boolean
}

interface WebhookRecord {
  _id: unknown
  orgId: unknown
  name: string
  url: string
  secret: string
  events?: string[]
  isActive?: boolean
  lastTriggeredAt?: Date | null
  failCount?: number
  createdAt?: Date
  updatedAt?: Date
}

type WebhookPayload = Record<string, unknown>

interface WebhookUpdateInput {
  name?: string
  url?: string
  events?: string[]
  isActive?: boolean
  secret?: string
}

interface WebhookTriggerResult {
  id: string
  provider: string
  success: boolean
  attempts: number
  statusCode?: number
  error?: string
}

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name)
  private readonly maxRetryAttempts = 5
  private readonly baseRetryDelayMs = 500

  constructor(
    @InjectModel(Webhook.name) private readonly webhookModel: Model<Webhook>,
  ) {}

  async register(
    orgId: string,
    url: string,
    events: string[],
    options: RegisterWebhookOptions = {},
  ) {
    const normalizedUrl = this.normalizeUrl(url)
    const webhook = await this.webhookModel.create({
      orgId: new Types.ObjectId(orgId),
      name: options.name?.trim() || this.buildDefaultName(normalizedUrl),
      url: normalizedUrl,
      secret: options.secret || randomBytes(24).toString('hex'),
      events: normalizeWebhookEvents(events),
      isActive: options.isActive ?? true,
      lastTriggeredAt: null,
      failCount: 0,
    })

    return this.toResponse(webhook.toObject() as WebhookRecord, { includeSecret: true })
  }

  async listByOrg(orgId: string) {
    const webhooks = await this.webhookModel.find({
      orgId: new Types.ObjectId(orgId),
    }).sort({ createdAt: -1 }).lean().exec()

    return webhooks.map(webhook => this.toResponse(webhook as WebhookRecord))
  }

  async getById(orgId: string, id: string) {
    const webhook = await this.webhookModel.findOne(this.buildOwnedQuery(orgId, id)).lean().exec()
    if (!webhook) {
      throw new NotFoundException('Webhook not found')
    }

    return this.toResponse(webhook as WebhookRecord)
  }

  async update(orgId: string, id: string, data: WebhookUpdateInput) {
    const payload: WebhookUpdateInput = {}

    if ('name' in data && typeof data.name === 'string') {
      payload['name'] = data.name.trim()
    }

    if ('url' in data && typeof data.url === 'string') {
      payload['url'] = this.normalizeUrl(data.url)
    }

    if ('events' in data) {
      payload['events'] = normalizeWebhookEvents(data.events || [])
    }

    if ('isActive' in data && typeof data.isActive === 'boolean') {
      payload['isActive'] = data.isActive
    }

    if ('secret' in data && typeof data.secret === 'string' && data.secret.trim()) {
      payload['secret'] = data.secret.trim()
    }

    const webhook = await this.webhookModel.findOneAndUpdate(this.buildOwnedQuery(orgId, id), payload, {
      new: true,
    }).lean().exec()

    if (!webhook) {
      throw new NotFoundException('Webhook not found')
    }

    return this.toResponse(webhook as WebhookRecord, { includeSecret: Boolean(payload.secret) })
  }

  async delete(orgId: string, id: string) {
    const webhook = await this.webhookModel.findOneAndDelete(this.buildOwnedQuery(orgId, id)).exec()
    if (!webhook) {
      throw new NotFoundException('Webhook not found')
    }

    return {
      id,
      deleted: true,
    }
  }

  async trigger(event: string, payload: WebhookPayload) {
    const normalizedEvent = canonicalizeWebhookEvent(event)
    if (!normalizedEvent) {
      throw new BadRequestException('event is required')
    }

    const resolvedOrgId = this.resolveOrgId(payload)
    const query: Record<string, unknown> = {
      isActive: true,
      events: {
        $in: [...expandWebhookEvents(normalizedEvent), '*'],
      },
    }

    if (resolvedOrgId) {
      query['orgId'] = new Types.ObjectId(resolvedOrgId)
    }

    const webhooks = await this.webhookModel.find(query).lean().exec()
    const results = await Promise.all(
      webhooks.map((webhook: WebhookRecord) => this.deliverWebhook(webhook, normalizedEvent, payload)),
    )

    return {
      event: normalizedEvent,
      total: results.length,
      successCount: results.filter((result: WebhookTriggerResult) => result.success).length,
      failureCount: results.filter((result: WebhookTriggerResult) => !result.success).length,
      results,
    }
  }

  async testDelivery(orgId: string, id: string, event: string, payload: WebhookPayload = {}) {
    const webhook = await this.webhookModel.findOne(this.buildOwnedQuery(orgId, id)).lean().exec()
    if (!webhook) {
      throw new NotFoundException('Webhook not found')
    }

    const normalizedEvent = canonicalizeWebhookEvent(event)
    if (!normalizedEvent) {
      throw new BadRequestException('event is required')
    }

    const result = await this.deliverWebhook(
      webhook as WebhookRecord,
      normalizedEvent,
      payload,
      true,
    )

    return {
      event: normalizedEvent,
      ...result,
    }
  }

  verifySignature(rawBody: string, timestamp: string, signature: string, secret: string) {
    return verifyGenericWebhookSignature(rawBody, timestamp, secret, signature)
  }

  private buildDefaultName(url: string) {
    try {
      const parsedUrl = new URL(url)
      return `Webhook ${parsedUrl.hostname}`
    }
    catch {
      return 'Webhook Endpoint'
    }
  }

  private async deliverWebhook(
    webhook: WebhookRecord,
    event: string,
    payload: WebhookPayload,
    isTest = false,
  ): Promise<WebhookTriggerResult> {
    const occurredAt = new Date().toISOString()
    const provider = detectWebhookProvider(webhook.url)
    let lastError = ''
    let lastStatusCode: number | undefined

    for (let attempt = 1; attempt <= this.maxRetryAttempts; attempt += 1) {
      const request = buildWebhookRequest(webhook.url, webhook.secret, {
        event,
        timestamp: occurredAt,
        payload,
        isTest,
      })

      try {
        const response = await axios.post(request.url, request.body, {
          headers: request.headers,
          timeout: 5000,
        })

        await this.webhookModel.findByIdAndUpdate(webhook._id, {
          lastTriggeredAt: new Date(),
          failCount: 0,
        }).exec()

        return {
          id: this.toObjectIdString(webhook._id) || '',
          provider,
          success: true,
          attempts: attempt,
          statusCode: response.status,
        }
      }
      catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
        lastStatusCode = this.resolveStatusCode(error)

        this.logger.warn({
          message: 'Webhook delivery failed',
          webhookId: this.toObjectIdString(webhook._id) || '',
          event,
          provider,
          attempt,
          error: lastError,
          statusCode: lastStatusCode,
        })

        if (attempt < this.maxRetryAttempts) {
          await this.sleep(this.resolveRetryDelayMs(attempt))
        }
      }
    }

    await this.webhookModel.findByIdAndUpdate(webhook._id, {
      $inc: { failCount: 1 },
    }).exec()

    return {
      id: this.toObjectIdString(webhook._id) || '',
      provider,
      success: false,
      attempts: this.maxRetryAttempts,
      statusCode: lastStatusCode,
      error: lastError || 'Webhook delivery failed',
    }
  }

  private resolveRetryDelayMs(attempt: number) {
    return this.baseRetryDelayMs * (2 ** Math.max(0, attempt - 1))
  }

  private async sleep(delayMs: number) {
    await new Promise(resolve => setTimeout(resolve, delayMs))
  }

  private resolveStatusCode(error: unknown) {
    if (axios.isAxiosError(error)) {
      return error.response?.status
    }

    return undefined
  }

  private normalizeUrl(value: string) {
    const normalized = value.trim()
    try {
      return new URL(normalized).toString()
    }
    catch {
      throw new BadRequestException('url must be a valid URL')
    }
  }

  private resolveOrgId(payload: WebhookPayload) {
    const task = this.toPlainObject(payload['task'])
    const order = this.toPlainObject(payload['order'])
    const candidates = [
      payload['orgId'],
      payload['userId'],
      task['orgId'],
      order['orgId'],
    ]

    for (const candidate of candidates) {
      const normalized = this.toObjectIdString(candidate)
      if (normalized) {
        return normalized
      }
    }

    return null
  }

  private toObjectIdString(value: unknown) {
    if (typeof value === 'string' && Types.ObjectId.isValid(value)) {
      return value
    }

    if (value instanceof Types.ObjectId) {
      return value.toString()
    }

    if (value && typeof value === 'object' && 'toString' in value) {
      const normalized = value.toString()
      if (Types.ObjectId.isValid(normalized)) {
        return normalized
      }
    }

    return null
  }

  private buildOwnedQuery(orgId: string, id: string) {
    return {
      _id: new Types.ObjectId(id),
      orgId: new Types.ObjectId(orgId),
    }
  }

  private toResponse(webhook: WebhookRecord, options: { includeSecret?: boolean } = {}) {
    const webhookId = this.toObjectIdString(webhook._id)
    const orgId = this.toObjectIdString(webhook.orgId)

    return {
      id: webhookId,
      orgId,
      name: webhook.name,
      url: webhook.url,
      provider: detectWebhookProvider(webhook.url),
      secret: options.includeSecret ? webhook.secret : undefined,
      hasSecret: Boolean(webhook.secret),
      secretPreview: webhook.secret ? `${String(webhook.secret).slice(0, 4)}...` : null,
      events: normalizeWebhookEvents(webhook.events || []),
      isActive: webhook.isActive ?? true,
      lastTriggeredAt: webhook.lastTriggeredAt || null,
      failCount: webhook.failCount || 0,
      createdAt: webhook.createdAt,
      updatedAt: webhook.updatedAt,
    }
  }

  private toPlainObject(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {}
    }

    return value as Record<string, unknown>
  }
}
