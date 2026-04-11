import { Injectable } from '@nestjs/common'
import { DeliveryChannel } from '@yikart/mongodb'

import { ImDeliveryService } from './im-delivery.service'
import {
  DispatchVideoCard,
  ImPushContext,
  ImPushResult,
  ImPushService,
  ImTemplateMessage,
} from './im-push.service'

export interface TelegramBinding {
  chatId?: string
}

@Injectable()
export class TelegramPushService implements ImPushService<TelegramBinding> {
  readonly channel = DeliveryChannel.TELEGRAM

  constructor(private readonly imDeliveryService: ImDeliveryService) {}

  async pushVideoCard(
    context: ImPushContext<TelegramBinding>,
    videoData: DispatchVideoCard,
  ): Promise<ImPushResult> {
    const payload = this.imDeliveryService.buildTelegramTemplatePayload(
      {
        kind: 'video-card',
        title: videoData.title,
        summary: videoData.publishGuide,
        body: [
          videoData.description,
          `平台：${videoData.primaryPlatform || videoData.publishPlatforms.join(', ')}`,
        ].filter(Boolean),
        actions: [
          {
            key: 'confirm_publish',
            text: '确认发布',
          },
        ],
      },
      context.target,
      context.binding,
      context.deliveryRecord,
    )

    return this.imDeliveryService.deliverViaWebhook(
      context.deliveryRecord,
      context.target.webhookUrl,
      payload,
    )
  }

  async pushTemplateMessage(
    context: ImPushContext<TelegramBinding>,
    message: ImTemplateMessage,
  ): Promise<ImPushResult> {
    const payload = this.imDeliveryService.buildTelegramTemplatePayload(
      message,
      context.target,
      context.binding,
      context.deliveryRecord,
    )

    return this.imDeliveryService.deliverViaWebhook(
      context.deliveryRecord,
      context.target.webhookUrl,
      payload,
    )
  }
}
