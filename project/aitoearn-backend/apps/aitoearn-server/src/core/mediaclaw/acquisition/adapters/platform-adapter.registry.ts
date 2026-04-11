import type { TikHubPlatform } from '../tikhub.platforms'
import type { TikHubPlatformAdapter } from './platform-adapter.interface'
import { BilibiliPlatformAdapter } from './bilibili-platform.adapter'
import { DouyinPlatformAdapter } from './douyin-platform.adapter'
import { KuaishouPlatformAdapter } from './kuaishou-platform.adapter'
import { XhsPlatformAdapter } from './xhs-platform.adapter'

export function createTikHubPlatformAdapters() {
  const adapters: TikHubPlatformAdapter[] = [
    new DouyinPlatformAdapter(),
    new XhsPlatformAdapter(),
    new KuaishouPlatformAdapter(),
    new BilibiliPlatformAdapter(),
  ]

  return adapters.reduce<Record<TikHubPlatform, TikHubPlatformAdapter>>((accumulator, adapter) => {
    accumulator[adapter.platform] = adapter
    return accumulator
  }, {} as Record<TikHubPlatform, TikHubPlatformAdapter>)
}
