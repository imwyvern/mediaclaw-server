import type { PlatformIncrementalState } from './platform-adapter.interface'
import { BaseTikHubPlatformAdapter } from './base-platform.adapter'

export class KuaishouPlatformAdapter extends BaseTikHubPlatformAdapter {
  constructor() {
    super('kuaishou', 1.02, 'night')
  }

  override applySearchPagination(_limit: number, state?: PlatformIncrementalState) {
    return {
      query: {
        page: state?.page && state.page > 0 ? state.page : 1,
      },
    }
  }

  override applyCreatorPostPagination(limit: number, state?: PlatformIncrementalState) {
    return {
      query: {
        pcursor: state?.cursor || '',
        count: limit,
      },
    }
  }
}
