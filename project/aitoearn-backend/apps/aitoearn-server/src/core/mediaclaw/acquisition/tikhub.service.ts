import { BadRequestException, Injectable } from '@nestjs/common'

const SUPPORTED_TIKHUB_PLATFORMS = ['douyin', 'xhs', 'kuaishou', 'bilibili'] as const

export type TikHubPlatform = typeof SUPPORTED_TIKHUB_PLATFORMS[number]

type RequestMethod = 'GET' | 'POST'

interface TikHubStubRequest {
  method: RequestMethod
  url: string
  headers: Record<string, string>
  query?: Record<string, string | number | boolean>
  body?: Record<string, string | number | boolean>
  note: string
}

export interface SearchVideoSummary {
  platform: TikHubPlatform
  videoId: string
  title: string
  author: string
  contentUrl: string
  thumbnailUrl: string
  publishedAt: string
  metrics: {
    views: number
    likes: number
    comments: number
    shares: number
  }
}

interface TikHubVideoDetailData {
  platform: TikHubPlatform
  videoId: string
  title: string
  author: string
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

interface PlatformContract {
  search: TikHubStubRequest
  detail: TikHubStubRequest
  sourceByShareUrl: TikHubStubRequest
}

@Injectable()
export class TikHubService {
  private readonly defaultBaseUrl = 'https://api.tikhub.io'
  private readonly requestTimeoutMs = 5000
  private readonly maxAttempts = 2

  /**
   * TikHub contract notes:
   * - All requests use `Authorization: Bearer ${TIKHUB_API_KEY}`.
   * - Douyin search/detail endpoints align to the documented search and single-video APIs.
   * - Xiaohongshu uses search-notes and video-note-detail endpoints.
   * - Kuaishou search/detail use the documented `search_video_v2` and single-video endpoints.
   * - Bilibili search/detail use the documented general-search and single-video endpoints.
   */
  async searchVideos(platform: string, keyword: string, limit = 10) {
    const normalizedPlatform = this.assertPlatform(platform)
    const safeKeyword = keyword.trim()
    if (!safeKeyword) {
      throw new BadRequestException('keyword is required')
    }

    const safeLimit = this.normalizeLimit(limit)
    const contract = this.buildPlatformContract(normalizedPlatform, {
      keyword: safeKeyword,
      limit: safeLimit,
    })

    if (!this.hasApiKey()) {
      this.warnStubFallback('searchVideos')
      return {
        source: 'stub',
        platform: normalizedPlatform,
        keyword: safeKeyword,
        limit: safeLimit,
        request: contract.search,
        items: this.buildSearchStub(normalizedPlatform, safeKeyword, safeLimit),
      }
    }

    const response = await this.requestWithRetry<Record<string, unknown>>(contract.search)
    const items = this.parseSearchResponse(normalizedPlatform, response, safeLimit)

    return {
      source: 'tikhub',
      platform: normalizedPlatform,
      keyword: safeKeyword,
      limit: safeLimit,
      request: contract.search,
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
      this.warnStubFallback('getVideoDetail')
      return {
        source: 'stub',
        platform: normalizedPlatform,
        videoId: safeVideoId,
        request: contract.detail,
        data: this.buildDetailStub(normalizedPlatform, safeVideoId),
      }
    }

    const response = await this.requestWithRetry<Record<string, unknown>>(contract.detail)

    return {
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

    const checkpoints = [1, 3, 7, 30, 90]
    return {
      source: 'stub',
      videoId: safeVideoId,
      strategy: 'resolve platform from stored source metadata, then replay detail endpoint snapshots at each checkpoint',
      checkpoints: checkpoints.map(day => ({
        checkpoint: `T+${day}`,
        scheduledAt: this.addDays(day),
        requestTemplate: {
          douyin: this.buildPlatformContract('douyin', { videoId: safeVideoId }).detail,
          xhs: this.buildPlatformContract('xhs', { videoId: safeVideoId }).detail,
          kuaishou: this.buildPlatformContract('kuaishou', { videoId: safeVideoId }).detail,
          bilibili: this.buildPlatformContract('bilibili', { videoId: safeVideoId }).detail,
        },
        snapshot: {
          views: 1000 * (day + 1),
          likes: 180 * day,
          comments: 36 * day,
          shares: 14 * day,
        },
      })),
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
      this.warnStubFallback('getSourceVideo')
      return {
        source: 'stub',
        platform,
        videoUrl: normalizedShareUrl,
        request: contract.sourceByShareUrl,
        data: this.buildSourceStub(platform),
      }
    }

    const response = await this.requestWithRetry<Record<string, unknown>>(contract.sourceByShareUrl)
    const data = platform === 'bilibili'
      ? await this.resolveBilibiliSourceVideo(normalizedShareUrl, response)
      : this.parseSourceResponse(platform, response, normalizedShareUrl)

    return {
      source: 'tikhub',
      platform,
      videoUrl: normalizedShareUrl,
      request: contract.sourceByShareUrl,
      data,
    }
  }

  private buildPlatformContract(
    platform: TikHubPlatform,
    params: {
      keyword?: string
      limit?: number
      videoId?: string
      shareUrl?: string
    },
  ): PlatformContract {
    const headers = this.getHeaders()
    const baseUrl = this.getBaseUrl()
    const bilibiliVideoId = this.extractBilibiliVideoId(params.shareUrl || '') || params.videoId || ''

    const contractMap: Record<TikHubPlatform, PlatformContract> = {
      douyin: {
        search: {
          method: 'POST',
          url: `${baseUrl}/api/v1/douyin/search/fetch_video_search_v4`,
          headers,
          body: {
            keyword: params.keyword || '',
            offset: 0,
            page: 0,
            backtrace: '',
            search_id: '',
          },
          note: 'Douyin video search V4 uses POST body with keyword and pagination cursor fields.',
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
          url: `${baseUrl}/api/v1/xiaohongshu/app_v2/search_notes`,
          headers,
          query: {
            keyword: params.keyword || '',
            page: 1,
            sort_type: 'general',
            note_type: '视频笔记',
            time_filter: '不限',
            search_id: '',
            search_session_id: '',
            source: 'explore_feed',
            ai_mode: 0,
          },
          note: 'Xiaohongshu search is page-based and supports note-type and time filters.',
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
            pcursor: '',
          },
          note: 'Kuaishou search V2 uses keyword plus cursor-based pagination.',
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
          },
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

  private async requestWithRetry<T>(request: TikHubStubRequest): Promise<T> {
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        return await this.executeRequest<T>(request)
      }
      catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown TikHub request error')
        if (attempt < this.maxAttempts) {
          console.warn(`[TikHubService] request retry ${attempt}/${this.maxAttempts - 1} failed: ${lastError.message}`)
        }
      }
    }

    throw lastError || new Error('TikHub request failed')
  }

  private async executeRequest<T>(request: TikHubStubRequest): Promise<T> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs)
    const url = this.buildRequestUrl(request)

    try {
      const response = await fetch(url, {
        method: request.method,
        headers: request.headers,
        body: request.method === 'POST' && request.body
          ? JSON.stringify(request.body)
          : undefined,
        signal: controller.signal,
      })
      const rawText = await response.text()

      if (!response.ok) {
        throw new Error(`TikHub request failed with ${response.status}: ${rawText || url}`)
      }

      if (!rawText.trim()) {
        return {} as T
      }

      return JSON.parse(rawText) as T
    }
    catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`TikHub request timed out after ${this.requestTimeoutMs}ms: ${url}`)
      }

      throw error
    }
    finally {
      clearTimeout(timeout)
    }
  }

  private buildRequestUrl(request: TikHubStubRequest) {
    const url = new URL(request.url)

    for (const [key, value] of Object.entries(request.query || {})) {
      url.searchParams.set(key, String(value))
    }

    return url.toString()
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
      container?.['data'],
      container?.['items'],
      payload['data'],
      payload['items'],
    )

    return items.slice(0, limit).map(item => {
      const author = this.asRecord(item['author'])
      const statistics = this.asRecord(item['statistics'])
      const video = this.asRecord(item['video'])

      return this.buildSearchSummary('douyin', {
        videoId: this.readString(item['aweme_id'], item['id']),
        title: this.readString(item['desc'], item['title']),
        author: this.readString(author?.['nickname'], author?.['name']),
        contentUrl: this.readString(item['share_url'], item['aweme_url']),
        thumbnailUrl: this.readImageUrl(
          item['cover'],
          item['dynamic_cover'],
          video?.['cover'],
          video?.['origin_cover'],
        ),
        publishedAt: this.normalizeDate(item['create_time']),
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

    return items.slice(0, limit).map(item => {
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

    return items.slice(0, limit).map(item => {
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

  private buildSearchStub(platform: TikHubPlatform, keyword: string, limit: number): SearchVideoSummary[] {
    return Array.from({ length: Math.min(limit, 3) }, (_, index) => ({
      platform,
      videoId: `${platform}-${keyword}-${index + 1}`.replace(/\s+/g, '-').toLowerCase(),
      title: `${keyword} 爆款候选 ${index + 1}`,
      author: `${platform}-author-${index + 1}`,
      contentUrl: `https://content.example.com/${platform}/${index + 1}`,
      thumbnailUrl: `https://images.example.com/${platform}/${index + 1}.jpg`,
      publishedAt: this.addDays(-(index + 1)),
      metrics: {
        views: 5000 + (index + 1) * 2400,
        likes: 800 + (index + 1) * 120,
        comments: 90 + (index + 1) * 18,
        shares: 40 + (index + 1) * 9,
      },
    }))
  }

  private buildDetailStub(platform: TikHubPlatform, videoId: string): TikHubVideoDetailData {
    return {
      platform,
      videoId,
      title: `${videoId} 的平台详情草稿`,
      author: `${platform}-creator`,
      description: '该详情返回当前只做 TikHub 契约占位，待后续切换为真实 HTTP 调用。',
      durationSeconds: 37,
      contentUrl: `https://content.example.com/${platform}/${videoId}`,
      thumbnailUrl: `https://images.example.com/${platform}/${videoId}.jpg`,
      metrics: {
        views: 12600,
        likes: 1180,
        comments: 216,
        shares: 91,
      },
    }
  }

  private buildSourceStub(platform: TikHubPlatform): TikHubSourceVideoData {
    return {
      downloadUrl: `https://downloads.example.com/${platform}/source-video.mp4`,
      filename: `${platform}-source-video.mp4`,
      expiresAt: this.addDays(1),
    }
  }

  private assertPlatform(platform: string): TikHubPlatform {
    if ((SUPPORTED_TIKHUB_PLATFORMS as readonly string[]).includes(platform)) {
      return platform as TikHubPlatform
    }

    throw new BadRequestException(`platform must be one of: ${SUPPORTED_TIKHUB_PLATFORMS.join(', ')}`)
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
    const match = url.match(/BV[a-zA-Z0-9]+/i)
    return match?.[0] || ''
  }

  private unwrapData(payload: Record<string, unknown>): Record<string, unknown> {
    return this.pickFirstRecord(payload['data'], payload) || {}
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

  private stripMarkup(text: string): string {
    return text.replace(/<[^>]+>/g, '').trim()
  }

  private warnStubFallback(method: string) {
    console.warn(`[TikHubService] ${method} fallback to stub because TIKHUB_API_KEY is not configured.`)
  }

  private addDays(days: number): string {
    const date = new Date()
    date.setDate(date.getDate() + days)
    return date.toISOString()
  }
}
