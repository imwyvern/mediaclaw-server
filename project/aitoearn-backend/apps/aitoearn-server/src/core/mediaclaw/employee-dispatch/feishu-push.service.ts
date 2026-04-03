import { Injectable, Logger } from '@nestjs/common'
import { DeliveryChannel } from '@yikart/mongodb'

import { DispatchVideoCard, ImPushResult, ImPushService } from './im-push.service'

export interface FeishuBinding {
  openId: string
  chatId?: string
}

@Injectable()
export class FeishuPushService implements ImPushService<FeishuBinding> {
  readonly channel = DeliveryChannel.FEISHU

  private readonly logger = new Logger(FeishuPushService.name)

  async pushVideoCard(binding: FeishuBinding, videoData: DispatchVideoCard): Promise<ImPushResult> {
    // TODO: Replace this stub with real OpenClaw -> Feishu interactive card delivery.
    const payload = {
      channel: this.channel,
      binding,
      videoData,
      deliveredAt: new Date().toISOString(),
      stub: true,
    }

    this.logger.log(`Stub Feishu push for task ${videoData.videoTaskId} -> ${binding.openId}`)

    return {
      success: true,
      payload,
    }
  }
}
