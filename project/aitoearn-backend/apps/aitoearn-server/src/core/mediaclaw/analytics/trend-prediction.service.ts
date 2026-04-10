import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import {
  VideoAnalytics,
  ViralContent,
} from '@yikart/mongodb'
import { Model } from 'mongoose'

type PredictionTemplateType = 'b7-ai-live' | 'b9-product-showcase' | 'b10-explainer'
type LifecycleStage = 'rising' | 'stable' | 'cooling'

interface PredictionQuery {
  industry?: string
  platform?: string
  horizonDays?: number
  windowDays?: number
}

interface TopicSignalBucket {
  topic: string
  recentCount: number
  baselineCount: number
  recentWeightedScore: number
  baselineWeightedScore: number
  platforms: Map<string, number>
}

interface PublishWindowSignal {
  platform: string
  weekday: number
  hour: number
  score: number
  source: 'market' | 'customer'
}

interface CustomerPerformanceSignal {
  orgId: string
  platform: string
  industry: string
  publishedAt: Date
  engagementRate: number
}

interface ViralContentRecord {
  platform?: string
  title?: string
  keywords?: string[]
  industry?: string
  viralScore?: number
  views?: number
  likes?: number
  comments?: number
  shares?: number
  publishedAt?: Date | string | null
  discoveredAt?: Date | string | null
}

const CHINESE_STOP_WORDS = new Set([
  '视频',
  '爆款',
  '热门',
  '推荐',
  '合集',
  '今天',
  '最近',
  '行业',
  '品牌',
  '内容',
])

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

@Injectable()
export class TrendPredictionService {
  constructor(
    @InjectModel(ViralContent.name)
    private readonly viralContentModel: Model<ViralContent>,
    @InjectModel(VideoAnalytics.name)
    private readonly videoAnalyticsModel: Model<VideoAnalytics>,
  ) {}

  async getPredictions(query: PredictionQuery = {}) {
    const generatedAt = new Date()
    const horizonDays = this.normalizeRange(query.horizonDays, 7, 3, 14)
    const windowDays = this.normalizeRange(query.windowDays, 90, 30, 365)
    const normalizedIndustry = this.normalizeToken(query.industry)
    const normalizedPlatform = this.normalizePlatform(query.platform)
    const since = this.daysAgo(windowDays, generatedAt)
    const recentSince = this.daysAgo(Math.min(14, Math.max(7, Math.floor(windowDays / 6))), generatedAt)

    const marketSignals = await this.viralContentModel.find({
      discoveredAt: { $gte: since },
      ...(normalizedIndustry ? { industry: normalizedIndustry } : {}),
      ...(normalizedPlatform ? { platform: normalizedPlatform } : {}),
    }).lean().exec() as unknown as ViralContentRecord[]

    const customerSignals = await this.loadCustomerPerformanceSignals(since, normalizedIndustry, normalizedPlatform)
    const publishWindows = this.buildPublishWindows(marketSignals, customerSignals, horizonDays, generatedAt)
    const directions = this.buildContentDirections(
      marketSignals,
      recentSince,
      publishWindows,
      horizonDays,
    )
    const templateRecommendations = this.buildTemplateRecommendations(directions)
    const activeOrganizations = new Set(
      customerSignals
        .map(item => item.orgId)
        .filter(Boolean),
    ).size
    const confidence = this.calculateConfidence(
      marketSignals.length,
      customerSignals.length,
      activeOrganizations,
    )

    return {
      generatedAt,
      source: 'multi-source-history',
      model: 'heuristic-forecast-v1',
      horizonDays,
      windowDays,
      filters: {
        industry: normalizedIndustry || null,
        platform: normalizedPlatform || null,
      },
      support: {
        marketSignals: marketSignals.length,
        customerSignals: customerSignals.length,
        activeOrganizations,
        confidence,
      },
      directions,
      templateRecommendations,
      bestPublishWindows: publishWindows,
    }
  }

  private async loadCustomerPerformanceSignals(
    since: Date,
    industry: string,
    platform: string,
  ): Promise<CustomerPerformanceSignal[]> {
    const rows = await this.videoAnalyticsModel.aggregate<Record<string, any>>([
      { $match: { recordedAt: { $gte: since } } },
      { $sort: { videoTaskId: 1, recordedAt: -1 } },
      {
        $group: {
          _id: '$videoTaskId',
          latest: { $first: '$$ROOT' },
        },
      },
      { $replaceRoot: { newRoot: '$latest' } },
      {
        $lookup: {
          from: 'video_tasks',
          localField: 'videoTaskId',
          foreignField: '_id',
          as: 'task',
        },
      },
      { $unwind: '$task' },
      {
        $match: {
          'task.publishedAt': { $ne: null },
        },
      },
      {
        $project: {
          _id: 0,
          orgId: '$task.orgId',
          publishedAt: '$task.publishedAt',
          views: '$views',
          likes: '$likes',
          comments: '$comments',
          shares: '$shares',
          saves: '$saves',
          platformCandidates: [
            '$task.metadata.publishInfo.platform',
            '$task.metadata.platform',
            '$task.metadata.sourcePlatform',
            '$task.source.type',
          ],
          industryCandidates: [
            '$task.metadata.brandIndustry',
            '$task.metadata.industry',
            '$task.metadata.discoveryIndustry',
          ],
        },
      },
    ]).exec()

    return rows
      .map((row) => {
        const normalizedPlatform = this.pickNormalizedToken(row['platformCandidates'], value => this.normalizePlatform(value))
        const normalizedIndustry = this.pickNormalizedToken(row['industryCandidates'], value => this.normalizeToken(value))
        const publishedAt = this.toDate(row['publishedAt'])
        const engagementRate = this.calculateEngagementRate({
          views: row['views'],
          likes: row['likes'],
          comments: row['comments'],
          shares: row['shares'],
          saves: row['saves'],
        })

        return {
          orgId: row['orgId']?.toString?.() || '',
          platform: normalizedPlatform,
          industry: normalizedIndustry,
          publishedAt,
          engagementRate,
        }
      })
      .filter((item): item is CustomerPerformanceSignal => !!item.platform && !!item.publishedAt)
      .filter(item => !platform || item.platform === platform)
      .filter(item => !industry || item.industry === industry)
  }

  private buildContentDirections(
    contents: ViralContentRecord[],
    recentSince: Date,
    publishWindows: Array<Record<string, any>>,
    horizonDays: number,
  ) {
    const buckets = new Map<string, TopicSignalBucket>()

    for (const content of contents) {
      const publishedAt = this.toDate(content.publishedAt) || this.toDate(content.discoveredAt)
      const isRecent = !!publishedAt && publishedAt >= recentSince
      const topics = this.extractTopics(content)
      const platform = this.normalizePlatform(content.platform)
      const weightedScore = this.calculateWeightedMarketScore(content)

      for (const topic of topics) {
        const bucket = buckets.get(topic) || {
          topic,
          recentCount: 0,
          baselineCount: 0,
          recentWeightedScore: 0,
          baselineWeightedScore: 0,
          platforms: new Map<string, number>(),
        }

        if (isRecent) {
          bucket.recentCount += 1
          bucket.recentWeightedScore += weightedScore
        }
        else {
          bucket.baselineCount += 1
          bucket.baselineWeightedScore += weightedScore
        }

        if (platform) {
          bucket.platforms.set(platform, (bucket.platforms.get(platform) || 0) + 1)
        }

        buckets.set(topic, bucket)
      }
    }

    return [...buckets.values()]
      .filter(bucket => bucket.recentCount > 0 && bucket.recentCount + bucket.baselineCount >= 2)
      .map((bucket) => {
        const recentAverage = bucket.recentWeightedScore / Math.max(bucket.recentCount, 1)
        const baselineAverage = bucket.baselineCount > 0
          ? bucket.baselineWeightedScore / bucket.baselineCount
          : recentAverage * 0.72
        const momentum = baselineAverage > 0
          ? (recentAverage - baselineAverage) / baselineAverage
          : 0
        const heatScore = this.clampNumber(
          Math.round(recentAverage * 0.72 + bucket.recentCount * 4 + Math.max(momentum, 0) * 24),
          0,
          100,
        )
        const lifecycleStage = this.resolveLifecycleStage(momentum)
        const recommendedPlatforms = [...bucket.platforms.entries()]
          .sort((left, right) => right[1] - left[1])
          .slice(0, 3)
          .map(([platform]) => platform)
        const templateType = this.pickTemplateType(bucket.topic)
        const matchedWindows = publishWindows
          .filter(window => recommendedPlatforms.length === 0 || recommendedPlatforms.includes(String(window['platform'] || '')))
          .slice(0, 2)

        return {
          topic: bucket.topic,
          heatScore,
          momentum: this.round(momentum * 100, 1),
          lifecycleStage,
          recommendedTemplate: templateType,
          recommendedPlatforms,
          predictedLift: this.round(Math.max(momentum, 0) * 100 + heatScore * 0.2, 1),
          rationale: this.buildTopicRationale(bucket.topic, lifecycleStage, bucket.recentCount, recommendedPlatforms),
          bestPublishWindows: matchedWindows,
          recommendedDates: this.buildRecommendedDates(matchedWindows, horizonDays),
          signalBreakdown: {
            recentSampleSize: bucket.recentCount,
            baselineSampleSize: bucket.baselineCount,
            recentAverageScore: this.round(recentAverage),
            baselineAverageScore: this.round(baselineAverage),
          },
        }
      })
      .sort((left, right) => {
        if (right.heatScore !== left.heatScore) {
          return right.heatScore - left.heatScore
        }
        return Number(right.momentum) - Number(left.momentum)
      })
      .slice(0, 5)
  }

  private buildTemplateRecommendations(directions: Array<Record<string, any>>) {
    const buckets = new Map<PredictionTemplateType, {
      templateType: PredictionTemplateType
      score: number
      sampleCount: number
      topics: string[]
    }>()

    for (const direction of directions) {
      const templateType = direction['recommendedTemplate'] as PredictionTemplateType
      const current = buckets.get(templateType) || {
        templateType,
        score: 0,
        sampleCount: 0,
        topics: [],
      }

      current.score += Number(direction['heatScore'] || 0)
      current.sampleCount += 1
      current.topics.push(String(direction['topic'] || ''))
      buckets.set(templateType, current)
    }

    return [...buckets.values()]
      .map(bucket => ({
        templateType: bucket.templateType,
        confidence: this.round(bucket.score / Math.max(bucket.sampleCount, 1)),
        topics: bucket.topics,
        recommendation: this.buildTemplateRecommendationText(bucket.templateType, bucket.topics),
      }))
      .sort((left, right) => Number(right.confidence) - Number(left.confidence))
  }

  private buildPublishWindows(
    contents: ViralContentRecord[],
    customerSignals: CustomerPerformanceSignal[],
    horizonDays: number,
    now: Date,
  ) {
    const buckets = new Map<string, {
      platform: string
      weekday: number
      hour: number
      scoreSum: number
      sampleSize: number
      marketSignals: number
      customerSignals: number
    }>()

    for (const content of contents) {
      const publishedAt = this.toDate(content.publishedAt)
      const platform = this.normalizePlatform(content.platform)
      if (!publishedAt || !platform) {
        continue
      }

      this.appendPublishWindowSignal(buckets, {
        platform,
        weekday: publishedAt.getUTCDay(),
        hour: publishedAt.getUTCHours(),
        score: this.calculateWeightedMarketScore(content),
        source: 'market',
      })
    }

    for (const signal of customerSignals) {
      this.appendPublishWindowSignal(buckets, {
        platform: signal.platform,
        weekday: signal.publishedAt.getUTCDay(),
        hour: signal.publishedAt.getUTCHours(),
        score: Math.max(signal.engagementRate * 100 * 1.25, 1),
        source: 'customer',
      })
    }

    return [...buckets.values()]
      .filter(bucket => bucket.sampleSize >= 2)
      .map(bucket => ({
        platform: bucket.platform,
        weekday: bucket.weekday,
        weekdayLabel: WEEKDAY_LABELS[bucket.weekday] || '',
        hour: bucket.hour,
        localLabel: `${WEEKDAY_LABELS[bucket.weekday] || ''} ${String(bucket.hour).padStart(2, '0')}:00`,
        confidence: this.round(bucket.scoreSum / Math.max(bucket.sampleSize, 1)),
        sampleSize: bucket.sampleSize,
        sources: {
          market: bucket.marketSignals,
          customer: bucket.customerSignals,
        },
        nextSlots: this.buildUpcomingSlots(bucket.weekday, bucket.hour, horizonDays, now),
      }))
      .sort((left, right) => Number(right.confidence) - Number(left.confidence))
      .slice(0, 8)
  }

  private appendPublishWindowSignal(
    buckets: Map<string, {
      platform: string
      weekday: number
      hour: number
      scoreSum: number
      sampleSize: number
      marketSignals: number
      customerSignals: number
    }>,
    signal: PublishWindowSignal,
  ) {
    const key = `${signal.platform}:${signal.weekday}:${signal.hour}`
    const bucket = buckets.get(key) || {
      platform: signal.platform,
      weekday: signal.weekday,
      hour: signal.hour,
      scoreSum: 0,
      sampleSize: 0,
      marketSignals: 0,
      customerSignals: 0,
    }

    bucket.scoreSum += signal.score
    bucket.sampleSize += 1
    if (signal.source === 'customer') {
      bucket.customerSignals += 1
    }
    else {
      bucket.marketSignals += 1
    }

    buckets.set(key, bucket)
  }

  private buildRecommendedDates(
    publishWindows: Array<Record<string, any>>,
    horizonDays: number,
  ) {
    return publishWindows
      .flatMap(window => Array.isArray(window['nextSlots']) ? window['nextSlots'] : [])
      .slice(0, Math.max(1, Math.min(horizonDays, 3)))
  }

  private buildUpcomingSlots(weekday: number, hour: number, horizonDays: number, now: Date) {
    const slots: string[] = []

    for (let index = 1; index <= horizonDays; index += 1) {
      const date = new Date(now.getTime() + index * 24 * 60 * 60 * 1000)
      if (date.getUTCDay() !== weekday) {
        continue
      }

      const slot = new Date(Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        hour,
        0,
        0,
        0,
      ))
      slots.push(slot.toISOString())
    }

    return slots
  }

  private buildTopicRationale(topic: string, lifecycleStage: LifecycleStage, sampleSize: number, platforms: string[]) {
    const rationale = [
      `${topic} 在最近样本中的热度进入 ${this.translateLifecycleStage(lifecycleStage)} 阶段`,
      `近窗口命中 ${sampleSize} 条高分内容，平台分布集中在 ${platforms.join(' / ') || '多平台'}`,
    ]

    if (this.pickTemplateType(topic) === 'b10-explainer') {
      rationale.push('适合做知识点拆解、成分解析和教程型表达')
    }
    else if (this.pickTemplateType(topic) === 'b9-product-showcase') {
      rationale.push('更适合商品展示、测评对比和卖点直给型内容')
    }
    else {
      rationale.push('更适合做强情绪首帧和轻剧情/微动效表达')
    }

    return rationale
  }

  private buildTemplateRecommendationText(templateType: PredictionTemplateType, topics: string[]) {
    const topicSummary = topics.slice(0, 3).join(' / ')
    if (templateType === 'b10-explainer') {
      return `优先把 ${topicSummary || '高热知识点'} 做成解释型视频，突出结论先行和要点拆解。`
    }

    if (templateType === 'b9-product-showcase') {
      return `优先把 ${topicSummary || '高热卖点'} 做成展示/测评型模板，直接打产品卖点和对比。`
    }

    return `优先把 ${topicSummary || '高热话题'} 做成强首帧的 AI 微动效视频，放大视觉记忆点。`
  }

  private resolveLifecycleStage(momentum: number): LifecycleStage {
    if (momentum >= 0.2) {
      return 'rising'
    }

    if (momentum <= -0.1) {
      return 'cooling'
    }

    return 'stable'
  }

  private calculateWeightedMarketScore(content: ViralContentRecord) {
    const viralScore = this.toNumber(content.viralScore)
    const engagementRate = this.calculateEngagementRate({
      views: content.views,
      likes: content.likes,
      comments: content.comments,
      shares: content.shares,
    })

    return this.round(viralScore * 0.7 + engagementRate * 100 * 0.3)
  }

  private calculateEngagementRate(metrics: {
    views?: unknown
    likes?: unknown
    comments?: unknown
    shares?: unknown
    saves?: unknown
  }) {
    const views = Math.max(this.toNumber(metrics.views), 1)
    const engagement = this.toNumber(metrics.likes)
      + this.toNumber(metrics.comments) * 2
      + this.toNumber(metrics.shares) * 3
      + this.toNumber(metrics.saves)

    return engagement / views
  }

  private extractTopics(content: ViralContentRecord) {
    const tokens = [
      ...this.normalizeTokens(content.keywords || []),
      ...this.extractTitleTokens(String(content.title || '')),
    ]

    return [...new Set(tokens)]
      .filter(token => token.length >= 2 && token.length <= 16)
      .filter(token => !CHINESE_STOP_WORDS.has(token))
      .slice(0, 6)
  }

  private extractTitleTokens(title: string) {
    const normalized = title
      .replace(/#[^\s#]+/g, value => value.replace(/^#/, ''))
      .replace(/[【】[\]（）()]/g, ' ')
      .trim()

    if (!normalized) {
      return []
    }

    const segments = normalized
      .split(/[|｜，。！？、:：;；/\-\s]+/)
      .map(segment => this.normalizeToken(segment))
      .filter(Boolean)

    if (segments.length > 0) {
      return segments
    }

    const phraseMatches = normalized.match(/[\u4E00-\u9FFF]{2,8}|[a-z0-9]{3,16}/gi) || []
    return phraseMatches.map(segment => this.normalizeToken(segment)).filter(Boolean)
  }

  private pickTemplateType(topic: string): PredictionTemplateType {
    if (/教程|解析|成分|科普|步骤|怎么|为什么|避坑|清单/.test(topic)) {
      return 'b10-explainer'
    }

    if (/开箱|测评|对比|展示|合集|平替|推荐|好物/.test(topic)) {
      return 'b9-product-showcase'
    }

    return 'b7-ai-live'
  }

  private pickNormalizedToken(values: unknown[], normalizer: (value: unknown) => string) {
    for (const value of values) {
      const normalized = normalizer(value)
      if (normalized) {
        return normalized
      }
    }

    return ''
  }

  private normalizeTokens(values: string[]) {
    return values
      .map(value => this.normalizeToken(value))
      .filter(Boolean)
  }

  private normalizeToken(value: unknown) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/^#+/, '')
      .replace(/\s+/g, '')
  }

  private normalizePlatform(value: unknown) {
    const normalized = this.normalizeToken(value)
    if (!normalized) {
      return ''
    }

    if (normalized === 'xhs' || normalized === 'rednote') {
      return 'xiaohongshu'
    }

    if (normalized === 'ks') {
      return 'kuaishou'
    }

    return normalized
  }

  private normalizeRange(value: number | undefined, fallback: number, min: number, max: number) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) {
      return fallback
    }

    return Math.min(Math.max(Math.trunc(parsed), min), max)
  }

  private calculateConfidence(marketSignals: number, customerSignals: number, activeOrganizations: number) {
    const score = marketSignals * 0.4 + customerSignals * 0.35 + activeOrganizations * 8
    return this.clampNumber(this.round(score / 8), 0, 100)
  }

  private toNumber(value: unknown) {
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : 0
  }

  private toDate(value: unknown) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value
    }

    if (typeof value === 'string' && value.trim()) {
      const parsed = new Date(value)
      if (!Number.isNaN(parsed.getTime())) {
        return parsed
      }
    }

    return null
  }

  private daysAgo(days: number, base = new Date()) {
    return new Date(base.getTime() - days * 24 * 60 * 60 * 1000)
  }

  private clampNumber(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max)
  }

  private round(value: number, digits = 2) {
    const factor = 10 ** digits
    return Math.round((Number.isFinite(value) ? value : 0) * factor) / factor
  }

  private translateLifecycleStage(stage: LifecycleStage) {
    if (stage === 'rising') {
      return '上升'
    }

    if (stage === 'cooling') {
      return '降温'
    }

    return '稳定'
  }
}
