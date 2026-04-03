import { Injectable, Logger } from '@nestjs/common'
import { DeliveryChannel } from '@yikart/mongodb'

import { DispatchVideoCard, ImPushResult, ImPushService } from './im-push.service'

export interface WecomBinding {
  userId: string
  chatId?: string
}

@Injectable()
export class WecomPushService implements ImPushService<WecomBinding> {
  readonly channel = DeliveryChannel.WECOM

  private readonly logger = new Logger(WecomPushService.name)

  async pushVideoCard(binding: WecomBinding, videoData: DispatchVideoCard): Promise<ImPushResult> {
    // TODO: Replace this stub with real OpenClaw -> WeCom message delivery.
    const payload = {
      channel: this.channel,
      binding,
      videoData,
      deliveredAt: new Date().toISOString(),
      stub: true,
    }

    this.logger.log(`Stub WeCom push for task ${videoData.videoTaskId} -> ${binding.userId}`)

    return {
      success: true,
      payload,
    }
  }
}
