import type { PlatformIncrementalState } from './platform-adapter.interface'
import { BaseTikHubPlatformAdapter } from './base-platform.adapter'

export class DouyinPlatformAdapter extends BaseTikHubPlatformAdapter {
  constructor() {
    super('douyin', 1.1, 'prime_time')
  }

  override applySearchPagination(limit: number, state?: PlatformIncrementalState) {
    return {
      body: {
        cursor: Number(state?.cursor || 0),
        count: limit,
      },
    }
  }

  override applyCreatorPostPagination(limit: number, state?: PlatformIncrementalState) {
    return {
      body: {
        max_cursor: Number(state?.cursor || 0),
        count: limit,
      },
    }
  }
}
