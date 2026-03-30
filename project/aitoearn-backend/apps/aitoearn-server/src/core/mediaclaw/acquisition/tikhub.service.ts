import { BadRequestException, Injectable } from '@nestjs/common'

const SUPPORTED_TIKHUB_PLATFORMS = ['douyin', 'xhs', 'kuaishou', 'bilibili'] as const

type TikHubPlatform = typeof SUPPORTED_TIKHUB_PLATFORMS[number]

type RequestMethod = 'GET' | 'POST'

interface TikHubStubRequest {
  method: RequestMethod
  url: string
  headers: Record<string, string>
  query?: Record<string, string | number | boolean>
  body?: Record<string, string | number | boolean>
  note: string
}

interface SearchVideoSummary {
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

interface PlatformContract {
  search: TikHubStubRequest
  detail: TikHubStubRequest
  sourceByShareUrl: TikHubStubRequest
}

@Injectable()
export class TikHubService {
  private readonly defaultBaseUrl = 'https://api.tikhub.io'

  /**
   * TikHub contract notes:
   * - All requests use `Authorization: Bearer ${TIKHUB_API_KEY}`.
   * - Douyin search/detail endpoints align to the documented search and single-video APIs.
   * - Xiaohongshu uses search-notes and video-note-detail endpoints.
   * - Kuaishou search/detail use the documented `search_video_v2` and single-video endpoints.
   * - Bilibili search/detail use the documented general-search and single-video endpoints.
   * For this sprint we only return a stub request contract so the caller can wire real HTTP execution later.
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

    return {
      source: 'stub',
      platform: normalizedPlatform,
      keyword: safeKeyword,
      limit: safeLimit,
      request: contract.search,
      items: this.buildSearchStub(normalizedPlatform, safeKeyword, safeLimit),
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

    return {
      source: 'stub',
      platform: normalizedPlatform,
      videoId: safeVideoId,
      request: contract.detail,
      data: {
        platform: normalizedPlatform,
        videoId: safeVideoId,
        title: `${safeVideoId} 的平台详情草稿`,
        author: `${normalizedPlatform}-creator`,
        description: `该详情返回当前只做 TikHub 契约占位，待后续切换为真实 HTTP 调用。`,
        durationSeconds: 37,
        contentUrl: `https://content.example.com/${normalizedPlatform}/${safeVideoId}`,
        thumbnailUrl: `https://images.example.com/${normalizedPlatform}/${safeVideoId}.jpg`,
        metrics: {
          views: 12600,
          likes: 1180,
          comments: 216,
          shares: 91,
        },
      },
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
    const contract = this.buildPlatformContract(platform, {
      shareUrl: safeVideoUrl,
    })

    return {
      source: 'stub',
      platform,
      videoUrl: safeVideoUrl,
      request: contract.sourceByShareUrl,
      data: {
        downloadUrl: `https://downloads.example.com/${platform}/source-video.mp4`,
        filename: `${platform}-source-video.mp4`,
        expiresAt: this.addDays(1),
      },
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
            search_id: '',
          },
          note: 'Douyin search API uses POST body with keyword and pagination cursor fields.',
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
          note: 'Use the share URL endpoint first, then resolve the highest quality play URL downstream.',
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
          url: `${baseUrl}/api/v1/kuaishou/web/fetch_one_video_by_url`,
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
            bv_id: params.videoId || '',
          },
          note: 'Bilibili source download flow should resolve bv_id first, then call playurl later.',
        },
      },
    }

    return contractMap[platform]
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

  private getBaseUrl() {
    return (process.env['TIKHUB_BASE_URL'] || this.defaultBaseUrl).replace(/\/+$/, '')
  }

  private getHeaders() {
    return {
      Authorization: `Bearer ${process.env['TIKHUB_API_KEY'] || ''}`,
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

  private addDays(days: number) {
    const date = new Date()
    date.setDate(date.getDate() + days)
    return date.toISOString()
  }
}
