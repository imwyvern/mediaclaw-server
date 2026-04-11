import type { PlatformIncrementalState } from './platform-adapter.interface'
import { BaseTikHubPlatformAdapter } from './base-platform.adapter'

export class XhsPlatformAdapter extends BaseTikHubPlatformAdapter {
  constructor() {
    super('xhs', 0.96, 'afternoon')
  }

  override applySearchPagination(_limit: number, state?: PlatformIncrementalState) {
    return {
      query: {
        page: state?.page && state.page > 0 ? state.page : 1,
        noteTime: state?.watermark || '',
      },
    }
  }

  override applyCreatorPostPagination(limit: number, state?: PlatformIncrementalState) {
    return {
      query: {
        cursor: state?.cursor || '',
        num: limit,
      },
    }
  }
}
