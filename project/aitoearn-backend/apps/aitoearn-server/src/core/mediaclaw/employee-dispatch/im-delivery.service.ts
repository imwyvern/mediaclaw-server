import { Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import {
  DeliveryChannel,
  DeliveryRecord,
  DeliveryRecordStatus,
} from '@yikart/mongodb'
import axios from 'axios'
import { Model } from 'mongoose'

import {
  DispatchEmployeeTarget,
  DispatchVideoCard,
  ImPushResult,
  WebhookDeliveryRecord,
} from './im-push.service'

@Injectable()
export class ImDeliveryService {
  private readonly logger = new Logger(ImDeliveryService.name)

  constructor(
    @InjectModel(DeliveryRecord.name)
    private readonly deliveryRecordModel: Model<DeliveryRecord>,
  ) {}

  buildFeishuCardPayload(
    videoData: DispatchVideoCard,
    target: DispatchEmployeeTarget,
    binding: { openId?: string, chatId?: string } = {},
    deliveryRecord?: WebhookDeliveryRecord,
  ) {
    const basePayload = this.buildBasePayload(
      videoData,
      target,
      deliveryRecord,
      DeliveryChannel.FEISHU,
    )

    return {
      ...basePayload,
      messageType: 'feishu/interactive-card',
      receiver: {
        openId: binding.openId || '',
        chatId: binding.chatId || '',
      },
      card: {
        header: {
          title: basePayload.title,
          template: 'blue',
        },
        sections: [
          {
            type: 'thumbnail',
            imageUrl: basePayload.coverUrl || basePayload.videoUrl,
          },
          {
            type: 'copy',
            text: basePayload.copy,
          },
          {
            type: 'publish-guide',
            text: basePayload.publishGuide,
          },
        ],
        actions: [
          {
            type: 'link',
            text: '确认发布',
            url: basePayload.confirmUrl,
          },
        ],
      },
    }
  }

  buildWecomCardPayload(
    videoData: DispatchVideoCard,
    target: DispatchEmployeeTarget,
    binding: { userId?: string, chatId?: string } = {},
    deliveryRecord?: WebhookDeliveryRecord,
  ) {
    const basePayload = this.buildBasePayload(
      videoData,
      target,
      deliveryRecord,
      DeliveryChannel.WECOM,
    )

    return {
      ...basePayload,
      msgtype: 'template_card',
      receiver: {
        userId: binding.userId || '',
        chatId: binding.chatId || '',
      },
      template_card: {
        card_type: 'text_notice',
        source: {
          icon_url: basePayload.coverUrl || basePayload.videoUrl,
          desc: 'MediaClaw IM 派发',
        },
        main_title: {
          title: basePayload.title,
          desc: basePayload.platform,
        },
        horizontal_content_list: [
          {
            keyname: '分配给',
            value: basePayload.assignedTo,
          },
          {
            keyname: '文案',
            value: basePayload.copy,
          },
        ],
        action_menu: {
          desc: '确认发布',
          action_list: [
            {
              text: '确认发布',
              key: 'confirm_publish',
            },
          ],
        },
        jump_list: [
          {
            type: 1,
            title: '查看成片',
            url: basePayload.videoUrl,
          },
          {
            type: 1,
            title: '确认发布',
            url: basePayload.confirmUrl,
          },
        ],
      },
    }
  }

  buildGenericWebhookPayload(
    videoData: DispatchVideoCard,
    target: DispatchEmployeeTarget,
    deliveryRecord?: WebhookDeliveryRecord,
  ) {
    return this.buildBasePayload(
      videoData,
      target,
      deliveryRecord,
      DeliveryChannel.WEBHOOK,
    )
  }

  async deliverViaWebhook(
    deliveryRecord: WebhookDeliveryRecord,
    webhookUrl: string,
    payload: Record<string, unknown>,
  ): Promise<ImPushResult> {
    const attempts: Array<Record<string, unknown>> = []
    const backoffMs = [500, 1000, 2000]
    let lastError = 'webhook_delivery_failed'

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await axios.post(webhookUrl, payload, {
          timeout: 10000,
          headers: {
            'content-type': 'application/json',
            'x-mediaclaw-delivery-id': deliveryRecord.id,
            'x-mediaclaw-delivery-channel': deliveryRecord.deliveryChannel,
          },
        })

        const deliveredAt = new Date()
        const deliveryPayload = {
          webhookUrl,
          request: payload,
          response: {
            status: response.status,
            data: this.normalizeResponseData(response.data),
          },
          attempts,
          deliveredAt: deliveredAt.toISOString(),
        }

        await this.updateDeliveryRecord(deliveryRecord.id, {
          status: DeliveryRecordStatus.DELIVERED,
          deliveredAt,
          failReason: '',
          deliveryPayload,
          retryCount: attempt - 1,
        })

        this.logger.log(
          `Webhook delivery succeeded for record ${deliveryRecord.id} on attempt ${attempt}`,
        )

        return {
          success: true,
          status: DeliveryRecordStatus.DELIVERED,
          deliveredAt,
          retryCount: attempt - 1,
          payload: deliveryPayload,
        }
      }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        lastError = message || lastError
        attempts.push({
          attempt,
          message,
          at: new Date().toISOString(),
        })

        this.logger.warn(
          `Webhook delivery failed for record ${deliveryRecord.id} on attempt ${attempt}: ${message}`,
        )

        if (attempt < 3) {
          await this.sleep(backoffMs[attempt - 1] || 2000)
        }
      }
    }

    const failurePayload = {
      webhookUrl,
      request: payload,
      attempts,
    }

    await this.updateDeliveryRecord(deliveryRecord.id, {
      status: DeliveryRecordStatus.FAILED,
      deliveredAt: null,
      failReason: lastError,
      deliveryPayload: failurePayload,
      retryCount: attempts.length,
    })

    return {
      success: false,
      status: DeliveryRecordStatus.FAILED,
      deliveredAt: null,
      retryCount: attempts.length,
      errorMessage: lastError,
      payload: failurePayload,
    }
  }

  private buildBasePayload(
    videoData: DispatchVideoCard,
    target: DispatchEmployeeTarget,
    deliveryRecord: WebhookDeliveryRecord | undefined,
    channel: DeliveryChannel,
  ) {
    const platform = videoData.primaryPlatform || videoData.publishPlatforms[0] || ''

    return {
      videoTaskId: videoData.videoTaskId,
      deliveryRecordId: deliveryRecord?.id || '',
      videoUrl: videoData.outputVideoUrl,
      coverUrl: videoData.coverUrl,
      title: videoData.title,
      copy: videoData.copy || videoData.description,
      publishGuide: videoData.publishGuide,
      platform,
      assignedTo: this.buildAssignedTo(target),
      confirmUrl: this.buildConfirmUrl(deliveryRecord?.id || ''),
      tags: videoData.tags,
      deliveryChannel: channel,
    }
  }

  private async updateDeliveryRecord(
    deliveryRecordId: string,
    data: {
      status: DeliveryRecordStatus
      deliveredAt: Date | null
      failReason: string
      deliveryPayload: Record<string, unknown>
      retryCount: number
    },
  ) {
    await this.deliveryRecordModel.findByIdAndUpdate(
      deliveryRecordId,
      {
        $set: {
          status: data.status,
          deliveredAt: data.deliveredAt,
          failReason: data.failReason,
          deliveryPayload: data.deliveryPayload,
          retryCount: data.retryCount,
        },
      },
    ).exec()
  }

  private buildAssignedTo(target: DispatchEmployeeTarget) {
    if (target.employeeName && target.employeePhone) {
      return `${target.employeeName} (${target.employeePhone})`
    }

    return target.employeeName || target.employeePhone || target.assignmentId
  }

  private buildConfirmUrl(deliveryRecordId: string) {
    if (!deliveryRecordId) {
      return ''
    }

    const directUrl = process.env['MEDIACLAW_DISPATCH_CONFIRM_URL']?.trim()
    if (directUrl) {
      const separator = directUrl.includes('?') ? '&' : '?'
      return `${directUrl}${separator}deliveryRecordId=${encodeURIComponent(deliveryRecordId)}`
    }

    const appBaseUrl = process.env['MEDIACLAW_APP_BASE_URL']?.trim()
    if (!appBaseUrl) {
      return ''
    }

    return `${appBaseUrl.replace(/\/$/, '')}/dispatch/confirm?deliveryRecordId=${encodeURIComponent(deliveryRecordId)}`
  }

  private normalizeResponseData(data: unknown) {
    if (data === null || data === undefined) {
      return null
    }

    if (typeof data === 'string') {
      return data.slice(0, 500)
    }

    if (typeof data === 'number' || typeof data === 'boolean') {
      return data
    }

    if (Array.isArray(data)) {
      return data.slice(0, 20)
    }

    if (typeof data === 'object') {
      return data
    }

    return String(data)
  }

  private async sleep(ms: number) {
    await new Promise(resolve => setTimeout(resolve, ms))
  }
}
