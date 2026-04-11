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

export interface DingtalkBinding {
  chatId?: string
}

@Injectable()
export class DingtalkPushService implements ImPushService<DingtalkBinding> {
  readonly channel = DeliveryChannel.DINGTALK

  constructor(private readonly imDeliveryService: ImDeliveryService) {}

  async pushVideoCard(
    context: ImPushContext<DingtalkBinding>,
    videoData: DispatchVideoCard,
  ): Promise<ImPushResult> {
    const payload = this.imDeliveryService.buildDingtalkTemplatePayload(
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
            url: context.deliveryRecord.id ? undefined : '',
          },
        ],
      },
      context.target,
      context.deliveryRecord,
    )

    return this.imDeliveryService.deliverViaWebhook(
      context.deliveryRecord,
      context.target.webhookUrl,
      payload,
    )
  }

  async pushTemplateMessage(
    context: ImPushContext<DingtalkBinding>,
    message: ImTemplateMessage,
  ): Promise<ImPushResult> {
    const payload = this.imDeliveryService.buildDingtalkTemplatePayload(
      message,
      context.target,
      context.deliveryRecord,
    )

    return this.imDeliveryService.deliverViaWebhook(
      context.deliveryRecord,
      context.target.webhookUrl,
      payload,
    )
  }
}
