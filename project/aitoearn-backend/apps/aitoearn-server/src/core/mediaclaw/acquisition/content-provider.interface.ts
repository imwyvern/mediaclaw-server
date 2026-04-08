export const CONTENT_PROVIDERS = Symbol('CONTENT_PROVIDERS')

export interface ContentProviderSearchMetrics {
  views: number
  likes: number
  comments: number
  shares: number
}

export interface ContentProviderSearchItem {
  platform: string
  videoId: string
  title: string
  author: string
  contentUrl: string
  thumbnailUrl: string
  publishedAt: string
  metrics: ContentProviderSearchMetrics
}

export interface ContentProviderVideoDetail {
  platform: string
  videoId: string
  title: string
  author: string
  description: string
  durationSeconds: number
  contentUrl: string
  thumbnailUrl: string
  metrics: ContentProviderSearchMetrics
}

export interface ContentProviderSourceVideo {
  downloadUrl: string
  filename: string
  expiresAt: string
  videoId?: string
  title?: string
}

export interface ContentSearchResult {
  provider: string
  source: string
  reason?: string
  platform: string
  keyword: string
  limit: number
  request?: unknown
  items: ContentProviderSearchItem[]
}

export interface ContentDetailResult {
  provider: string
  source: string
  reason?: string
  platform: string
  videoId: string
  request?: unknown
  data: ContentProviderVideoDetail | null
}

export interface ContentTrackPerformanceResult {
  provider: string
  source: string
  reason?: string
  platform?: string
  videoId: string
  data: ContentProviderVideoDetail | null
}

export interface ContentSourceResult {
  provider: string
  source: string
  reason?: string
  platform: string
  videoUrl: string
  request?: unknown
  data: ContentProviderSourceVideo | null
}

export interface ContentProvider {
  readonly providerName: string
  readonly priority?: number

  supportsPlatform: (platform: string) => boolean
  searchVideos: (platform: string, keyword: string, limit?: number) => Promise<ContentSearchResult>
  getVideoDetail: (platform: string, videoId: string) => Promise<ContentDetailResult>
  trackPerformance: (videoId: string) => Promise<ContentTrackPerformanceResult>
  getSourceVideo: (videoUrl: string) => Promise<ContentSourceResult>
}
