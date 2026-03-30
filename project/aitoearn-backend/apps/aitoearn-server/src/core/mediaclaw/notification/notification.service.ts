import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
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

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name)

  constructor(
    @InjectModel(NotificationConfig.name)
    private readonly notificationConfigModel: Model<NotificationConfig>,
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
    const configs = await this.notificationConfigModel.find({
      orgId: new Types.ObjectId(orgId),
      isActive: true,
      events: event,
    }).lean().exec()

    const results = configs.map((config) => {
      const delivery = {
        configId: config._id.toString(),
        orgId,
        channel: config.channel,
        event,
        payload,
      }

      this.logger.log(JSON.stringify({
        message: 'Notification dispatched',
        ...delivery,
      }))

      return {
        id: config._id.toString(),
        channel: config.channel,
        delivered: true,
      }
    })

    return {
      orgId,
      event,
      total: results.length,
      results,
    }
  }

  async testConfig(orgId: string, id: string) {
    const config = await this.notificationConfigModel.findOne(this.buildOwnedQuery(orgId, id)).lean().exec()
    if (!config) {
      throw new NotFoundException('Notification config not found')
    }

    const event = config.events[0] || NotificationEvent.TASK_COMPLETED
    const result = {
      configId: config._id.toString(),
      orgId: config.orgId.toString(),
      channel: config.channel,
      event,
      payload: {
        test: true,
        message: 'Notification config test',
        testedAt: new Date().toISOString(),
      },
    }

    this.logger.log(JSON.stringify({
      message: 'Notification test dispatched',
      ...result,
    }))

    return {
      success: true,
      ...result,
    }
  }

  private normalizeEvents(events?: NotificationEvent[]) {
    return [...new Set((events || []).filter(Boolean))]
  }

  private buildOwnedQuery(orgId: string, id: string) {
    return {
      _id: new Types.ObjectId(id),
      orgId: new Types.ObjectId(orgId),
    }
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
