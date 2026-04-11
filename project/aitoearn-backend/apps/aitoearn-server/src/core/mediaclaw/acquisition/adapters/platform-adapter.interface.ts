import type { TikHubPlatform } from '../tikhub.platforms'

export interface PlatformIncrementalState {
  cursor?: string
  watermark?: string
  page?: number
}

export interface PlatformCommentSentiment {
  positive: number
  neutral: number
  negative: number
  score: number
}

export interface PlatformCreatorPersona {
  segment: string
  creatorArchetype: string
  engagementStyle: string
  postingCadence: string
  audienceTags: string[]
}

export interface PlatformPublishDistribution {
  bucket: string
  peakHour: number
  hourlyDistribution: number[]
  weekdayDistribution: Record<string, number>
}

export interface PlatformInsightSeed {
  title: string
  description: string
  author: string
  durationSeconds: number
  publishedAt?: string | null
  metrics: {
    views: number
    likes: number
    comments: number
    shares: number
  }
  comments: Array<{
    content: string
    likeCount: number
  }>
  creatorStats?: {
    followerCount: number
    followingCount: number
    likeCount: number
    bio: string
    recentPostHours: number[]
  } | null
  keywords?: string[]
}

export interface PlatformDeepInsight {
  completionRate: number
  commentSentiment: PlatformCommentSentiment
  creatorPersona: PlatformCreatorPersona
  publishDistribution: PlatformPublishDistribution
}

export interface PlatformPaginationPatch {
  query?: Record<string, string | number | boolean>
  body?: Record<string, string | number | boolean>
}

export interface TikHubPlatformAdapter {
  readonly platform: TikHubPlatform
  applySearchPagination: (limit: number, state?: PlatformIncrementalState) => PlatformPaginationPatch
  applyCreatorPostPagination: (limit: number, state?: PlatformIncrementalState) => PlatformPaginationPatch
  extractSearchState: (payload: Record<string, unknown>) => PlatformIncrementalState
  extractCreatorPostState: (payload: Record<string, unknown>) => PlatformIncrementalState
  buildDeepInsight: (seed: PlatformInsightSeed) => PlatformDeepInsight
}
