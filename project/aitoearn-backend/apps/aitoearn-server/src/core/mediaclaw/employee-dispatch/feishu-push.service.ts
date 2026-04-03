import { Injectable } from '@nestjs/common'
import { DeliveryChannel } from '@yikart/mongodb'

import { ImDeliveryService } from './im-delivery.service'
import { DispatchVideoCard, ImPushContext, ImPushResult, ImPushService } from './im-push.service'

export interface FeishuBinding {
  openId?: string
  chatId?: string
}

@Injectable()
export class FeishuPushService implements ImPushService<FeishuBinding> {
  readonly channel = DeliveryChannel.FEISHU

  constructor(private readonly imDeliveryService: ImDeliveryService) {}

  async pushVideoCard(
    context: ImPushContext<FeishuBinding>,
    videoData: DispatchVideoCard,
  ): Promise<ImPushResult> {
    const payload = this.imDeliveryService.buildFeishuCardPayload(
      videoData,
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
