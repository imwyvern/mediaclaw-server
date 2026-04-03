import { Injectable } from '@nestjs/common'
import { DeliveryChannel } from '@yikart/mongodb'

import { ImDeliveryService } from './im-delivery.service'
import { DispatchVideoCard, ImPushContext, ImPushResult, ImPushService } from './im-push.service'

export interface WecomBinding {
  userId?: string
  chatId?: string
}

@Injectable()
export class WecomPushService implements ImPushService<WecomBinding> {
  readonly channel = DeliveryChannel.WECOM

  constructor(private readonly imDeliveryService: ImDeliveryService) {}

  async pushVideoCard(
    context: ImPushContext<WecomBinding>,
    videoData: DispatchVideoCard,
  ): Promise<ImPushResult> {
    const payload = this.imDeliveryService.buildWecomCardPayload(
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
