import { SearchVideoSummary } from '../acquisition/tikhub.service'

export type CrawlType
  = | 'keyword'
    | 'video_comments'
    | 'creator_profile'
    | 'competitor_schedule'

interface CrawlQuery {
  platform: string
  keyword: string
  depth: number
}

export interface CrawlSeedResult {
  platform: string
  videoId: string
  title: string
  author: string
  contentUrl: string
  thumbnailUrl: string
  publishedAt: string
  views: number
  likes: number
  comments: number
  shares: number
}

export interface CrawlCommentRecord {
  commentId: string
  author: string
  content: string
  likeCount: number
  replyCount: number
  publishedAt: string
}

export interface CrawlCreatorProfileRecord {
  creatorId: string
  nickname: string
  avatarUrl: string
  followerCount: number
  followingCount: number
  likeCount: number
  bio: string
  profileUrl: string
}

export interface CrawlOptions {
  industry?: string
  keywords?: string[]
  source?: string
  crawlType?: CrawlType
  videoUrl?: string
  videoId?: string
  creatorId?: string
  accountUrl?: string
  orgId?: string
  competitorId?: string
  limit?: number
}

export interface CrawlRouteDecision {
  mode: 'tikhub_only' | 'tikhub_plus_media_crawler_pro'
  reason: string
  tikhubResultCount: number
  requestedDepth: number
  tikhubResponse: {
    provider: string
    source: string
    platform: string
    keyword: string
    limit: number
    request: unknown
    items: SearchVideoSummary[]
  }
  mediaCrawlerPro?: {
    source: 'MediaCrawlerPro'
    request: {
      method: 'POST'
      endpoint: string
      body: {
        platform: string
        keyword: string
        depth: number
      }
      note: string
    }
  }
}

export interface CrawlJobData {
  crawlType: CrawlType
  platform: string
  keyword: string
  depth: number
  resultLimit: number
  industry: string
  keywords: string[]
  source: string
  route: CrawlRouteDecision | null
  seedResults: CrawlSeedResult[]
  videoUrl?: string
  videoId?: string
  creatorId?: string
  accountUrl?: string
  orgId?: string
  competitorId?: string
  createdAt: string
}

export interface CrawlerStoredResult {
  jobId: string
  crawlType: CrawlType
  status: string
  platform: string
  keyword: string
  depth: number
  resultLimit: number
  industry: string
  keywords: string[]
  source: string
  routeMode: string
  targetId: string
  targetUrl: string
  creatorId: string
  orgId: string | null
  competitorId: string | null
  route: unknown
  seededResults: CrawlSeedResult[]
  comments: CrawlCommentRecord[]
  creatorProfile: CrawlCreatorProfileRecord | null
  recentPosts: SearchVideoSummary[]
  contentIds: string[]
  persisted: unknown
  supplementalDispatch: unknown
  supplementalPersisted: unknown
  analysisItems: Record<string, unknown>[]
  error: string
  createdAt: Date | string
  updatedAt: Date | string
  completedAt: Date | string | null
}

export type { CrawlQuery }
