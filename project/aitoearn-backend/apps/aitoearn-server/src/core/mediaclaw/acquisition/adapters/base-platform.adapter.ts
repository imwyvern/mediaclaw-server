import type { TikHubPlatform } from '../tikhub.platforms'
import type {
  PlatformCommentSentiment,
  PlatformCreatorPersona,
  PlatformDeepInsight,
  PlatformIncrementalState,
  PlatformInsightSeed,
  PlatformPaginationPatch,
  PlatformPublishDistribution,
  TikHubPlatformAdapter,
} from './platform-adapter.interface'

const POSITIVE_TOKENS = [
  '好',
  '爱',
  '喜欢',
  '绝',
  '强',
  '赞',
  '值',
  '香',
  '稳',
  '回购',
  '推荐',
  '种草',
  'amazing',
  'great',
  'love',
]

const NEGATIVE_TOKENS = [
  '差',
  '烂',
  '坑',
  '贵',
  '假',
  '失望',
  '难用',
  '翻车',
  '避雷',
  '一般',
  'bad',
  'waste',
]

export abstract class BaseTikHubPlatformAdapter implements TikHubPlatformAdapter {
  protected constructor(
    public readonly platform: TikHubPlatform,
    private readonly platformWeight: number,
    private readonly defaultBucket: string,
  ) {}

  applySearchPagination(limit: number, state?: PlatformIncrementalState): PlatformPaginationPatch {
    return {
      query: {
        page: state?.page && state.page > 0 ? state.page : 1,
      },
      body: {
        cursor: state?.cursor || 0,
        count: limit,
      },
    }
  }

  applyCreatorPostPagination(limit: number, state?: PlatformIncrementalState): PlatformPaginationPatch {
    return {
      query: {
        cursor: state?.cursor || '',
        num: limit,
      },
      body: {
        max_cursor: Number(state?.cursor || 0),
        count: limit,
      },
    }
  }

  extractSearchState(payload: Record<string, unknown>): PlatformIncrementalState {
    const container = this.unwrapData(payload)
    const nextCursor = this.readString(
      container['cursor'],
      container['next_cursor'],
      payload['cursor'],
      payload['next_cursor'],
    )
    const nextWatermark = this.readString(
      container['watermark'],
      container['min_time'],
      payload['watermark'],
      payload['min_time'],
    )
    const nextPage = this.readNumber(container['page'], payload['page'])

    return {
      cursor: nextCursor || undefined,
      watermark: nextWatermark || undefined,
      page: nextPage > 0 ? nextPage : undefined,
    }
  }

  extractCreatorPostState(payload: Record<string, unknown>): PlatformIncrementalState {
    return this.extractSearchState(payload)
  }

  buildDeepInsight(seed: PlatformInsightSeed): PlatformDeepInsight {
    return {
      completionRate: this.buildCompletionRate(seed),
      commentSentiment: this.buildCommentSentiment(seed.comments),
      creatorPersona: this.buildCreatorPersona(seed),
      publishDistribution: this.buildPublishDistribution(seed),
    }
  }

  protected buildCompletionRate(seed: PlatformInsightSeed) {
    const views = Math.max(seed.metrics.views || 0, 1)
    const weightedEngagement = seed.metrics.likes
      + seed.metrics.comments * 1.8
      + seed.metrics.shares * 2.4
    const durationPenalty = Math.max(0.55, 1 - Math.max(seed.durationSeconds - 35, 0) / 240)
    const engagementRate = weightedEngagement / views
    return Number(
      Math.min(
        0.98,
        Math.max(
          0.08,
          engagementRate * this.platformWeight * 5.6 * durationPenalty,
        ),
      ).toFixed(4),
    )
  }

  protected buildCommentSentiment(
    comments: PlatformInsightSeed['comments'],
  ): PlatformCommentSentiment {
    let positive = 0
    let negative = 0
    let neutral = 0

    for (const comment of comments) {
      const content = comment.content.toLowerCase()
      const positiveHit = POSITIVE_TOKENS.some(token => content.includes(token))
      const negativeHit = NEGATIVE_TOKENS.some(token => content.includes(token))

      if (positiveHit && !negativeHit) {
        positive += 1
      }
      else if (negativeHit && !positiveHit) {
        negative += 1
      }
      else {
        neutral += 1
      }
    }

    const total = Math.max(positive + neutral + negative, 1)

    return {
      positive,
      neutral,
      negative,
      score: Number(((positive - negative) / total).toFixed(4)),
    }
  }

  protected buildCreatorPersona(seed: PlatformInsightSeed): PlatformCreatorPersona {
    const followerCount = seed.creatorStats?.followerCount || 0
    const recentPostHours = seed.creatorStats?.recentPostHours || []
    const cadence = recentPostHours.length >= 10
      ? 'high_frequency'
      : recentPostHours.length >= 4
        ? 'steady'
        : 'selective'
    const archetype = followerCount >= 500000
      ? 'established_creator'
      : followerCount >= 50000
        ? 'growth_creator'
        : 'niche_creator'
    const audienceTags = Array.from(new Set([
      ...this.extractKeywordTags(seed.title),
      ...this.extractKeywordTags(seed.description),
      ...this.extractKeywordTags(seed.creatorStats?.bio || ''),
    ])).slice(0, 6)

    return {
      segment: followerCount >= 100000 ? 'head_creator' : followerCount >= 10000 ? 'mid_creator' : 'long_tail_creator',
      creatorArchetype: archetype,
      engagementStyle: seed.metrics.comments > seed.metrics.likes * 0.08 ? 'discussion_driven' : 'visual_hook_driven',
      postingCadence: cadence,
      audienceTags,
    }
  }

  protected buildPublishDistribution(seed: PlatformInsightSeed): PlatformPublishDistribution {
    const publishedAt = seed.publishedAt ? new Date(seed.publishedAt) : null
    const recentHours = seed.creatorStats?.recentPostHours || []
    const hours = [
      ...(publishedAt && !Number.isNaN(publishedAt.getTime()) ? [publishedAt.getHours()] : []),
      ...recentHours.filter(hour => Number.isFinite(hour) && hour >= 0 && hour <= 23),
    ]
    const hourlyDistribution = Array.from({ length: 24 }, () => 0)
    for (const hour of hours) {
      hourlyDistribution[Math.trunc(hour)] += 1
    }

    const peakHour = hourlyDistribution.reduce((best, value, index, list) => {
      if (value > list[best]) {
        return index
      }
      return best
    }, 0)

    const weekdayKey = publishedAt && !Number.isNaN(publishedAt.getTime())
      ? ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][publishedAt.getDay()]
      : 'unknown'

    return {
      bucket: this.resolveBucket(peakHour || publishedAt?.getHours()),
      peakHour,
      hourlyDistribution,
      weekdayDistribution: {
        [weekdayKey]: 1,
      },
    }
  }

  protected resolveBucket(hour?: number) {
    if (!Number.isFinite(hour)) {
      return this.defaultBucket
    }
    if ((hour as number) < 6) {
      return 'late_night'
    }
    if ((hour as number) < 11) {
      return 'morning'
    }
    if ((hour as number) < 17) {
      return 'afternoon'
    }
    if ((hour as number) < 21) {
      return 'prime_time'
    }
    return 'night'
  }

  protected extractKeywordTags(input: string) {
    return input
      .split(/[\s,，。.!！？、/|]+/g)
      .map(item => item.trim())
      .filter(item => item.length >= 2)
      .slice(0, 4)
  }

  protected unwrapData(payload: Record<string, unknown>) {
    const direct = this.asRecord(payload['data'])
    if (direct?.['data'] && typeof direct['data'] === 'object') {
      return this.asRecord(direct['data']) || direct
    }

    return direct || payload
  }

  protected asRecord(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
  }

  protected readString(...values: unknown[]) {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim()
      }
      if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value)
      }
    }
    return ''
  }

  protected readNumber(...values: unknown[]) {
    for (const value of values) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value
      }
      if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
        return Number(value)
      }
    }
    return 0
  }
}
