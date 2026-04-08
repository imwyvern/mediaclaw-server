import { Inject, Injectable } from '@nestjs/common'
import {
  CONTENT_PROVIDERS,
  ContentDetailResult,
  ContentProvider,
  ContentSearchResult,
  ContentSourceResult,
  ContentTrackPerformanceResult,
} from './content-provider.interface'

@Injectable()
export class AcquisitionService {
  constructor(
    @Inject(CONTENT_PROVIDERS)
    private readonly providers: ContentProvider[] = [],
  ) {}

  async searchVideos(platform: string, keyword: string, limit = 10): Promise<ContentSearchResult> {
    const candidates = this.resolveProviders(platform)
    let fallback = this.buildSearchUnavailable(platform, keyword, limit, 'no_provider_available')

    for (const provider of candidates) {
      try {
        const result = await provider.searchVideos(platform, keyword, limit)
        fallback = result
        if (result.source !== 'unavailable' && result.items.length > 0) {
          return result
        }
      }
      catch (error) {
        fallback = this.buildSearchUnavailable(
          platform,
          keyword,
          limit,
          `${provider.providerName}:${this.stringifyError(error)}`,
        )
      }
    }

    return fallback
  }

  async getVideoDetail(platform: string, videoId: string): Promise<ContentDetailResult> {
    const candidates = this.resolveProviders(platform)
    let fallback = this.buildDetailUnavailable(platform, videoId, 'no_provider_available')

    for (const provider of candidates) {
      try {
        const result = await provider.getVideoDetail(platform, videoId)
        fallback = result
        if (result.source !== 'unavailable' && result.data) {
          return result
        }
      }
      catch (error) {
        fallback = this.buildDetailUnavailable(
          platform,
          videoId,
          `${provider.providerName}:${this.stringifyError(error)}`,
        )
      }
    }

    return fallback
  }

  async trackPerformance(videoId: string): Promise<ContentTrackPerformanceResult> {
    const candidates = this.resolveProviders()
    let fallback = this.buildTrackUnavailable(videoId, 'no_provider_available')

    for (const provider of candidates) {
      try {
        const result = await provider.trackPerformance(videoId)
        fallback = result
        if (result.source !== 'unavailable' && result.data) {
          return result
        }
      }
      catch (error) {
        fallback = this.buildTrackUnavailable(
          videoId,
          `${provider.providerName}:${this.stringifyError(error)}`,
        )
      }
    }

    return fallback
  }

  async getSourceVideo(videoUrl: string): Promise<ContentSourceResult> {
    const candidates = this.resolveProviders()
    let fallback = this.buildSourceUnavailable(videoUrl, 'no_provider_available')

    for (const provider of candidates) {
      try {
        const result = await provider.getSourceVideo(videoUrl)
        fallback = result
        if (result.source !== 'unavailable' && result.data) {
          return result
        }
      }
      catch (error) {
        fallback = this.buildSourceUnavailable(
          videoUrl,
          `${provider.providerName}:${this.stringifyError(error)}`,
        )
      }
    }

    return fallback
  }

  private resolveProviders(platform?: string) {
    const filtered = platform
      ? this.providers.filter(provider => provider.supportsPlatform(platform))
      : this.providers.slice()

    return filtered.sort(
      (left, right) => (left.priority || 0) - (right.priority || 0),
    )
  }

  private buildSearchUnavailable(
    platform: string,
    keyword: string,
    limit: number,
    reason: string,
  ): ContentSearchResult {
    return {
      provider: 'unavailable',
      source: 'unavailable',
      reason,
      platform,
      keyword,
      limit,
      items: [],
    }
  }

  private buildDetailUnavailable(
    platform: string,
    videoId: string,
    reason: string,
  ): ContentDetailResult {
    return {
      provider: 'unavailable',
      source: 'unavailable',
      reason,
      platform,
      videoId,
      data: null,
    }
  }

  private buildTrackUnavailable(
    videoId: string,
    reason: string,
  ): ContentTrackPerformanceResult {
    return {
      provider: 'unavailable',
      source: 'unavailable',
      reason,
      videoId,
      data: null,
    }
  }

  private buildSourceUnavailable(
    videoUrl: string,
    reason: string,
  ): ContentSourceResult {
    return {
      provider: 'unavailable',
      source: 'unavailable',
      reason,
      platform: '',
      videoUrl,
      data: null,
    }
  }

  private stringifyError(error: unknown) {
    return error instanceof Error ? error.message : String(error)
  }
}
