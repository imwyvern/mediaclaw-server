import { Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import {
  ClawHostInstance,
  ClawHostInstanceStatus,
} from '@yikart/mongodb'
import axios from 'axios'
import { Model } from 'mongoose'

interface AgentConfigUpdate {
  key: string
  value: unknown
  updatedAt: string
}

interface GatewayPushPayload {
  event: string
  input: Record<string, unknown>
  capability?: string
}

@Injectable()
export class ClawHostGatewayPushService {
  private readonly logger = new Logger(ClawHostGatewayPushService.name)
  private readonly configUpdateMap = new Map<string, AgentConfigUpdate[]>()

  constructor(
    @InjectModel(ClawHostInstance.name)
    private readonly clawHostInstanceModel: Model<ClawHostInstance>,
  ) {}

  queueConfigUpdate(orgId: string | null | undefined, agentId: string | null | undefined, update: AgentConfigUpdate) {
    const key = this.buildAgentKey(orgId, agentId)
    if (!key) {
      return
    }

    const updates = this.configUpdateMap.get(key) || []
    updates.push({
      key: update.key,
      value: update.value,
      updatedAt: update.updatedAt,
    })
    this.configUpdateMap.set(key, updates)
  }

  drainConfigUpdates(orgId: string | null | undefined, agentId: string | null | undefined) {
    const key = this.buildAgentKey(orgId, agentId)
    if (!key) {
      return []
    }

    const updates = this.configUpdateMap.get(key) || []
    this.configUpdateMap.delete(key)
    return updates
  }

  async pushRealtimeEvent(orgId: string | null | undefined, payload: GatewayPushPayload) {
    const normalizedOrgId = orgId?.trim()
    if (!normalizedOrgId) {
      return {
        attempted: 0,
        delivered: 0,
      }
    }

    const instances = await this.clawHostInstanceModel.find({
      'orgId': normalizedOrgId,
      'status': ClawHostInstanceStatus.RUNNING,
      'gatewayConfig.enabled': true,
      'gatewayConfig.url': { $ne: '' },
    }).lean().exec()

    const matchedInstances = instances.filter((instance) => {
      if (!payload.capability) {
        return true
      }

      const capabilities = instance.heartbeatCapabilities || []
      return capabilities.length === 0
        || capabilities.includes('*')
        || capabilities.includes(payload.capability)
        || capabilities.includes(`skill:${payload.capability}`)
    })

    const results = await Promise.all(
      matchedInstances.map(instance => this.pushToInstance(instance, payload)),
    )

    return {
      attempted: matchedInstances.length,
      delivered: results.filter(item => item.delivered).length,
      results,
    }
  }

  private async pushToInstance(instance: Record<string, any>, payload: GatewayPushPayload) {
    const endpoint = this.resolveGatewayEndpoint(instance['gatewayConfig']?.['url'])
    const toolName = this.resolveToolName(instance['gatewayConfig']?.['toolName'])

    try {
      await axios.post(endpoint, {
        tool: toolName,
        arguments: {
          event: payload.event,
          ...payload.input,
        },
        meta: {
          orgId: instance['orgId'],
          instanceId: instance['instanceId'],
          sentAt: new Date().toISOString(),
          channel: 'gateway',
        },
      }, {
        timeout: 5000,
      })

      await this.updateGatewayStatus(instance['_id'], 'success', '')
      return {
        instanceId: instance['instanceId'],
        delivered: true,
      }
    }
    catch (error) {
      const message = error instanceof Error ? error.message : 'gateway_push_failed'
      this.logger.warn({
        message: 'ClawHost gateway push failed',
        instanceId: instance['instanceId'],
        orgId: instance['orgId'],
        error: message,
      })
      await this.updateGatewayStatus(instance['_id'], 'failed', message)
      return {
        instanceId: instance['instanceId'],
        delivered: false,
        error: message,
      }
    }
  }

  private async updateGatewayStatus(instanceObjectId: unknown, status: string, message: string) {
    await this.clawHostInstanceModel.updateOne(
      { _id: instanceObjectId },
      {
        $set: {
          'gatewayConfig.lastPushAt': new Date(),
          'gatewayConfig.lastPushStatus': status,
          'gatewayConfig.lastPushMessage': message,
        },
      },
    ).exec()
  }

  private buildAgentKey(orgId?: string | null, agentId?: string | null) {
    const normalizedOrgId = orgId?.trim()
    const normalizedAgentId = agentId?.trim()
    if (!normalizedOrgId || !normalizedAgentId) {
      return ''
    }

    return `${normalizedOrgId}:${normalizedAgentId}`
  }

  private resolveToolName(rawToolName: unknown) {
    return typeof rawToolName === 'string' && rawToolName.trim()
      ? rawToolName.trim()
      : 'mediaclaw.sync'
  }

  private resolveGatewayEndpoint(rawUrl: unknown) {
    const normalized = typeof rawUrl === 'string' ? rawUrl.trim() : ''
    if (!normalized) {
      return ''
    }

    return normalized.endsWith('/tools/invoke')
      ? normalized
      : `${normalized.replace(/\/+$/g, '')}/tools/invoke`
  }
}
