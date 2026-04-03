import { DeliveryChannel } from '@yikart/mongodb'

export interface DispatchVideoCard {
  videoTaskId: string
  title: string
  description: string
  outputVideoUrl: string
  publishPlatforms: string[]
  tags: string[]
}

export interface ImPushResult {
  success: boolean
  payload: Record<string, unknown>
  errorMessage?: string
}

export interface ImPushService<TBinding = Record<string, unknown>> {
  readonly channel: DeliveryChannel.FEISHU | DeliveryChannel.WECOM
  pushVideoCard(binding: TBinding, videoData: DispatchVideoCard): Promise<ImPushResult>
}
