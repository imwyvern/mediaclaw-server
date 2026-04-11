import type {
  PlatformDeepInsight,
  PlatformIncrementalState,
  TikHubPlatformAdapter,
} from './adapters/platform-adapter.interface'
import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { ProxyAgent } from 'undici'
import { createTikHubPlatformAdapters } from './adapters/platform-adapter.registry'
import {
  ContentProvider,
  ContentProviderSearchItem,
} from './content-provider.interface'
import {
  SUPPORTED_TIKHUB_PLATFORMS,
  TikHubPlatform,
} from './tikhub.platforms'

export type { TikHubPlatform } from './tikhub.platforms'

type RequestMethod = 'GET' | 'POST'

interface TikHubRequestContract {
  method: RequestMethod
  url: string
  headers: Record<string, string>
  query?: Record<string, string | number | boolean>
  body?: Record<string, string | number | boolean>
  note: string
}

export interface SearchVideoSummary extends ContentProviderSearchItem {
  insights?: PlatformDeepInsight | null
  creatorProfile?: TikHubCreatorProfile | null
  incrementalState?: PlatformIncrementalState | null
  collectorHealth?: TikHubCollectorHealth | null
  trackedAccount?: TikHubTrackedAccountSnapshot | null
}

interface TikHubVideoDetailData {
  platform: TikHubPlatform
  videoId: string
  title: string
  author: string
  creatorId?: string
  creatorProfileUrl?: string
  description: string
  durationSeconds: number
  contentUrl: string
  thumbnailUrl: string
  metrics: {
    views: number
    likes: number
    comments: number
    shares: number
  }
}

interface TikHubSourceVideoData {
  downloadUrl: string
  filename: string
  expiresAt: string
  videoId?: string
  title?: string
}

export interface TikHubVideoComment {
  commentId: string
  author: string
  content: string
  likeCount: number
  replyCount: number
  publishedAt: string
}

export interface TikHubCreatorProfile {
  creatorId: string
  nickname: string
  avatarUrl: string
  followerCount: number
  followingCount: number
  likeCount: number
  bio: string
  profileUrl: string
}

interface TikHubCreatorProfileData {
  profile: TikHubCreatorProfile
  recentPosts: SearchVideoSummary[]
}

interface TikHubCreatorContracts {
  resolve?: TikHubRequestContract | null
  profile: TikHubRequestContract
  posts: TikHubRequestContract
}

interface PlatformContract {
  search: TikHubRequestContract
  detail: TikHubRequestContract
  sourceByShareUrl: TikHubRequestContract
}

interface TikHubSearchOptions {
  incrementalState?: PlatformIncrementalState
  enrichDepth?: 'basic' | 'deep'
}

interface TikHubCreatorTrackOptions {
  creatorId?: string
  accountUrl?: string
  limit?: number
  incrementalState?: PlatformIncrementalState
  trackedVideoIds?: string[]
  previousMetrics?: Record<string, number> | null
}

interface TikHubRequestExecutionOptions {
  platform: TikHubPlatform
  operation: string
}

interface TikHubCollectorHealth {
  platform: TikHubPlatform | 'all'
  requestCount: number
  successCount: number
  failureCount: number
  rateLimitedCount: number
  proxyRotationCount: number
  consecutiveFailures: number
  averageLatencyMs: number
  currentProxy: string | null
  lastError: string
  lastSuccessAt: string | null
  lastRateLimitedAt: string | null
}

interface TikHubCollectorHealthState {
  requestCount: number
  successCount: number
  failureCount: number
  rateLimitedCount: number
  proxyRotationCount: number
  consecutiveFailures: number
  totalLatencyMs: number
  currentProxy: string | null
  lastError: string
  lastSuccessAt: string | null
  lastRateLimitedAt: string | null
}

interface TikHubTrackedAccountSnapshot {
  creatorId: string
  accountUrl: string
  isNewWork: boolean
  metricDelta: {
    views: number
    likes: number
    comments: number
    shares: number
  }
  snapshotAt: string
}

class TikHubRequestError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
    readonly rateLimited = false,
  ) {
    super(message)
    this.name = 'TikHubRequestError'
  }
}

@Injectable()
export class TikHubService implements ContentProvider {
  private readonly logger = new Logger(TikHubService.name)
  private readonly defaultBaseUrl = 'https://api.tikhub.io'
  private readonly requestTimeoutMs = 5000
  // Search endpoints are materially slower than detail/share-url endpoints in production.
  private readonly searchRequestTimeoutMs = 12000
  private readonly maxAttempts = 3
  private readonly platformAdapters = createTikHubPlatformAdapters()
  private readonly collectorHealth = new Map<TikHubPlatform, TikHubCollectorHealthState>()
  private proxyCursor = 0
  readonly providerName = 'tikhub'
  readonly priority = 10

  /**
   * TikHub contract notes:
   * - All requests use `Authorization: Bearer ${TIKHUB_API_KEY}`.
   * - Douyin search/detail endpoints align to the documented search-v2 and single-video APIs.
   * - Xiaohongshu uses search-notes and video-note-detail endpoints.
   * - Kuaishou search/detail use the documented `search_video_v2` and single-video endpoints.
   * - Bilibili search/detail use the documented general-search and single-video endpoints.
   */
  async searchVideos(platform: string, keyword: string, limit = 10) {
    return this.searchPlatformVideos(platform, keyword, limit)
  }

  async searchVideosIncremental(
    platform: string,
    keyword: string,
    limit = 10,
    options: TikHubSearchOptions = {},
  ) {
    return this.searchPlatformVideos(platform, keyword, limit, options)
  }

  async trackCreatorAccount(platform: string, input: TikHubCreatorTrackOptions) {
    const normalizedPlatform = this.assertPlatform(platform)
    const safeLimit = this.normalizeLimit(input.limit || 10)
    const profileResponse = await this.getCreatorProfile(normalizedPlatform, {
      creatorId: input.creatorId,
      accountUrl: input.accountUrl,
      limit: safeLimit,
      state: input.incrementalState,
    })
    const trackingState = profileResponse.pagination || input.incrementalState || {}
    const trackedVideoIds = new Set(
      (input.trackedVideoIds || []).map(item => item.trim()).filter(Boolean),
    )
    const metricsBaseline = input.previousMetrics || null

    const items = (profileResponse.data?.recentPosts || []).map((item) => {
      const isNewWork = !trackedVideoIds.has(item.videoId)
      const metricDelta = this.calculateMetricDelta(item.metrics, metricsBaseline)
      return {
        ...item,
        creatorProfile: profileResponse.data?.profile || null,
        incrementalState: trackingState,
        collectorHealth: this.getAcquisitionHealth(normalizedPlatform),
        trackedAccount: {
          creatorId: profileResponse.data?.profile.creatorId || input.creatorId || '',
          accountUrl: input.accountUrl || profileResponse.data?.profile.profileUrl || '',
          isNewWork,
          metricDelta,
          snapshotAt: new Date().toISOString(),
        },
      }
    })

    return {
      provider: this.providerName,
      source: profileResponse.source,
      platform: normalizedPlatform,
      creatorId: profileResponse.creatorId,
      accountUrl: input.accountUrl || '',
      pagination: trackingState,
      health: this.getAcquisitionHealth(normalizedPlatform),
      profile: profileResponse.data?.profile || null,
      items,
    }
  }

  getAcquisitionHealth(platform?: TikHubPlatform): TikHubCollectorHealth {
    if (platform) {
      return this.serializeCollectorHealth(platform, this.ensureCollectorHealth(platform))
    }

    const states = Array.from(this.collectorHealth.entries())
    const aggregate: TikHubCollectorHealthState = states.reduce<TikHubCollectorHealthState>(
      (accumulator, [, state]) => ({
        requestCount: accumulator.requestCount + state.requestCount,
        successCount: accumulator.successCount + state.successCount,
        failureCount: accumulator.failureCount + state.failureCount,
        rateLimitedCount: accumulator.rateLimitedCount + state.rateLimitedCount,
        proxyRotationCount: accumulator.proxyRotationCount + state.proxyRotationCount,
        consecutiveFailures: Math.max(accumulator.consecutiveFailures, state.consecutiveFailures),
        totalLatencyMs: accumulator.totalLatencyMs + state.totalLatencyMs,
        currentProxy: state.currentProxy || accumulator.currentProxy,
        lastError: state.lastError || accumulator.lastError,
        lastSuccessAt: state.lastSuccessAt || accumulator.lastSuccessAt,
        lastRateLimitedAt: state.lastRateLimitedAt || accumulator.lastRateLimitedAt,
      }),
      {
        requestCount: 0,
        successCount: 0,
        failureCount: 0,
        rateLimitedCount: 0,
        proxyRotationCount: 0,
        consecutiveFailures: 0,
        totalLatencyMs: 0,
        currentProxy: null,
        lastError: '',
        lastSuccessAt: null,
        lastRateLimitedAt: null,
      },
    )

    return this.serializeCollectorHealth('all', aggregate)
  }

  private async searchPlatformVideos(
    platform: string,
    keyword: string,
    limit = 10,
    options: TikHubSearchOptions = {},
  ) {
    const normalizedPlatform = this.assertPlatform(platform)
    const safeKeyword = keyword.trim()
    if (!safeKeyword) {
      throw new BadRequestException('keyword is required')
    }

    const safeLimit = this.normalizeLimit(limit)
    const contract = this.buildPlatformContract(normalizedPlatform, {
      keyword: safeKeyword,
      limit: safeLimit,
      state: options.incrementalState,
    })

    if (!this.hasApiKey()) {
      this.warnUnavailable('searchVideos')
      return {
        provider: this.providerName,
        source: 'unavailable',
        reason: 'TIKHUB_API_KEY not configured',
        platform: normalizedPlatform,
        keyword: safeKeyword,
        limit: safeLimit,
        request: contract.search,
        pagination: options.incrementalState || null,
        health: this.getAcquisitionHealth(normalizedPlatform),
        items: [],
      }
    }

    const response = await this.requestWithRetry<Record<string, unknown>>(
      contract.search,
      this.resolveSearchTimeoutMs(),
      {
        platform: normalizedPlatform,
        operation: 'search',
      },
    )
    const pagination = this.getPlatformAdapter(normalizedPlatform).extractSearchState(response)
    let items: SearchVideoSummary[] = this.parseSearchResponse(normalizedPlatform, response, safeLimit).map(item => ({
      ...item,
      incrementalState: pagination,
      collectorHealth: this.getAcquisitionHealth(normalizedPlatform),
    }))
    if (options.enrichDepth === 'deep') {
      items = await this.enrichSearchItems(normalizedPlatform, items)
    }

    return {
      provider: this.providerName,
      source: 'tikhub',
      platform: normalizedPlatform,
      keyword: safeKeyword,
      limit: safeLimit,
      request: contract.search,
      pagination,
      health: this.getAcquisitionHealth(normalizedPlatform),
      items,
    }
  }

  async getVideoDetail(platform: string, videoId: string) {
    const normalizedPlatform = this.assertPlatform(platform)
    const safeVideoId = videoId.trim()
    if (!safeVideoId) {
      throw new BadRequestException('videoId is required')
    }

    const contract = this.buildPlatformContract(normalizedPlatform, {
      videoId: safeVideoId,
    })

    if (!this.hasApiKey()) {
      this.warnUnavailable('getVideoDetail')
      return {
        provider: this.providerName,
        source: 'unavailable',
        reason: 'TIKHUB_API_KEY not configured',
        platform: normalizedPlatform,
        videoId: safeVideoId,
        request: contract.detail,
        data: null,
      }
    }

    const response = await this.requestWithRetry<Record<string, unknown>>(contract.detail, this.requestTimeoutMs, {
      platform: normalizedPlatform,
      operation: 'detail',
    })

    return {
      provider: this.providerName,
      source: 'tikhub',
      platform: normalizedPlatform,
      videoId: safeVideoId,
      request: contract.detail,
      data: this.parseDetailResponse(normalizedPlatform, response, safeVideoId),
    }
  }

  async trackPerformance(videoId: string) {
    const safeVideoId = videoId.trim()
    if (!safeVideoId) {
      throw new BadRequestException('videoId is required')
    }

    if (!this.hasApiKey()) {
      this.warnUnavailable('trackPerformance')
      return {
        provider: this.providerName,
        source: 'unavailable',
        reason: 'TIKHUB_API_KEY not configured',
        videoId: safeVideoId,
        data: null,
      }
    }

    // Try to detect platform from videoId format and fetch real data
    const platforms = ['douyin', 'xhs', 'kuaishou', 'bilibili'] as const
    for (const platform of platforms) {
      try {
        const contract = this.buildPlatformContract(platform, { videoId: safeVideoId })
        const response = await this.requestWithRetry<Record<string, unknown>>(contract.detail, this.requestTimeoutMs, {
          platform,
          operation: 'detail',
        })
        const data = this.parseDetailResponse(platform, response, safeVideoId)
        if (data) {
          return {
            provider: this.providerName,
            source: 'tikhub',
            platform,
            videoId: safeVideoId,
            data,
          }
        }
      }
      catch {
        continue
      }
    }

    return {
      provider: this.providerName,
      source: 'unavailable',
      reason: 'Could not resolve platform for videoId',
      videoId: safeVideoId,
      data: null,
    }
  }

  async getSourceVideo(videoUrl: string) {
    const safeVideoUrl = videoUrl.trim()
    if (!safeVideoUrl) {
      throw new BadRequestException('videoUrl is required')
    }

    const platform = this.detectPlatformFromUrl(safeVideoUrl)
    const normalizedShareUrl = platform === 'bilibili'
      ? await this.normalizeBilibiliShareUrl(safeVideoUrl)
      : safeVideoUrl
    const contract = this.buildPlatformContract(platform, {
      shareUrl: normalizedShareUrl,
    })

    if (!this.hasApiKey()) {
      this.warnUnavailable('getSourceVideo')
      return {
        provider: this.providerName,
        source: 'unavailable',
        reason: 'TIKHUB_API_KEY not configured',
        platform,
        videoUrl: normalizedShareUrl,
        request: contract.sourceByShareUrl,
        data: null,
      }
    }

    const response = await this.requestWithRetry<Record<string, unknown>>(contract.sourceByShareUrl, this.requestTimeoutMs, {
      platform,
      operation: 'source',
    })
    const data = platform === 'bilibili'
      ? await this.resolveBilibiliSourceVideo(normalizedShareUrl, response)
      : this.parseSourceResponse(platform, response, normalizedShareUrl)

    return {
      provider: this.providerName,
      source: 'tikhub',
      platform,
      videoUrl: normalizedShareUrl,
      request: contract.sourceByShareUrl,
      data,
    }
  }

  async getVideoComments(
    platform: string,
    input: {
      videoId?: string
      videoUrl?: string
      limit?: number
    },
  ) {
    const normalizedPlatform = this.assertPlatform(platform)
    const safeLimit = Math.min(Math.max(Math.trunc(Number(input.limit) || 50), 1), 50)
    const safeVideoUrl = input.videoUrl?.trim() || ''
    let safeVideoId = input.videoId?.trim() || ''

    if (!safeVideoId && safeVideoUrl) {
      const source = await this.getSourceVideo(safeVideoUrl)
      safeVideoId = source.data?.videoId?.trim() || ''
    }

    if (!safeVideoId) {
      throw new BadRequestException('videoId or resolvable videoUrl is required')
    }

    const request = this.buildCommentContract(normalizedPlatform, safeVideoId, safeLimit)

    if (!this.hasApiKey()) {
      this.warnUnavailable('getVideoComments')
      return {
        provider: this.providerName,
        source: 'unavailable',
        reason: 'TIKHUB_API_KEY not configured',
        platform: normalizedPlatform,
        videoId: safeVideoId,
        videoUrl: safeVideoUrl,
        limit: safeLimit,
        request,
        comments: [] as TikHubVideoComment[],
      }
    }

    const response = await this.requestWithRetry<Record<string, unknown>>(request, this.requestTimeoutMs, {
      platform: normalizedPlatform,
      operation: 'comments',
    })

    return {
      provider: this.providerName,
      source: 'tikhub',
      platform: normalizedPlatform,
      videoId: safeVideoId,
      videoUrl: safeVideoUrl,
      limit: safeLimit,
      request,
      comments: this.parseCommentsResponse(normalizedPlatform, response, safeLimit),
    }
  }

  async getCreatorProfile(
    platform: string,
    input: {
      creatorId?: string
      accountUrl?: string
      limit?: number
      state?: PlatformIncrementalState
    },
  ) {
    const normalizedPlatform = this.assertPlatform(platform)
    const safeAccountUrl = input.accountUrl?.trim() || ''
    const safeLimit = Math.min(Math.max(Math.trunc(Number(input.limit) || 20), 1), 20)
    const directCreatorId = input.creatorId?.trim()
      || this.extractCreatorIdFromUrl(normalizedPlatform, safeAccountUrl)
    if (!this.hasApiKey() && !directCreatorId) {
      this.warnUnavailable('getCreatorProfile')
      return {
        provider: this.providerName,
        source: 'unavailable',
        reason: 'TIKHUB_API_KEY not configured',
        platform: normalizedPlatform,
        creatorId: '',
        accountUrl: safeAccountUrl,
        limit: safeLimit,
        requests: null,
        data: null as TikHubCreatorProfileData | null,
      }
    }

    const resolved = directCreatorId
      ? { creatorId: directCreatorId }
      : await this.resolveCreatorIdentity(
          normalizedPlatform,
          input.creatorId?.trim() || '',
          safeAccountUrl,
        )
    const contracts = this.buildCreatorContracts(
      normalizedPlatform,
      resolved.creatorId,
      safeLimit,
      safeAccountUrl,
      input.state,
    )

    if (!this.hasApiKey()) {
      this.warnUnavailable('getCreatorProfile')
      return {
        provider: this.providerName,
        source: 'unavailable',
        reason: 'TIKHUB_API_KEY not configured',
        platform: normalizedPlatform,
        creatorId: resolved.creatorId,
        accountUrl: safeAccountUrl,
        limit: safeLimit,
        requests: contracts as TikHubCreatorContracts | null,
        data: null as TikHubCreatorProfileData | null,
      }
    }

    const [profilePayload, postsPayload] = await Promise.all([
      this.requestWithRetry<Record<string, unknown>>(contracts.profile, this.requestTimeoutMs, {
        platform: normalizedPlatform,
        operation: 'creator-profile',
      }),
      this.requestWithRetry<Record<string, unknown>>(contracts.posts, this.resolveSearchTimeoutMs(), {
        platform: normalizedPlatform,
        operation: 'creator-posts',
      }),
    ])
    const pagination = this.getPlatformAdapter(normalizedPlatform).extractCreatorPostState(postsPayload)

    return {
      provider: this.providerName,
      source: 'tikhub',
      platform: normalizedPlatform,
      creatorId: resolved.creatorId,
      accountUrl: safeAccountUrl,
      limit: safeLimit,
      requests: contracts,
      pagination,
      health: this.getAcquisitionHealth(normalizedPlatform),
      data: this.parseCreatorProfileResponse(
        normalizedPlatform,
        profilePayload,
        postsPayload,
        resolved.creatorId,
        safeLimit,
        safeAccountUrl,
      ),
    }
  }

  supportsPlatform(platform: string) {
    try {
      this.assertPlatform(platform)
      return true
    }
    catch {
      return false
    }
  }

  private buildPlatformContract(
    platform: TikHubPlatform,
    params: {
      keyword?: string
      limit?: number
      videoId?: string
      shareUrl?: string
      state?: PlatformIncrementalState
    },
  ): PlatformContract {
    const headers = this.getHeaders()
    const baseUrl = this.getBaseUrl()
    const bilibiliVideoId = this.extractBilibiliVideoId(params.shareUrl || '') || params.videoId || ''
    const adapter = this.getPlatformAdapter(platform)
    const searchPagination = adapter.applySearchPagination(params.limit || 10, params.state)

    const contractMap: Record<TikHubPlatform, PlatformContract> = {
      douyin: {
        search: {
          method: 'POST',
          url: `${baseUrl}/api/v1/douyin/search/fetch_video_search_v2`,
          headers,
          body: {
            keyword: params.keyword || '',
            cursor: 0,
            sort_type: '0',
            publish_time: '0',
            filter_duration: '0',
            content_type: '0',
            backtrace: '',
            search_id: '',
            ...searchPagination.body,
          },
          query: searchPagination.query,
          note: 'Douyin video search V2 uses POST body with keyword, cursor, and search filters.',
        },
        detail: {
          method: 'GET',
          url: `${baseUrl}/api/v1/douyin/web/fetch_one_video`,
          headers,
          query: {
            aweme_id: params.videoId || '',
            need_anchor_info: false,
          },
          note: 'Douyin detail API accepts aweme_id and optional anchor-info switch.',
        },
        sourceByShareUrl: {
          method: 'GET',
          url: `${baseUrl}/api/v1/douyin/web/fetch_one_video_by_share_url`,
          headers,
          query: {
            share_url: params.shareUrl || '',
          },
          note: 'Douyin share URL endpoint returns source video metadata and play addresses.',
        },
      },
      xhs: {
        search: {
          method: 'GET',
          url: `${baseUrl}/api/v1/xiaohongshu/web/search_notes`,
          headers,
          query: {
            keyword: params.keyword || '',
            page: 1,
            sort: 'general',
            noteType: '_1',
            noteTime: '',
            ...searchPagination.query,
          },
          body: searchPagination.body,
          note: 'Xiaohongshu web search is page-based and supports sort, noteType, and noteTime filters.',
        },
        detail: {
          method: 'GET',
          url: `${baseUrl}/api/v1/xiaohongshu/app_v2/get_video_note_detail`,
          headers,
          query: {
            note_id: params.videoId || '',
          },
          note: 'Video note detail is the preferred endpoint for Xiaohongshu video metadata.',
        },
        sourceByShareUrl: {
          method: 'GET',
          url: `${baseUrl}/api/v1/xiaohongshu/app/get_video_note_info`,
          headers,
          query: {
            share_text: params.shareUrl || '',
          },
          note: 'Share text can be passed directly when note_id is not yet resolved.',
        },
      },
      kuaishou: {
        search: {
          method: 'GET',
          url: `${baseUrl}/api/v1/kuaishou/app/search_video_v2`,
          headers,
          query: {
            keyword: params.keyword || '',
            page: 1,
            ...searchPagination.query,
          },
          body: searchPagination.body,
          note: 'Kuaishou search V2 uses keyword plus page-based pagination.',
        },
        detail: {
          method: 'GET',
          url: `${baseUrl}/api/v1/kuaishou/app/fetch_one_video_v2`,
          headers,
          query: {
            photo_id: params.videoId || '',
          },
          note: 'Single-video V2 handles both numeric ids and eID-style ids.',
        },
        sourceByShareUrl: {
          method: 'GET',
          url: `${baseUrl}/api/v1/kuaishou/app/fetch_one_video_by_url`,
          headers,
          query: {
            url: params.shareUrl || '',
          },
          note: 'Kuaishou share URL is resolved through the documented by-url endpoint.',
        },
      },
      bilibili: {
        search: {
          method: 'GET',
          url: `${baseUrl}/api/v1/bilibili/web/fetch_general_search`,
          headers,
          query: {
            keyword: params.keyword || '',
            order: 'totalrank',
            page: 1,
            page_size: params.limit || 10,
            duration: 0,
            ...searchPagination.query,
          },
          body: searchPagination.body,
          note: 'Bilibili general search covers video ranking and supports page_size directly.',
        },
        detail: {
          method: 'GET',
          url: `${baseUrl}/api/v1/bilibili/web/fetch_one_video`,
          headers,
          query: {
            bv_id: params.videoId || '',
          },
          note: 'Bilibili single-video detail requires bv_id.',
        },
        sourceByShareUrl: {
          method: 'GET',
          url: `${baseUrl}/api/v1/bilibili/web/fetch_one_video`,
          headers,
          query: {
            bv_id: bilibiliVideoId,
          },
          note: 'Bilibili share URL needs to be normalized to BV id first, then playurl is fetched downstream.',
        },
      },
    }

    return contractMap[platform]
  }

  private buildCommentContract(
    platform: TikHubPlatform,
    videoId: string,
    limit: number,
  ): TikHubRequestContract {
    const baseUrl = this.getBaseUrl()
    const headers = this.getHeaders()

    const contractMap: Record<TikHubPlatform, TikHubRequestContract> = {
      douyin: {
        method: 'POST',
        url: `${baseUrl}/api/v1/douyin/web/fetch_video_comments`,
        headers,
        body: {
          aweme_id: videoId,
          cursor: 0,
          count: limit,
        },
        note: 'Douyin comments endpoint fetches top-level comments by aweme_id.',
      },
      xhs: {
        method: 'GET',
        url: `${baseUrl}/api/v1/xiaohongshu/web/get_note_comments`,
        headers,
        query: {
          note_id: videoId,
          cursor: '',
          num: limit,
        },
        note: 'Xiaohongshu comments endpoint returns note comments by note_id.',
      },
      kuaishou: {
        method: 'GET',
        url: `${baseUrl}/api/v1/kuaishou/web/fetch_video_comments`,
        headers,
        query: {
          photo_id: videoId,
          pcursor: '',
          count: limit,
        },
        note: 'Kuaishou comments endpoint uses photo_id and cursor-based paging.',
      },
      bilibili: {
        method: 'GET',
        url: `${baseUrl}/api/v1/bilibili/web/fetch_video_comments`,
        headers,
        query: {
          bv_id: videoId,
          page: 1,
          page_size: limit,
        },
        note: 'Bilibili comments endpoint returns replies for a BV video id.',
      },
    }

    return contractMap[platform]
  }

  private buildCreatorContracts(
    platform: TikHubPlatform,
    creatorId: string,
    limit: number,
    accountUrl: string,
    state?: PlatformIncrementalState,
  ): TikHubCreatorContracts {
    const baseUrl = this.getBaseUrl()
    const headers = this.getHeaders()
    const adapter = this.getPlatformAdapter(platform)
    const pagination = adapter.applyCreatorPostPagination(limit, state)

    const contractMap: Record<TikHubPlatform, TikHubCreatorContracts> = {
      douyin: {
        profile: {
          method: 'POST',
          url: `${baseUrl}/api/v1/douyin/web/handler_user_profile`,
          headers,
          body: {
            sec_user_id: creatorId,
          },
          note: 'Douyin creator profile endpoint reads sec_user_id from body.',
        },
        posts: {
          method: 'POST',
          url: `${baseUrl}/api/v1/douyin/web/fetch_user_post_videos`,
          headers,
          body: {
            sec_user_id: creatorId,
            max_cursor: 0,
            count: limit,
            ...pagination.body,
          },
          query: pagination.query,
          note: 'Douyin user posts endpoint returns latest aweme items.',
        },
      },
      xhs: {
        profile: {
          method: 'GET',
          url: `${baseUrl}/api/v1/xiaohongshu/web/get_user_info`,
          headers,
          query: {
            user_id: creatorId,
          },
          note: 'Xiaohongshu user info endpoint resolves profile by user_id.',
        },
        posts: {
          method: 'GET',
          url: `${baseUrl}/api/v1/xiaohongshu/web/get_user_notes`,
          headers,
          query: {
            user_id: creatorId,
            cursor: '',
            num: limit,
            ...pagination.query,
          },
          body: pagination.body,
          note: 'Xiaohongshu user notes endpoint returns latest notes for the creator.',
        },
      },
      kuaishou: {
        profile: {
          method: 'GET',
          url: `${baseUrl}/api/v1/kuaishou/web/fetch_user_info`,
          headers,
          query: {
            user_id: creatorId,
          },
          note: 'Kuaishou profile endpoint resolves creator metrics by user_id.',
        },
        posts: {
          method: 'GET',
          url: `${baseUrl}/api/v1/kuaishou/web/fetch_user_post`,
          headers,
          query: {
            user_id: creatorId,
            pcursor: '',
            count: limit,
            ...pagination.query,
          },
          body: pagination.body,
          note: 'Kuaishou user post endpoint returns the latest photos/videos.',
        },
      },
      bilibili: {
        resolve: accountUrl
          ? {
              method: 'GET',
              url: `${baseUrl}/api/v1/bilibili/web/fetch_get_user_id`,
              headers,
              query: {
                url: accountUrl,
              },
              note: 'Bilibili user id resolver returns mid from the space URL.',
            }
          : null,
        profile: {
          method: 'GET',
          url: `${baseUrl}/api/v1/bilibili/web/fetch_user_profile`,
          headers,
          query: {
            mid: creatorId,
          },
          note: 'Bilibili creator profile endpoint returns card/stat by mid.',
        },
        posts: {
          method: 'GET',
          url: `${baseUrl}/api/v1/bilibili/app/fetch_user_videos`,
          headers,
          query: {
            mid: creatorId,
            pn: 1,
            ps: limit,
            ...pagination.query,
          },
          body: pagination.body,
          note: 'Bilibili user videos endpoint returns creator archive list by mid.',
        },
      },
    }

    return contractMap[platform]
  }

  private async requestWithRetry<T>(
    request: TikHubRequestContract,
    timeoutMs = this.requestTimeoutMs,
    options?: TikHubRequestExecutionOptions,
  ): Promise<T> {
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const startedAt = Date.now()
      try {
        const proxyAssignment = options?.platform
          ? this.rotateProxy(options.platform, attempt)
          : null
        const result = await this.executeRequest<T>(request, timeoutMs, proxyAssignment?.agent)
        if (options?.platform) {
          this.markCollectorSuccess(options.platform, Date.now() - startedAt, proxyAssignment?.label || null)
        }
        return result
      }
      catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown TikHub request error')
        if (options?.platform) {
          this.markCollectorFailure(
            options.platform,
            Date.now() - startedAt,
            lastError,
            error instanceof TikHubRequestError ? error.rateLimited : false,
            attempt > 1,
          )
        }
        if (attempt < this.maxAttempts) {
          this.logger.warn(
            `Request retry ${attempt}/${this.maxAttempts - 1} failed: ${lastError.message}`,
          )
          await this.sleep(this.resolveRetryDelayMs(attempt, error))
        }
      }
    }

    throw lastError || new Error('TikHub request failed')
  }

  private async executeRequest<T>(
    request: TikHubRequestContract,
    timeoutMs = this.requestTimeoutMs,
    proxyAgent?: ProxyAgent,
  ): Promise<T> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const url = this.buildRequestUrl(request)

    try {
      const response = await fetch(url, {
        method: request.method,
        headers: request.headers,
        body: request.method === 'POST' && request.body
          ? JSON.stringify(request.body)
          : undefined,
        signal: controller.signal,
        dispatcher: proxyAgent,
      } as RequestInit & { dispatcher?: ProxyAgent })
      const rawText = await response.text()

      if (!response.ok) {
        throw new TikHubRequestError(
          `TikHub request failed with ${response.status}: ${rawText || url}`,
          response.status,
          this.isRateLimitedResponse(response.status, rawText),
        )
      }

      if (!rawText.trim()) {
        return {} as T
      }

      return JSON.parse(rawText) as T
    }
    catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`TikHub request timed out after ${timeoutMs}ms: ${url}`)
      }

      throw error
    }
    finally {
      clearTimeout(timeout)
    }
  }

  private buildRequestUrl(request: TikHubRequestContract) {
    const url = new URL(request.url)

    for (const [key, value] of Object.entries(request.query || {})) {
      url.searchParams.set(key, String(value))
    }

    return url.toString()
  }

  private resolveSearchTimeoutMs() {
    return this.searchRequestTimeoutMs
  }

  private parseSearchResponse(
    platform: TikHubPlatform,
    response: Record<string, unknown>,
    limit: number,
  ): SearchVideoSummary[] {
    const parsers: Record<TikHubPlatform, (payload: Record<string, unknown>, maxItems: number) => SearchVideoSummary[]> = {
      douyin: this.parseDouyinSearchResponse.bind(this),
      xhs: this.parseXhsSearchResponse.bind(this),
      kuaishou: this.parseKuaishouSearchResponse.bind(this),
      bilibili: this.parseBilibiliSearchResponse.bind(this),
    }

    return parsers[platform](response, limit)
  }

  private parseDouyinSearchResponse(payload: Record<string, unknown>, limit: number) {
    const container = this.unwrapData(payload)
    const items = this.pickRecordList(
      container?.['business_data'],
      container?.['data'],
      container?.['items'],
      payload['business_data'],
      payload['data'],
      payload['items'],
    )

    return items.slice(0, limit).map((item) => {
      const aweme = this.pickFirstRecord(
        this.readNested(item, ['data', 'aweme_info']),
        item['aweme_info'],
        item,
      ) || {}
      const author = this.pickFirstRecord(aweme['author'], item['author'])
      const statistics = this.pickFirstRecord(aweme['statistics'], item['statistics'])
      const video = this.pickFirstRecord(aweme['video'], item['video'])

      return this.buildSearchSummary('douyin', {
        videoId: this.readString(aweme['aweme_id'], aweme['id'], item['aweme_id'], item['id']),
        title: this.readString(aweme['desc'], aweme['title'], item['desc'], item['title']),
        author: this.readString(author?.['nickname'], author?.['name']),
        contentUrl: this.readString(
          aweme['share_url'],
          aweme['aweme_url'],
          item['share_url'],
          item['aweme_url'],
        ),
        thumbnailUrl: this.readImageUrl(
          video?.['cover'],
          video?.['origin_cover'],
          aweme['cover'],
          aweme['dynamic_cover'],
          item['cover'],
          item['dynamic_cover'],
        ),
        publishedAt: this.normalizeDate(aweme['create_time'], item['create_time']),
        views: this.readNumber(statistics?.['play_count'], statistics?.['view_count']),
        likes: this.readNumber(statistics?.['digg_count'], statistics?.['like_count']),
        comments: this.readNumber(statistics?.['comment_count']),
        shares: this.readNumber(statistics?.['share_count']),
      })
    })
  }

  private parseXhsSearchResponse(payload: Record<string, unknown>, limit: number) {
    const container = this.unwrapData(payload)
    const items = this.pickRecordList(
      container?.['items'],
      container?.['notes'],
      payload['items'],
      payload['data'],
    )

    return items.slice(0, limit).map((item) => {
      const note = this.pickFirstRecord(item['note'], item['note_card'], item)
      const user = this.pickFirstRecord(note?.['user'], item['user'])
      const interactInfo = this.pickFirstRecord(note?.['interact_info'], item['interact_info'])

      return this.buildSearchSummary('xhs', {
        videoId: this.readString(note?.['note_id'], item['id']),
        title: this.readString(note?.['display_title'], note?.['title'], note?.['desc']),
        author: this.readString(user?.['nickname'], user?.['nick_name'], user?.['name']),
        contentUrl: this.readString(note?.['share_url']),
        thumbnailUrl: this.readImageUrl(
          note?.['cover'],
          note?.['image_list'],
          note?.['images_list'],
          note?.['note_card'],
        ),
        publishedAt: this.normalizeDate(
          note?.['time'],
          note?.['publish_time'],
          note?.['create_time'],
        ),
        views: this.readNumber(interactInfo?.['view_count'], note?.['view_count']),
        likes: this.readNumber(interactInfo?.['liked_count'], note?.['liked_count']),
        comments: this.readNumber(interactInfo?.['comment_count'], note?.['comment_count']),
        shares: this.readNumber(interactInfo?.['share_count'], note?.['share_count']),
      })
    })
  }

  private parseKuaishouSearchResponse(payload: Record<string, unknown>, limit: number) {
    const container = this.unwrapData(payload)
    const items = this.pickRecordList(
      container?.['data'],
      container?.['items'],
      container?.['photos'],
      this.readNested(container, ['visionSearchPhoto', 'photos']),
      payload['data'],
    )

    return items.slice(0, limit).map((item) => {
      const author = this.pickFirstRecord(item['author'], item['user'])
      const stats = this.pickFirstRecord(item['stats'], item['statistics'])

      return this.buildSearchSummary('kuaishou', {
        videoId: this.readString(item['photo_id'], item['id']),
        title: this.readString(item['caption'], item['title'], item['desc']),
        author: this.readString(author?.['name'], author?.['user_name'], item['user_name']),
        contentUrl: this.readString(item['share_url'], item['photo_url']),
        thumbnailUrl: this.readImageUrl(item['cover_url'], item['cover'], item['thumbnail_url']),
        publishedAt: this.normalizeDate(item['timestamp'], item['create_time']),
        views: this.readNumber(stats?.['play_count'], item['view_count'], item['play_count']),
        likes: this.readNumber(stats?.['like_count'], item['like_count'], item['real_like_count']),
        comments: this.readNumber(stats?.['comment_count'], item['comment_count']),
        shares: this.readNumber(stats?.['share_count'], item['share_count']),
      })
    })
  }

  private parseBilibiliSearchResponse(payload: Record<string, unknown>, limit: number) {
    const container = this.unwrapData(payload)
    const items = this.pickRecordList(
      container?.['result'],
      container?.['items'],
      payload['result'],
      payload['data'],
    )

    return items.slice(0, limit).map(item => this.buildSearchSummary('bilibili', {
      videoId: this.readString(item['bvid'], item['bv_id'], item['id']),
      title: this.stripMarkup(this.readString(item['title'], item['desc'])),
      author: this.readString(item['author'], item['uname'], item['up_name']),
      contentUrl: this.readString(item['arcurl'], item['share_url']),
      thumbnailUrl: this.readImageUrl(item['pic'], item['cover']),
      publishedAt: this.normalizeDate(item['pubdate'], item['create_time']),
      views: this.readNumber(item['play'], item['view_count']),
      likes: this.readNumber(item['like'], item['favorites'], item['favorite']),
      comments: this.readNumber(item['review'], item['video_review'], item['comment_count']),
      shares: this.readNumber(item['share'], item['share_count']),
    }))
  }

  private parseDetailResponse(
    platform: TikHubPlatform,
    payload: Record<string, unknown>,
    fallbackVideoId: string,
  ): TikHubVideoDetailData {
    const detail = this.extractDetailRecord(platform, payload)
    const author = this.pickFirstRecord(detail['author'], detail['user'], detail['owner'])
    const statistics = this.pickFirstRecord(
      detail['statistics'],
      detail['stats'],
      this.readNested(detail, ['stat']),
      this.readNested(detail, ['interact_info']),
    )

    return {
      platform,
      videoId: this.readString(
        detail['aweme_id'],
        detail['note_id'],
        detail['photo_id'],
        detail['bvid'],
        detail['bv_id'],
      ) || fallbackVideoId,
      title: this.stripMarkup(this.readString(detail['title'], detail['desc'], detail['display_title'])),
      author: this.readString(author?.['nickname'], author?.['name'], author?.['uname']),
      creatorId: this.readString(
        author?.['sec_user_id'],
        author?.['user_id'],
        author?.['uid'],
        author?.['mid'],
        author?.['id'],
      ) || undefined,
      creatorProfileUrl: this.readString(
        author?.['profile_url'],
        author?.['homepage'],
        author?.['space_url'],
      ) || undefined,
      description: this.stripMarkup(this.readString(detail['desc'], detail['title'], detail['summary'])),
      durationSeconds: this.normalizeDurationSeconds(
        detail['duration'],
        detail['duration_ms'],
        detail['video_duration'],
      ),
      contentUrl: this.readString(
        detail['share_url'],
        detail['aweme_url'],
        detail['jump_url'],
        detail['short_link_v2'],
      ) || this.defaultContentUrl(platform, fallbackVideoId),
      thumbnailUrl: this.readImageUrl(
        detail['cover'],
        detail['dynamic_cover'],
        detail['pic'],
        detail['thumbnail'],
        detail['image_list'],
      ),
      metrics: {
        views: this.readNumber(statistics?.['play_count'], statistics?.['view_count'], statistics?.['view']),
        likes: this.readNumber(statistics?.['digg_count'], statistics?.['like_count'], statistics?.['likes']),
        comments: this.readNumber(statistics?.['comment_count'], statistics?.['reply']),
        shares: this.readNumber(statistics?.['share_count'], statistics?.['share']),
      },
    }
  }

  private parseSourceResponse(
    platform: TikHubPlatform,
    payload: Record<string, unknown>,
    shareUrl: string,
  ): TikHubSourceVideoData {
    const detail = this.extractDetailRecord(platform, payload)
    const videoId = this.readString(
      detail['aweme_id'],
      detail['note_id'],
      detail['photo_id'],
      detail['bvid'],
      detail['bv_id'],
    )
    const downloadUrl = this.readString(
      this.readNested(detail, ['video', 'download_addr', 'url_list', 0]),
      this.readNested(detail, ['video', 'play_addr', 'url_list', 0]),
      this.readNested(detail, ['video', 'media', 'stream', 'h264', 0, 'master_url']),
      this.readNested(detail, ['video', 'media', 'stream', 'h265', 0, 'master_url']),
      this.readNested(detail, ['dash', 'video', 0, 'base_url']),
      this.readNested(detail, ['durl', 0, 'url']),
      detail['download_url'],
      detail['play_url'],
      detail['url'],
    )

    return {
      downloadUrl: downloadUrl || shareUrl,
      filename: this.buildSourceFilename(platform, videoId),
      expiresAt: this.addDays(1),
      videoId: videoId || undefined,
      title: this.readString(detail['title'], detail['desc'], detail['display_title']) || undefined,
    }
  }

  private parseCommentsResponse(
    platform: TikHubPlatform,
    payload: Record<string, unknown>,
    limit: number,
  ) {
    const container = this.unwrapData(payload)
    const items = this.pickRecordList(
      container['comments'],
      container['comment_list'],
      container['replies'],
      container['items'],
      payload['comments'],
      payload['data'],
    )

    return items.slice(0, limit).map((item) => {
      const author = this.pickFirstRecord(
        item['user'],
        item['author'],
        item['member'],
        item['upper'],
      )
      const content = platform === 'bilibili'
        ? this.readString(
            this.readNested(item, ['content', 'message']),
            item['message'],
            item['text'],
          )
        : this.readString(
            this.readNested(item, ['content', 'text']),
            this.readNested(item, ['text_extra', 0, 'hashtag_name']),
            item['content'],
            item['text'],
            item['desc'],
          )

      return {
        commentId: this.readString(
          item['cid'],
          item['comment_id'],
          item['id'],
          item['rpid'],
        ),
        author: this.readString(
          author?.['nickname'],
          author?.['name'],
          author?.['uname'],
          item['user_name'],
        ),
        content,
        likeCount: this.readNumber(
          item['like_count'],
          item['likeCount'],
          item['like'],
          this.readNested(item, ['count', 'like']),
        ),
        replyCount: this.readNumber(
          item['reply_count'],
          item['replyCount'],
          item['reply'],
          this.readNested(item, ['count', 'reply']),
        ),
        publishedAt: this.normalizeDate(
          item['create_time'],
          item['ctime'],
          item['time'],
          item['ip_location'],
        ),
      }
    })
  }

  private parseCreatorProfileResponse(
    platform: TikHubPlatform,
    profilePayload: Record<string, unknown>,
    postsPayload: Record<string, unknown>,
    creatorId: string,
    limit: number,
    accountUrl: string,
  ): TikHubCreatorProfileData {
    const profile = this.parseCreatorProfileRecord(
      platform,
      profilePayload,
      creatorId,
      accountUrl,
    )
    const recentPosts = this.parseCreatorPostsResponse(
      platform,
      postsPayload,
      limit,
      profile,
    )

    return {
      profile,
      recentPosts,
    }
  }

  private async enrichSearchItems(
    platform: TikHubPlatform,
    items: SearchVideoSummary[],
  ) {
    const enrichedItems: SearchVideoSummary[] = []

    for (const item of items) {
      enrichedItems.push(await this.enrichSingleItem(platform, item))
    }

    return enrichedItems
  }

  private async enrichSingleItem(
    platform: TikHubPlatform,
    item: SearchVideoSummary,
  ) {
    let detail: TikHubVideoDetailData | null = null
    let comments: TikHubVideoComment[] = []
    let creatorProfile: TikHubCreatorProfile | null = null

    try {
      detail = (await this.getVideoDetail(platform, item.videoId)).data
    }
    catch (error) {
      this.logger.warn(`Deep detail enrichment skipped for ${platform}:${item.videoId}: ${this.stringifyError(error)}`)
    }

    try {
      comments = (await this.getVideoComments(platform, {
        videoId: item.videoId,
        limit: 20,
      })).comments
    }
    catch (error) {
      this.logger.warn(`Comment enrichment skipped for ${platform}:${item.videoId}: ${this.stringifyError(error)}`)
    }

    const creatorId = detail?.creatorId || ''
    if (creatorId) {
      try {
        creatorProfile = (await this.getCreatorProfile(platform, {
          creatorId,
          accountUrl: detail?.creatorProfileUrl,
          limit: 10,
        })).data?.profile || null
      }
      catch (error) {
        this.logger.warn(`Creator enrichment skipped for ${platform}:${item.videoId}: ${this.stringifyError(error)}`)
      }
    }

    const adapter = this.getPlatformAdapter(platform)
    const insight = adapter.buildDeepInsight({
      title: item.title,
      description: detail?.description || item.title,
      author: item.author,
      durationSeconds: detail?.durationSeconds || 0,
      publishedAt: item.publishedAt,
      metrics: item.metrics,
      comments: comments.map(comment => ({
        content: comment.content,
        likeCount: comment.likeCount,
      })),
      creatorStats: creatorProfile
        ? {
            followerCount: creatorProfile.followerCount,
            followingCount: creatorProfile.followingCount,
            likeCount: creatorProfile.likeCount,
            bio: creatorProfile.bio,
            recentPostHours: [],
          }
        : null,
    })

    return {
      ...item,
      insights: insight,
      creatorProfile,
      collectorHealth: this.getAcquisitionHealth(platform),
    }
  }

  private calculateMetricDelta(
    metrics: SearchVideoSummary['metrics'],
    previousMetrics?: Record<string, number> | null,
  ) {
    const base = previousMetrics || {}
    return {
      views: Math.max(0, this.readNumber(metrics.views) - this.readNumber(base['views'])),
      likes: Math.max(0, this.readNumber(metrics.likes) - this.readNumber(base['likes'])),
      comments: Math.max(0, this.readNumber(metrics.comments) - this.readNumber(base['comments'])),
      shares: Math.max(0, this.readNumber(metrics.shares) - this.readNumber(base['shares'])),
    }
  }

  private getPlatformAdapter(platform: TikHubPlatform): TikHubPlatformAdapter {
    return this.platformAdapters[platform]
  }

  private getProxyPool() {
    return (process.env['TIKHUB_PROXY_POOL'] || '')
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
  }

  private rotateProxy(platform: TikHubPlatform, attempt: number) {
    const proxies = this.getProxyPool()
    if (proxies.length === 0) {
      return null
    }

    const index = (this.proxyCursor + Math.max(0, attempt - 1)) % proxies.length
    this.proxyCursor = (index + 1) % proxies.length
    const label = proxies[index] || ''

    return {
      label,
      agent: new ProxyAgent(label),
    }
  }

  private resolveRetryDelayMs(attempt: number, error: unknown) {
    const baseDelayMs = error instanceof TikHubRequestError && error.rateLimited
      ? 2500
      : 600
    return baseDelayMs * attempt
  }

  private isRateLimitedResponse(statusCode: number, payload: string) {
    if ([402, 403, 429].includes(statusCode)) {
      return true
    }

    const normalizedPayload = payload.toLowerCase()
    return normalizedPayload.includes('rate limit')
      || normalizedPayload.includes('too many requests')
      || normalizedPayload.includes('quota')
  }

  private ensureCollectorHealth(platform: TikHubPlatform) {
    const existing = this.collectorHealth.get(platform)
    if (existing) {
      return existing
    }

    const initialState: TikHubCollectorHealthState = {
      requestCount: 0,
      successCount: 0,
      failureCount: 0,
      rateLimitedCount: 0,
      proxyRotationCount: 0,
      consecutiveFailures: 0,
      totalLatencyMs: 0,
      currentProxy: null,
      lastError: '',
      lastSuccessAt: null,
      lastRateLimitedAt: null,
    }
    this.collectorHealth.set(platform, initialState)
    return initialState
  }

  private markCollectorSuccess(
    platform: TikHubPlatform,
    latencyMs: number,
    proxyLabel: string | null,
  ) {
    const state = this.ensureCollectorHealth(platform)
    state.requestCount += 1
    state.successCount += 1
    state.totalLatencyMs += Math.max(0, latencyMs)
    state.consecutiveFailures = 0
    state.currentProxy = proxyLabel
    state.lastSuccessAt = new Date().toISOString()
  }

  private markCollectorFailure(
    platform: TikHubPlatform,
    latencyMs: number,
    error: Error,
    rateLimited: boolean,
    rotatedProxy: boolean,
  ) {
    const state = this.ensureCollectorHealth(platform)
    state.requestCount += 1
    state.failureCount += 1
    state.totalLatencyMs += Math.max(0, latencyMs)
    state.consecutiveFailures += 1
    state.lastError = error.message
    if (rateLimited) {
      state.rateLimitedCount += 1
      state.lastRateLimitedAt = new Date().toISOString()
    }
    if (rotatedProxy) {
      state.proxyRotationCount += 1
    }
  }

  private serializeCollectorHealth(
    platform: TikHubPlatform | 'all',
    state: TikHubCollectorHealthState,
  ): TikHubCollectorHealth {
    return {
      platform,
      requestCount: state.requestCount,
      successCount: state.successCount,
      failureCount: state.failureCount,
      rateLimitedCount: state.rateLimitedCount,
      proxyRotationCount: state.proxyRotationCount,
      consecutiveFailures: state.consecutiveFailures,
      averageLatencyMs: state.requestCount > 0
        ? Number((state.totalLatencyMs / state.requestCount).toFixed(2))
        : 0,
      currentProxy: state.currentProxy,
      lastError: state.lastError,
      lastSuccessAt: state.lastSuccessAt,
      lastRateLimitedAt: state.lastRateLimitedAt,
    }
  }

  private parseCreatorProfileRecord(
    platform: TikHubPlatform,
    payload: Record<string, unknown>,
    creatorId: string,
    accountUrl: string,
  ): TikHubCreatorProfile {
    const container = this.unwrapData(payload)
    const profile = this.pickFirstRecord(
      container['user'],
      container['user_info'],
      container['profile'],
      container['card'],
      container['data'],
      container,
    ) || {}
    const stats = this.pickFirstRecord(
      profile['stats'],
      profile['stat'],
      profile['statistics'],
      this.readNested(profile, ['interactions']),
    ) || {}

    return {
      creatorId: this.readString(
        profile['sec_user_id'],
        profile['user_id'],
        profile['id'],
        profile['mid'],
        creatorId,
      ) || creatorId,
      nickname: this.readString(
        profile['nickname'],
        profile['name'],
        profile['uname'],
        profile['nick_name'],
      ),
      avatarUrl: this.readImageUrl(
        profile['avatar_thumb'],
        profile['avatar_medium'],
        profile['avatar'],
        profile['face'],
        this.readNested(profile, ['images', 0]),
      ),
      followerCount: this.readNumber(
        stats['follower_count'],
        stats['fans'],
        stats['fans_count'],
        stats['follower'],
      ),
      followingCount: this.readNumber(
        stats['following_count'],
        stats['follow'],
        stats['follow_count'],
        stats['friend'],
      ),
      likeCount: this.readNumber(
        stats['total_favorited'],
        stats['liked_count'],
        stats['like_num'],
        stats['likes'],
      ),
      bio: this.readString(
        profile['signature'],
        profile['desc'],
        profile['bio'],
        profile['sign'],
      ),
      profileUrl: accountUrl || this.defaultProfileUrl(platform, creatorId),
    }
  }

  private parseCreatorPostsResponse(
    platform: TikHubPlatform,
    payload: Record<string, unknown>,
    limit: number,
    profile: TikHubCreatorProfile,
  ) {
    const container = this.unwrapData(payload)
    const items = this.pickRecordList(
      container['aweme_list'],
      container['items'],
      container['notes'],
      container['photos'],
      container['list'],
      container['archives'],
      this.readNested(container, ['list', 'vlist']),
      this.readNested(container, ['data', 'list']),
      payload['items'],
      payload['data'],
    )

    const summaries = items.slice(0, limit).map((item) => {
      const author = this.pickFirstRecord(item['author'], item['user'], item['owner'])
      const stats = this.pickFirstRecord(
        item['statistics'],
        item['stat'],
        item['stats'],
        item['interact_info'],
      )

      return this.buildSearchSummary(platform, {
        videoId: this.readString(
          item['aweme_id'],
          item['note_id'],
          item['photo_id'],
          item['bvid'],
          item['bv_id'],
          item['id'],
        ),
        title: this.stripMarkup(
          this.readString(
            item['desc'],
            item['title'],
            item['display_title'],
          ),
        ),
        author: this.readString(
          author?.['nickname'],
          author?.['name'],
          author?.['uname'],
          profile.nickname,
        ),
        contentUrl: this.readString(
          item['share_url'],
          item['arcurl'],
          item['jump_url'],
        ),
        thumbnailUrl: this.readImageUrl(
          item['cover'],
          item['pic'],
          item['dynamic_cover'],
          this.readNested(item, ['video', 'cover']),
          this.readNested(item, ['video', 'origin_cover']),
        ),
        publishedAt: this.normalizeDate(
          item['create_time'],
          item['pubdate'],
          item['publish_time'],
          item['timestamp'],
        ),
        views: this.readNumber(
          stats?.['play_count'],
          stats?.['view'],
          stats?.['view_count'],
          item['play'],
        ),
        likes: this.readNumber(
          stats?.['digg_count'],
          stats?.['like_count'],
          stats?.['likes'],
          item['like'],
          item['favorite'],
        ),
        comments: this.readNumber(
          stats?.['comment_count'],
          stats?.['reply'],
          item['review'],
          item['comment_count'],
        ),
        shares: this.readNumber(
          stats?.['share_count'],
          stats?.['share'],
          item['share'],
          item['share_count'],
        ),
      })
    })

    return summaries.filter(item => Boolean(item.videoId))
  }

  private async resolveBilibiliSourceVideo(
    shareUrl: string,
    detailPayload: Record<string, unknown>,
  ): Promise<TikHubSourceVideoData> {
    const detail = this.extractDetailRecord('bilibili', detailPayload)
    const videoId = this.readString(detail['bvid'], detail['bv_id']) || this.extractBilibiliVideoId(shareUrl)
    const cid = this.readString(
      detail['cid'],
      this.readNested(detail, ['pages', 0, 'cid']),
    )

    if (!videoId || !cid) {
      return this.parseSourceResponse('bilibili', detailPayload, shareUrl)
    }

    const playPayload = await this.requestWithRetry<Record<string, unknown>>({
      method: 'GET',
      url: `${this.getBaseUrl()}/api/v1/bilibili/web/fetch_video_playurl`,
      headers: this.getHeaders(),
      query: {
        bv_id: videoId,
        cid,
      },
      note: 'Bilibili source flow resolves playurl after fetching video detail.',
    })

    const playData = this.unwrapData(playPayload)
    const downloadUrl = this.readString(
      this.readNested(playData, ['durl', 0, 'url']),
      this.readNested(playData, ['dash', 'video', 0, 'base_url']),
      this.readNested(playData, ['dash', 'video', 0, 'baseUrl']),
      playData?.['url'],
    )

    return {
      downloadUrl: downloadUrl || this.readString(detail['arcurl']) || shareUrl,
      filename: this.buildSourceFilename('bilibili', videoId),
      expiresAt: this.addDays(1),
      videoId,
      title: this.readString(detail['title'], detail['desc']) || undefined,
    }
  }

  private extractDetailRecord(platform: TikHubPlatform, payload: Record<string, unknown>) {
    const container = this.unwrapData(payload)

    switch (platform) {
      case 'douyin':
        return this.pickFirstRecord(
          container,
          container?.['aweme_detail'],
          container?.['aweme_info'],
          container?.['data'],
        ) || {}
      case 'xhs':
        return this.pickFirstRecord(
          container?.['note'],
          container?.['note_card'],
          this.pickRecordList(container?.['items'])[0],
          container,
        ) || {}
      case 'kuaishou':
        return this.pickFirstRecord(
          container?.['photo'],
          container?.['currentWork'],
          container?.['data'],
          container,
        ) || {}
      case 'bilibili':
        return this.pickFirstRecord(
          container?.['View'],
          container?.['data'],
          container,
        ) || {}
      default:
        return {}
    }
  }

  private buildSearchSummary(
    platform: TikHubPlatform,
    input: {
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
    },
  ): SearchVideoSummary {
    return {
      platform,
      videoId: input.videoId,
      title: input.title || `${platform} 视频`,
      author: input.author || `${platform}-creator`,
      contentUrl: input.contentUrl || this.defaultContentUrl(platform, input.videoId),
      thumbnailUrl: input.thumbnailUrl,
      publishedAt: input.publishedAt || new Date().toISOString(),
      metrics: {
        views: input.views,
        likes: input.likes,
        comments: input.comments,
        shares: input.shares,
      },
    }
  }

  private async resolveCreatorIdentity(
    platform: TikHubPlatform,
    creatorId: string,
    accountUrl: string,
  ) {
    if (creatorId) {
      return { creatorId }
    }

    const extracted = this.extractCreatorIdFromUrl(platform, accountUrl)
    if (extracted) {
      return { creatorId: extracted }
    }

    if (!accountUrl) {
      throw new BadRequestException('creatorId or accountUrl is required')
    }

    const resolveContract = this.buildCreatorResolveContract(platform, accountUrl)
    if (!resolveContract) {
      throw new BadRequestException('Unable to resolve creatorId from accountUrl')
    }

    const response = await this.requestWithRetry<Record<string, unknown>>(resolveContract)
    const resolvedCreatorId = this.readString(
      this.readNested(response, ['data', 'sec_user_id']),
      this.readNested(response, ['data', 'user_id']),
      this.readNested(response, ['data', 'mid']),
      this.readNested(response, ['data', 'uid']),
      this.readNested(response, ['sec_user_id']),
      this.readNested(response, ['user_id']),
      this.readNested(response, ['mid']),
      this.readNested(response, ['uid']),
    )

    if (!resolvedCreatorId) {
      throw new BadRequestException('Unable to resolve creatorId from accountUrl')
    }

    return { creatorId: resolvedCreatorId }
  }

  private buildCreatorResolveContract(
    platform: TikHubPlatform,
    accountUrl: string,
  ): TikHubRequestContract | null {
    const baseUrl = this.getBaseUrl()
    const headers = this.getHeaders()

    switch (platform) {
      case 'douyin':
        return {
          method: 'GET',
          url: `${baseUrl}/api/v1/douyin/web/get_sec_user_id`,
          headers,
          query: {
            profile_url: accountUrl,
          },
          note: 'Douyin sec_user_id resolver resolves creator id from profile url.',
        }
      case 'bilibili':
        return {
          method: 'GET',
          url: `${baseUrl}/api/v1/bilibili/web/fetch_get_user_id`,
          headers,
          query: {
            url: accountUrl,
          },
          note: 'Bilibili user id resolver resolves creator mid from profile url.',
        }
      default:
        return null
    }
  }

  private extractCreatorIdFromUrl(platform: TikHubPlatform, accountUrl: string) {
    if (!accountUrl) {
      return ''
    }

    let pathname = accountUrl
    try {
      pathname = new URL(accountUrl).pathname
    }
    catch {
      pathname = accountUrl
    }

    const segments = pathname
      .split('/')
      .map(segment => segment.trim())
      .filter(Boolean)

    if (platform === 'bilibili') {
      const midMatch = accountUrl.match(/space\.bilibili\.com\/(\d+)/i)
      if (midMatch?.[1]) {
        return midMatch[1]
      }
    }

    return segments.at(-1) || ''
  }

  private assertPlatform(platform: string): TikHubPlatform {
    const normalizedPlatform = this.normalizePlatformInput(platform)
    if ((SUPPORTED_TIKHUB_PLATFORMS as readonly string[]).includes(normalizedPlatform)) {
      return normalizedPlatform as TikHubPlatform
    }

    throw new BadRequestException(`platform must be one of: ${SUPPORTED_TIKHUB_PLATFORMS.join(', ')}`)
  }

  private normalizePlatformInput(platform: string) {
    const normalized = platform.trim().toLowerCase()
    if (normalized === 'xiaohongshu' || normalized === 'rednote') {
      return 'xhs'
    }

    return normalized
  }

  private normalizeLimit(limit: number) {
    if (!Number.isFinite(limit)) {
      return 10
    }

    return Math.min(Math.max(Math.trunc(limit), 1), 50)
  }

  private hasApiKey() {
    return Boolean(process.env['TIKHUB_API_KEY']?.trim())
  }

  private getBaseUrl() {
    return (process.env['TIKHUB_BASE_URL'] || this.defaultBaseUrl).replace(/\/+$/, '')
  }

  private getHeaders() {
    return {
      'Authorization': `Bearer ${process.env['TIKHUB_API_KEY'] || ''}`,
      'Content-Type': 'application/json',
    }
  }

  private detectPlatformFromUrl(videoUrl: string): TikHubPlatform {
    const normalizedUrl = videoUrl.toLowerCase()

    if (normalizedUrl.includes('douyin')) {
      return 'douyin'
    }

    if (normalizedUrl.includes('xiaohongshu') || normalizedUrl.includes('xhslink')) {
      return 'xhs'
    }

    if (normalizedUrl.includes('kuaishou')) {
      return 'kuaishou'
    }

    if (normalizedUrl.includes('bilibili') || normalizedUrl.includes('b23.tv')) {
      return 'bilibili'
    }

    throw new BadRequestException('Unable to infer platform from videoUrl')
  }

  private async normalizeBilibiliShareUrl(videoUrl: string): Promise<string> {
    const directVideoId = this.extractBilibiliVideoId(videoUrl)
    if (directVideoId) {
      return videoUrl
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs)

    try {
      const response = await fetch(videoUrl, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
      })
      return response.url || videoUrl
    }
    catch {
      return videoUrl
    }
    finally {
      clearTimeout(timeout)
    }
  }

  private extractBilibiliVideoId(url: string): string {
    const match = url.match(/BV[a-z0-9]+/i)
    return match?.[0] || ''
  }

  private unwrapData(payload: Record<string, unknown>): Record<string, unknown> {
    let current = this.pickFirstRecord(payload['data'], payload) || {}

    while (true) {
      const next = this.asRecord(current['data'])
      if (!next) {
        return current
      }

      current = next
    }
  }

  private pickRecordList(...candidates: unknown[]): Record<string, unknown>[] {
    for (const candidate of candidates) {
      if (!Array.isArray(candidate)) {
        continue
      }

      const items = candidate
        .map(item => this.asRecord(item))
        .filter((item): item is Record<string, unknown> => Boolean(item))

      if (items.length > 0) {
        return items
      }
    }

    return [] as Record<string, unknown>[]
  }

  private pickFirstRecord(...candidates: unknown[]): Record<string, unknown> | null {
    for (const candidate of candidates) {
      const record = this.asRecord(candidate)
      if (record) {
        return record
      }
    }

    return null
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>
    }

    return null
  }

  private readNested(value: unknown, path: Array<string | number>): unknown {
    let current: unknown = value
    for (const segment of path) {
      if (typeof segment === 'number') {
        if (!Array.isArray(current) || current.length <= segment) {
          return undefined
        }
        current = current[segment]
        continue
      }

      const record = this.asRecord(current)
      if (!record) {
        return undefined
      }
      current = record[segment]
    }

    return current
  }

  private readString(...candidates: unknown[]): string {
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim()
      }
      if (typeof candidate === 'number' && Number.isFinite(candidate)) {
        return String(candidate)
      }
    }

    return ''
  }

  private readNumber(...candidates: unknown[]): number {
    for (const candidate of candidates) {
      if (typeof candidate === 'number' && Number.isFinite(candidate)) {
        return Math.max(0, candidate)
      }
      if (typeof candidate === 'string' && candidate.trim()) {
        const parsed = Number(candidate)
        if (Number.isFinite(parsed)) {
          return Math.max(0, parsed)
        }
      }
    }

    return 0
  }

  private readImageUrl(...candidates: unknown[]): string {
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return this.normalizeUrl(candidate.trim())
      }

      if (Array.isArray(candidate) && candidate.length > 0) {
        const arrayUrl = this.readImageUrl(candidate[0])
        if (arrayUrl) {
          return arrayUrl
        }
      }

      const record = this.asRecord(candidate)
      if (!record) {
        continue
      }

      const direct = this.readString(
        record['url'],
        record['src'],
        record['default'],
        record['url_default'],
        record['image_url'],
      )
      if (direct) {
        return this.normalizeUrl(direct)
      }

      const listUrl = this.readString(
        this.readNested(record, ['url_list', 0]),
        this.readNested(record, ['urls', 0]),
        this.readNested(record, ['list', 0]),
      )
      if (listUrl) {
        return this.normalizeUrl(listUrl)
      }
    }

    return ''
  }

  private normalizeDate(...candidates: unknown[]): string {
    for (const candidate of candidates) {
      if (candidate instanceof Date) {
        return candidate.toISOString()
      }

      if (typeof candidate === 'number' && Number.isFinite(candidate)) {
        const timestamp = candidate > 1e12 ? candidate : candidate * 1000
        return new Date(timestamp).toISOString()
      }

      if (typeof candidate === 'string' && candidate.trim()) {
        const numeric = Number(candidate)
        if (Number.isFinite(numeric)) {
          const timestamp = numeric > 1e12 ? numeric : numeric * 1000
          return new Date(timestamp).toISOString()
        }

        const parsed = new Date(candidate)
        if (!Number.isNaN(parsed.getTime())) {
          return parsed.toISOString()
        }
      }
    }

    return new Date().toISOString()
  }

  private normalizeDurationSeconds(...candidates: unknown[]): number {
    const duration = this.readNumber(...candidates)
    if (duration <= 0) {
      return 0
    }

    return duration > 1000 ? Math.round(duration / 1000) : Math.round(duration)
  }

  private normalizeUrl(url: string): string {
    if (url.startsWith('//')) {
      return `https:${url}`
    }

    return url
  }

  private defaultContentUrl(platform: TikHubPlatform, videoId: string): string {
    if (!videoId) {
      return ''
    }

    const contentUrlMap: Record<TikHubPlatform, string> = {
      douyin: `https://www.douyin.com/video/${videoId}`,
      xhs: `https://www.xiaohongshu.com/explore/${videoId}`,
      kuaishou: `https://www.kuaishou.com/short-video/${videoId}`,
      bilibili: `https://www.bilibili.com/video/${videoId}`,
    }

    return contentUrlMap[platform]
  }

  private buildSourceFilename(platform: TikHubPlatform, videoId: string): string {
    return `${platform}-${videoId || 'source-video'}.mp4`
  }

  private defaultProfileUrl(platform: TikHubPlatform, creatorId: string): string {
    if (!creatorId) {
      return ''
    }

    const profileUrlMap: Record<TikHubPlatform, string> = {
      douyin: `https://www.douyin.com/user/${creatorId}`,
      xhs: `https://www.xiaohongshu.com/user/profile/${creatorId}`,
      kuaishou: `https://www.kuaishou.com/profile/${creatorId}`,
      bilibili: `https://space.bilibili.com/${creatorId}`,
    }

    return profileUrlMap[platform]
  }

  private stripMarkup(text: string): string {
    return text.replace(/<[^>]+>/g, '').trim()
  }

  private warnUnavailable(method: string) {
    this.logger.warn(`${method} unavailable because TIKHUB_API_KEY is not configured.`)
  }

  private stringifyError(error: unknown) {
    return error instanceof Error ? error.message : String(error)
  }

  private async sleep(ms: number) {
    await new Promise(resolve => setTimeout(resolve, ms))
  }

  private addDays(days: number): string {
    const date = new Date()
    date.setDate(date.getDate() + days)
    return date.toISOString()
  }
}
