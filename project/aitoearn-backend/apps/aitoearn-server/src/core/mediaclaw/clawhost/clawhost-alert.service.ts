import { Injectable, Logger } from '@nestjs/common'
import axios from 'axios'
import { MediaclawConfigService } from '../mediaclaw-config.service'

interface ClawHostAlertPayload {
  instanceId: string
  orgId: string
  plan: string
  status: string
  message: string
  healthUrl?: string
}

@Injectable()
export class ClawHostAlertService {
  private readonly logger = new Logger(ClawHostAlertService.name)

  constructor(private readonly configService: MediaclawConfigService) {}

  async notifyUnhealthyInstance(payload: ClawHostAlertPayload) {
    const targets = this.resolveWebhookTargets()
    if (targets.length === 0) {
      return
    }

    await Promise.all(targets.map(async (target) => {
      try {
        await axios.post(target.url, target.bodyBuilder(payload), {
          timeout: 5000,
          headers: {
            'content-type': 'application/json',
          },
        })
      }
      catch (error) {
        this.logger.warn(
          `ClawHost alert delivery failed for ${target.name}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }))
  }

  private resolveWebhookTargets() {
    const feishu = this.configService.getString(
      ['MEDIACLAW_ALERT_FEISHU_WEBHOOK', 'MEDIACLAW_FEISHU_ALERT_WEBHOOK'],
      '',
    )
    const dingtalk = this.configService.getString(
      ['MEDIACLAW_ALERT_DINGTALK_WEBHOOK', 'MEDIACLAW_DINGTALK_ALERT_WEBHOOK'],
      '',
    )

    return [
      feishu
        ? {
            name: 'feishu',
            url: feishu,
            bodyBuilder: (payload: ClawHostAlertPayload) => ({
              msg_type: 'text',
              content: {
                text: this.buildText(payload),
              },
            }),
          }
        : null,
      dingtalk
        ? {
            name: 'dingtalk',
            url: dingtalk,
            bodyBuilder: (payload: ClawHostAlertPayload) => ({
              msgtype: 'text',
              text: {
                content: this.buildText(payload),
              },
            }),
          }
        : null,
    ].filter(Boolean) as Array<{
      name: string
      url: string
      bodyBuilder: (payload: ClawHostAlertPayload) => Record<string, unknown>
    }>
  }

  private buildText(payload: ClawHostAlertPayload) {
    return [
      'MediaClaw ClawHost 实例异常',
      `实例: ${payload.instanceId}`,
      `企业: ${payload.orgId}`,
      `套餐: ${payload.plan}`,
      `状态: ${payload.status}`,
      `原因: ${payload.message}`,
      `健康检查: ${payload.healthUrl || 'n/a'}`,
    ].join('\n')
  }
}
