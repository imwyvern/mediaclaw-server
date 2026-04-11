import type { PlatformIncrementalState } from './platform-adapter.interface'
import { BaseTikHubPlatformAdapter } from './base-platform.adapter'

export class BilibiliPlatformAdapter extends BaseTikHubPlatformAdapter {
  constructor() {
    super('bilibili', 0.9, 'night')
  }

  override applySearchPagination(limit: number, state?: PlatformIncrementalState) {
    return {
      query: {
        page: state?.page && state.page > 0 ? state.page : 1,
        page_size: limit,
      },
    }
  }

  override applyCreatorPostPagination(limit: number, state?: PlatformIncrementalState) {
    return {
      query: {
        pn: state?.page && state.page > 0 ? state.page : 1,
        ps: limit,
      },
    }
  }
}
