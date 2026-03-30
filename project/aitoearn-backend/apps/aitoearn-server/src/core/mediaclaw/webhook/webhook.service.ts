import { createHmac, randomBytes } from 'node:crypto'
import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Webhook } from '@yikart/mongodb'
import axios from 'axios'
import { Model, Types } from 'mongoose'

interface RegisterWebhookOptions {
  name?: string
  secret?: string
  isActive?: boolean
}

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name)

  constructor(
    @InjectModel(Webhook.name) private readonly webhookModel: Model<Webhook>,
  ) {}

  async register(
    orgId: string,
    url: string,
    events: string[],
    options: RegisterWebhookOptions = {},
  ) {
    const webhook = await this.webhookModel.create({
      orgId: new Types.ObjectId(orgId),
      name: options.name?.trim() || this.buildDefaultName(url),
      url,
      secret: options.secret || randomBytes(24).toString('hex'),
      events: this.normalizeEvents(events),
      isActive: options.isActive ?? true,
      lastTriggeredAt: null,
      failCount: 0,
    })

    return this.toResponse(webhook.toObject(), { includeSecret: true })
  }

  async listByOrg(orgId: string) {
    const webhooks = await this.webhookModel.find({
      orgId: new Types.ObjectId(orgId),
    }).sort({ createdAt: -1 }).lean().exec()

    return webhooks.map(webhook => this.toResponse(webhook))
  }

  async getById(orgId: string, id: string) {
    const webhook = await this.webhookModel.findOne(this.buildOwnedQuery(orgId, id)).lean().exec()
    if (!webhook) {
      throw new NotFoundException('Webhook not found')
    }

    return this.toResponse(webhook)
  }

  async update(orgId: string, id: string, data: Partial<Webhook> & { secret?: string }) {
    const payload: Record<string, any> = {}

    if ('name' in data && typeof data.name === 'string') {
      payload['name'] = data.name.trim()
    }

    if ('url' in data && typeof data.url === 'string') {
      payload['url'] = data.url
    }

    if ('events' in data) {
      payload['events'] = this.normalizeEvents(data.events || [])
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

    return this.toResponse(webhook, { includeSecret: Boolean(payload['secret']) })
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

  async trigger(event: string, payload: Record<string, any>) {
    const resolvedOrgId = this.resolveOrgId(payload)
    const query: Record<string, any> = {
      isActive: true,
      events: event,
    }

    if (resolvedOrgId) {
      query['orgId'] = new Types.ObjectId(resolvedOrgId)
    }

    const webhooks = await this.webhookModel.find(query).exec()
    const timestamp = new Date().toISOString()
    const delivery = {
      event,
      timestamp,
      payload,
    }
    const rawBody = JSON.stringify(delivery)

    const results = await Promise.all(webhooks.map(async (webhook) => {
      const signature = createHmac('sha256', webhook.secret).update(rawBody).digest('hex')

      try {
        await axios.post(webhook.url, delivery, {
          headers: {
            'content-type': 'application/json',
            'x-mediaclaw-event': event,
            'x-mediaclaw-signature': signature,
            'x-mediaclaw-timestamp': timestamp,
          },
          timeout: 5000,
        })

        await this.webhookModel.findByIdAndUpdate(webhook._id, {
          lastTriggeredAt: new Date(),
          failCount: 0,
        }).exec()

        return {
          id: webhook._id.toString(),
          success: true,
        }
      }
      catch (error) {
        await this.webhookModel.findByIdAndUpdate(webhook._id, {
          $inc: { failCount: 1 },
        }).exec()

        const message = error instanceof Error ? error.message : String(error)
        this.logger.warn({
          message: 'Webhook delivery failed',
          webhookId: webhook._id.toString(),
          event,
          error: message,
        })

        return {
          id: webhook._id.toString(),
          success: false,
          error: message,
        }
      }
    }))

    return {
      event,
      total: results.length,
      successCount: results.filter(result => result.success).length,
      failureCount: results.filter(result => !result.success).length,
      results,
    }
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

  private normalizeEvents(events: string[]) {
    return [...new Set((events || []).map(event => event.trim()).filter(Boolean))]
  }

  private resolveOrgId(payload: Record<string, any>) {
    const candidates = [
      payload['orgId'],
      payload['userId'],
      payload['task']?.['orgId'],
      payload['order']?.['orgId'],
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

  private toResponse(webhook: any, options: { includeSecret?: boolean } = {}) {
    return {
      id: webhook._id?.toString(),
      orgId: webhook.orgId?.toString() || null,
      name: webhook.name,
      url: webhook.url,
      secret: options.includeSecret ? webhook.secret : undefined,
      hasSecret: Boolean(webhook.secret),
      secretPreview: webhook.secret ? `${String(webhook.secret).slice(0, 4)}...` : null,
      events: webhook.events || [],
      isActive: webhook.isActive ?? true,
      lastTriggeredAt: webhook.lastTriggeredAt || null,
      failCount: webhook.failCount || 0,
      createdAt: webhook.createdAt,
      updatedAt: webhook.updatedAt,
    }
  }
}
