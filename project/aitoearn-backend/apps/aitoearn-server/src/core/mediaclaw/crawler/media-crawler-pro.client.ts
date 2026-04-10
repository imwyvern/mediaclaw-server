import { Injectable, Logger } from '@nestjs/common'
import axios from 'axios'
import { SearchVideoSummary } from '../acquisition/tikhub.service'
import { MediaclawConfigService } from '../mediaclaw-config.service'

export interface MediaCrawlerProDispatchInput {
  platform: string
  keyword: string
  depth: number
}

export interface MediaCrawlerProDispatchResult {
  source: 'MediaCrawlerPro'
  enabled: boolean
  endpoint: string
  status: 'dispatched' | 'completed' | 'skipped' | 'failed'
  dispatchedAt: string
  jobId?: string
  httpStatus?: number
  note?: string
  error?: string
  items: SearchVideoSummary[]
}

@Injectable()
export class MediaCrawlerProClient {
  private readonly logger = new Logger(MediaCrawlerProClient.name)

  constructor(
    private readonly configService: MediaclawConfigService,
  ) {}

  async submitSupplementalJob(
    input: MediaCrawlerProDispatchInput,
  ): Promise<MediaCrawlerProDispatchResult> {
    const baseUrl = this.configService.getString(
      ['MEDIACLAW_CRAWLER_PRO_BASE_URL', 'MEDIA_CRAWLER_PRO_BASE_URL'],
      '',
    )
    const endpoint = this.resolveEndpoint(baseUrl)
    const dispatchedAt = new Date().toISOString()

    if (!endpoint) {
      return {
        source: 'MediaCrawlerPro',
        enabled: false,
        endpoint: '/internal/media-crawler-pro/jobs',
        status: 'skipped',
        dispatchedAt,
        note: 'MEDIACLAW_CRAWLER_PRO_BASE_URL 未配置，跳过第二层补采调度。',
        items: [],
      }
    }

    try {
      const response = await axios.post(
        endpoint,
        {
          platform: input.platform,
          keyword: input.keyword,
          depth: input.depth,
        },
        {
          timeout: this.configService.getNumber(
            ['MEDIACLAW_CRAWLER_PRO_TIMEOUT_MS', 'MEDIA_CRAWLER_PRO_TIMEOUT_MS'],
            10000,
          ),
          headers: this.buildHeaders(),
        },
      )

      const payload = this.unwrapPayload(response.data)
      const items = this.normalizeItems(payload, input.platform)

      return {
        source: 'MediaCrawlerPro',
        enabled: true,
        endpoint,
        status: this.resolveStatus(payload, items.length),
        dispatchedAt,
        jobId: this.resolveJobId(payload),
        httpStatus: response.status,
        note: items.length > 0
          ? 'MediaCrawlerPro 已返回补采结果，当前 worker 会直接合并写回发现池。'
          : 'MediaCrawlerPro 调度已提交，等待异步补采完成。',
        items,
      }
    }
    catch (error) {
      const message = axios.isAxiosError(error)
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Unknown MediaCrawlerPro error'

      this.logger.warn(
        `MediaCrawlerPro supplemental crawl dispatch failed for ${input.platform}/${input.keyword}: ${message}`,
      )

      return {
        source: 'MediaCrawlerPro',
        enabled: true,
        endpoint,
        status: 'failed',
        dispatchedAt,
        error: message,
        note: 'MediaCrawlerPro 调度失败，本次仅保留 TikHub 种子结果。',
        items: [],
      }
    }
  }

  private buildHeaders() {
    const token = this.configService.getString(
      ['MEDIACLAW_CRAWLER_PRO_TOKEN', 'MEDIA_CRAWLER_PRO_TOKEN'],
      '',
    )

    return {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'x-mediaclaw-source': 'mediaclaw-discovery',
    }
  }

  private resolveEndpoint(baseUrl: string) {
    const normalized = baseUrl.trim().replace(/\/+$/, '')
    if (!normalized) {
      return ''
    }

    if (normalized.endsWith('/internal/media-crawler-pro/jobs')) {
      return normalized
    }

    return `${normalized}/internal/media-crawler-pro/jobs`
  }

  private unwrapPayload(value: unknown): Record<string, unknown> {
    if (!this.isRecord(value)) {
      return {}
    }

    const nested = value['data']
    if (this.isRecord(nested) && this.hasUsefulPayloadKeys(nested)) {
      return nested
    }

    return value
  }

  private hasUsefulPayloadKeys(value: Record<string, unknown>) {
    return [
      'jobId',
      'id',
      'taskId',
      'status',
      'items',
      'results',
      'videos',
    ].some(key => key in value)
  }

  private normalizeItems(value: Record<string, unknown>, platform: string) {
    const items = this.pickArray(value['items'])
      || this.pickArray(value['results'])
      || this.pickArray(value['videos'])
      || []

    return items
      .map(item => this.normalizeItem(item, platform))
      .filter((item): item is SearchVideoSummary => item !== null)
  }

  private normalizeItem(value: unknown, fallbackPlatform: string): SearchVideoSummary | null {
    if (!this.isRecord(value)) {
      return null
    }

    const metrics = this.isRecord(value['metrics']) ? value['metrics'] : {}
    const videoId = this.pickFirstString(
      value['videoId'],
      value['id'],
      value['awemeId'],
      value['noteId'],
      value['itemId'],
    )

    if (!videoId) {
      return null
    }

    return {
      platform: this.pickFirstString(value['platform']) || fallbackPlatform,
      videoId,
      title: this.pickFirstString(value['title'], value['desc'], value['text']) || 'Untitled',
      author: this.pickFirstString(value['author'], value['nickname'], value['userName']) || 'unknown',
      contentUrl: this.pickFirstString(
        value['contentUrl'],
        value['url'],
        value['videoUrl'],
        value['noteUrl'],
      ) || '',
      thumbnailUrl: this.pickFirstString(
        value['thumbnailUrl'],
        value['cover'],
        value['coverUrl'],
        value['imageUrl'],
      ) || '',
      publishedAt: this.pickFirstString(
        value['publishedAt'],
        value['createTime'],
        value['createdAt'],
      ) || new Date().toISOString(),
      metrics: {
        views: this.pickNumber(metrics['views'], value['views']),
        likes: this.pickNumber(metrics['likes'], value['likes']),
        comments: this.pickNumber(metrics['comments'], value['comments']),
        shares: this.pickNumber(metrics['shares'], value['shares']),
      },
    }
  }

  private resolveStatus(value: Record<string, unknown>, itemCount: number) {
    const rawStatus = this.pickFirstString(value['status'], value['state'])
    if (rawStatus) {
      const normalized = rawStatus.toLowerCase()
      if (normalized.includes('complete') || normalized.includes('success')) {
        return 'completed'
      }
      if (normalized.includes('fail') || normalized.includes('error')) {
        return 'failed'
      }
      if (normalized.includes('skip')) {
        return 'skipped'
      }
    }

    return itemCount > 0 ? 'completed' : 'dispatched'
  }

  private resolveJobId(value: Record<string, unknown>) {
    return this.pickFirstString(value['jobId'], value['id'], value['taskId'], value['requestId'])
  }

  private pickArray(value: unknown) {
    return Array.isArray(value) ? value : null
  }

  private pickFirstString(...values: unknown[]) {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim()
      }
    }

    return ''
  }

  private pickNumber(...values: unknown[]) {
    for (const value of values) {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) {
        return parsed
      }
    }

    return 0
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  }
}
