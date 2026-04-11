import { Injectable } from '@nestjs/common'
import { DeliveryChannel } from '@yikart/mongodb'

import { DingtalkPushService } from './dingtalk-push.service'
import { FeishuPushService } from './feishu-push.service'
import {
  DispatchVideoCard,
  ImPushContext,
  ImPushResult,
  ImPushService,
  ImTemplateMessage,
} from './im-push.service'
import { TelegramPushService } from './telegram-push.service'
import { WecomPushService } from './wecom-push.service'

@Injectable()
export class ImChannelRegistryService {
  private readonly registry = new Map<DeliveryChannel, ImPushService<Record<string, unknown>>>()

  constructor(
    feishuPushService: FeishuPushService,
    wecomPushService: WecomPushService,
    dingtalkPushService: DingtalkPushService,
    telegramPushService: TelegramPushService,
  ) {
    this.register(feishuPushService)
    this.register(wecomPushService)
    this.register(dingtalkPushService)
    this.register(telegramPushService)
  }

  pushVideoCard(
    channel: DeliveryChannel,
    context: ImPushContext<Record<string, unknown>>,
    videoData: DispatchVideoCard,
  ): Promise<ImPushResult> | null {
    const adapter = this.registry.get(channel)
    return adapter ? adapter.pushVideoCard(context, videoData) : null
  }

  pushTemplateMessage(
    channel: DeliveryChannel,
    context: ImPushContext<Record<string, unknown>>,
    message: ImTemplateMessage,
  ): Promise<ImPushResult> | null {
    const adapter = this.registry.get(channel)
    return adapter ? adapter.pushTemplateMessage(context, message) : null
  }

  private register(adapter: ImPushService<Record<string, unknown>>) {
    if (!adapter?.channel) {
      return
    }

    this.registry.set(adapter.channel, adapter)
  }
}
