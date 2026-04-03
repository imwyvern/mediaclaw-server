import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Cron } from '@nestjs/schedule'
import {
  VideoAnalytics,
  VideoAnalyticsDataSource,
  VideoTask,
  VideoTaskStatus,
} from '@yikart/mongodb'
import { Model, Types } from 'mongoose'

interface AnalyticsMetricsInput {
  views?: number
  likes?: number
  comments?: number
  shares?: number
  saves?: number
  followers?: number
  publishPostId?: string
  publishPostUrl?: string
  recordedAt?: Date
  raw?: Record<string, unknown>
}

interface AnalyticsMetricSet {
  views: number
  likes: number
  comments: number
  shares: number
  saves: number
  followers: number
}

type AnalyticsRecord = Record<string, any>
type VideoTaskRecord = Record<string, any>

@Injectable()
export class AnalyticsCollectorService {
  private readonly logger = new Logger(AnalyticsCollectorService.name)
  private readonly defaultCollectionWindowDays = 90

  constructor(
    @InjectModel(VideoTask.name)
    private readonly videoTaskModel: Model<VideoTask>,
    @InjectModel(VideoAnalytics.name)
    private readonly videoAnalyticsModel: Model<VideoAnalytics>,
  ) {}

  @Cron('0 3 * * *')
  async collectDailySnapshots() {
    return this.runDailyCollection()
  }

  async recordSnapshot(
    videoTaskId: string,
    platform: string,
    metrics: AnalyticsMetricsInput,
    source: VideoAnalyticsDataSource = VideoAnalyticsDataSource.TIKHUB,
  ) {
    const task = await this.getVideoTaskRecordOrFail(videoTaskId)
    const normalizedPlatform = this.normalizePlatform(platform || this.readPlatform(task) || 'unknown')
    const recordedAt = this.startOfUtcDay(metrics.recordedAt || new Date())
    const publishedAt = this.resolvePublishedAt(task)
    const daysSincePublish = this.diffDays(publishedAt, recordedAt)
    const normalizedMetrics = this.normalizeMetrics(metrics)
    const previousSnapshot = await this.videoAnalyticsModel.findOne({
      videoTaskId: task['_id'],
      recordedAt: { $lt: recordedAt },
    }).sort({ recordedAt: -1 }).lean().exec() as AnalyticsRecord | null
    const previousMetrics = previousSnapshot ? this.readMetrics(previousSnapshot) : null
    const deltaFromPrevious = previousMetrics
      ? this.buildDelta(previousMetrics, normalizedMetrics)
      : null
    const engagementRate = this.calculateEngagementRate(normalizedMetrics)
    const publishPostId = (metrics.publishPostId || this.readPublishPostId(task)).trim()
    const publishPostUrl = (metrics.publishPostUrl || this.readPublishPostUrl(task)).trim()
    const orgValue = task['orgId'] || task['userId'] || ''

    const payload = {
      videoTaskId: task['_id'],
      orgId: orgValue,
      platform: normalizedPlatform,
      publishPostId,
      recordedAt,
      daysSincePublish,
      metrics: normalizedMetrics,
      deltaFromPrevious,
      dataSource: source,
      raw: metrics.raw || {},
      views: normalizedMetrics.views,
      likes: normalizedMetrics.likes,
      comments: normalizedMetrics.comments,
      shares: normalizedMetrics.shares,
      saves: normalizedMetrics.saves,
      followers: normalizedMetrics.followers,
      engagementRate,
      platformPostId: publishPostId,
      platformPostUrl: publishPostUrl,
      metadata: {
        platform: normalizedPlatform,
        publishPostId,
        publishPostUrl,
        source,
        recordedAt: recordedAt.toISOString(),
        daysSincePublish,
      },
    }

    const snapshot = await this.videoAnalyticsModel.findOneAndUpdate(
      {
        videoTaskId: task['_id'],
        platform: normalizedPlatform,
        recordedAt,
      },
      {
        $set: payload,
        $setOnInsert: {
          videoTaskId: task['_id'],
          orgId: orgValue,
          platform: normalizedPlatform,
          recordedAt,
        },
      },
      {
        upsert: true,
        new: true,
      },
    ).lean().exec() as AnalyticsRecord | null

    if (!snapshot) {
      throw new NotFoundException('Video analytics snapshot not found')
    }

    await this.syncAnalyticsSnapshot(task['_id'].toString())
    return this.toSnapshotResponse(snapshot)
  }

  async collectForVideo(videoTaskId: string) {
    const task = await this.getVideoTaskRecordOrFail(videoTaskId)
    const publishedAt = this.resolvePublishedAt(task)
    const daysSincePublish = this.diffDays(publishedAt, new Date())
    const lastSnapshot = await this.videoAnalyticsModel.findOne({ videoTaskId: task['_id'] })
      .sort({ recordedAt: -1 })
      .lean()
      .exec() as AnalyticsRecord | null
    const stubMetrics = this.generateStubMetrics(task, lastSnapshot, daysSincePublish)
    const platform = this.readPlatform(task) || 'unknown'

    // TODO: Replace this stubbed growth model with TikHub/Mediacrawler collectors.
    const snapshot = await this.recordSnapshot(
      task['_id'].toString(),
      platform,
      {
        ...stubMetrics,
        publishPostId: this.readPublishPostId(task),
        publishPostUrl: this.readPublishPostUrl(task),
        raw: {
          stub: true,
          collector: 'analytics-collector',
          generatedAt: new Date().toISOString(),
          baselineMetrics: lastSnapshot ? this.readMetrics(lastSnapshot) : this.readTaskMetrics(task),
        },
      },
      VideoAnalyticsDataSource.TIKHUB,
    )

    return {
      source: 'tikhub_stub',
      videoTaskId: task['_id'].toString(),
      snapshot,
    }
  }

  async collectForOrg(orgId?: string, period = this.defaultCollectionWindowDays, limit = 200) {
    const normalizedLimit = Math.max(1, Math.min(Number(limit) || 200, 1000))
    const periodDays = Math.max(1, Math.min(Number(period) || this.defaultCollectionWindowDays, 365))
    const since = this.daysAgo(periodDays)
    const query: Record<string, unknown> = {
      status: {
        $in: [
          VideoTaskStatus.PUBLISHED,
          VideoTaskStatus.APPROVED,
          VideoTaskStatus.COMPLETED,
        ],
      },
      updatedAt: { $gte: since },
    }

    if (orgId) {
      Object.assign(query, this.buildOrgMatch(orgId))
    }

    const tasks = await this.videoTaskModel.find(query)
      .sort({ publishedAt: -1, updatedAt: -1, createdAt: -1 })
      .limit(normalizedLimit)
      .lean()
      .exec() as VideoTaskRecord[]

    let collected = 0
    let skipped = 0
    let failed = 0
    const items: Array<Record<string, unknown>> = []

    for (const task of tasks) {
      const publishedAt = this.resolvePublishedAt(task)
      if (publishedAt.getTime() < since.getTime()) {
        skipped += 1
        continue
      }

      try {
        const result = await this.collectForVideo(task['_id'].toString())
        items.push(result)
        collected += 1
      }
      catch (error) {
        failed += 1
        this.logger.warn({
          message: 'collectForOrg failed',
          videoTaskId: task['_id']?.toString?.() || '',
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    return {
      orgId: orgId || null,
      periodDays,
      scanned: tasks.length,
      collected,
      skipped,
      failed,
      items,
    }
  }

  async getVideoTimeSeries(videoTaskId: string, period = this.defaultCollectionWindowDays) {
    const task = await this.getVideoTaskRecordOrFail(videoTaskId)
    const periodDays = Math.max(1, Math.min(Number(period) || this.defaultCollectionWindowDays, 365))
    const since = this.daysAgo(periodDays)
    const snapshots = await this.videoAnalyticsModel.find({
      videoTaskId: task['_id'],
      recordedAt: { $gte: since },
    }).sort({ recordedAt: 1 }).lean().exec() as AnalyticsRecord[]

    return {
      videoTaskId: task['_id'].toString(),
      platform: this.readPlatform(task),
      publishedAt: this.resolvePublishedAt(task),
      periodDays,
      points: snapshots.map(snapshot => this.toSnapshotResponse(snapshot)),
    }
  }

  async getVideoLatestMetrics(videoTaskId: string) {
    const task = await this.getVideoTaskRecordOrFail(videoTaskId)
    const latest = await this.videoAnalyticsModel.findOne({ videoTaskId: task['_id'] })
      .sort({ recordedAt: -1 })
      .lean()
      .exec() as AnalyticsRecord | null

    if (latest) {
      return this.toSnapshotResponse(latest)
    }

    const fallbackMetrics = this.readTaskMetrics(task)
    return {
      videoTaskId: task['_id'].toString(),
      orgId: this.stringifyIdentifier(task['orgId'] || task['userId'] || ''),
      platform: this.readPlatform(task),
      publishPostId: this.readPublishPostId(task),
      publishPostUrl: this.readPublishPostUrl(task),
      recordedAt: this.resolvePublishedAt(task),
      daysSincePublish: this.diffDays(this.resolvePublishedAt(task), new Date()),
      metrics: fallbackMetrics,
      deltaFromPrevious: null,
      dataSource: 'manual',
      engagementRate: this.calculateEngagementRate(fallbackMetrics),
      source: 'video_task_fallback',
    }
  }

  async syncAnalyticsSnapshot(videoTaskId: string) {
    const task = await this.getVideoTaskRecordOrFail(videoTaskId)
    const latest = await this.videoAnalyticsModel.findOne({ videoTaskId: task['_id'] })
      .sort({ recordedAt: -1 })
      .lean()
      .exec() as AnalyticsRecord | null

    if (!latest) {
      return null
    }

    const metrics = this.readMetrics(latest)
    const snapshotPayload = {
      platform: latest['platform'] || this.readPlatform(task),
      publishPostId: latest['publishPostId'] || latest['platformPostId'] || this.readPublishPostId(task),
      publishPostUrl: latest['platformPostUrl'] || this.readPublishPostUrl(task),
      recordedAt: this.toDate(latest['recordedAt'])?.toISOString() || new Date().toISOString(),
      daysSincePublish: Number(latest['daysSincePublish'] || 0),
      dataSource: latest['dataSource'] || VideoAnalyticsDataSource.TIKHUB,
      metrics,
      deltaFromPrevious: this.readDelta(latest),
      engagementRate: this.calculateEngagementRate(metrics),
    }

    await this.videoTaskModel.findByIdAndUpdate(task['_id'], {
      $set: {
        analyticsSnapshot: {
          views: metrics.views,
          likes: metrics.likes,
          comments: metrics.comments,
          shares: metrics.shares,
          engagementRate: snapshotPayload.engagementRate,
        },
        platformPostId: task['platformPostId'] || snapshotPayload.publishPostId,
        platformPostUrl: task['platformPostUrl'] || snapshotPayload.publishPostUrl,
        'metadata.analytics': snapshotPayload,
        'metadata.analyticsSnapshot': snapshotPayload,
        'metadata.analytics_snapshot': snapshotPayload,
        'metadata.views': metrics.views,
        'metadata.likes': metrics.likes,
        'metadata.comments': metrics.comments,
        'metadata.shares': metrics.shares,
        'metadata.saves': metrics.saves,
        'metadata.followers': metrics.followers,
        'metadata.engagementRate': snapshotPayload.engagementRate,
      },
    }).exec()

    return snapshotPayload
  }

  async runDailyCollection() {
    // TODO: Wire this into BullMQ scheduled jobs once the production scheduler is available.
    const summary = await this.collectForOrg(undefined, this.defaultCollectionWindowDays)
    this.logger.log({
      message: 'Daily analytics collection finished',
      ...summary,
    })
    return summary
  }

  async collectSnapshots(limit = 200, orgId?: string) {
    return this.collectForOrg(orgId, this.defaultCollectionWindowDays, limit)
  }

  private async getVideoTaskRecordOrFail(videoTaskId: string) {
    if (!Types.ObjectId.isValid(videoTaskId)) {
      throw new NotFoundException('Video task not found')
    }

    const task = await this.videoTaskModel.findById(new Types.ObjectId(videoTaskId)).lean().exec() as VideoTaskRecord | null
    if (!task) {
      throw new NotFoundException('Video task not found')
    }

    return task
  }

  private buildOrgMatch(orgId: string) {
    const clauses: Record<string, unknown>[] = [{ userId: orgId }]
    if (Types.ObjectId.isValid(orgId)) {
      clauses.unshift({ orgId: new Types.ObjectId(orgId) })
    }

    return clauses.length === 1 ? clauses[0] : { $or: clauses }
  }

  private readPlatform(task: VideoTaskRecord) {
    const candidates = [
      task['metadata']?.['publishInfo']?.['platform'],
      task['metadata']?.['platform'],
      task['metadata']?.['sourcePlatform'],
      task['source']?.['type'],
    ]

    for (const candidate of candidates) {
      if (typeof candidate !== 'string' || !candidate.trim()) {
        continue
      }

      return this.normalizePlatform(candidate)
    }

    return ''
  }

  private normalizePlatform(platform: string) {
    const normalized = platform.trim().toLowerCase()
    if (normalized === 'xhs' || normalized === 'rednote') {
      return 'xiaohongshu'
    }
    return normalized
  }

  private readPublishPostId(task: VideoTaskRecord) {
    const candidates = [
      task['platformPostId'],
      task['source']?.['videoId'],
      task['metadata']?.['platformPostId'],
      task['metadata']?.['videoId'],
      task['metadata']?.['analyticsVideoId'],
    ]

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim()
      }
    }

    return ''
  }

  private readPublishPostUrl(task: VideoTaskRecord) {
    const candidates = [
      task['platformPostUrl'],
      task['metadata']?.['publishInfo']?.['publishUrl'],
      task['metadata']?.['platformPostUrl'],
      task['outputVideoUrl'],
      task['sourceVideoUrl'],
    ]

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim()
      }
    }

    return ''
  }

  private resolvePublishedAt(task: VideoTaskRecord) {
    const candidates = [
      task['publishedAt'],
      task['metadata']?.['publishedAt'],
      task['metadata']?.['publishInfo']?.['publishedAt'],
      task['completedAt'],
      task['createdAt'],
    ]

    for (const candidate of candidates) {
      const parsed = this.toDate(candidate)
      if (parsed) {
        return parsed
      }
    }

    return new Date()
  }

  private readTaskMetrics(task: VideoTaskRecord): AnalyticsMetricSet {
    const analyticsSnapshot = task['analyticsSnapshot'] && typeof task['analyticsSnapshot'] === 'object'
      ? task['analyticsSnapshot']
      : task['metadata']?.['analyticsSnapshot'] || task['metadata']?.['analytics_snapshot'] || {}

    return this.normalizeMetrics({
      views: analyticsSnapshot['views'] ?? task['metadata']?.['views'],
      likes: analyticsSnapshot['likes'] ?? task['metadata']?.['likes'],
      comments: analyticsSnapshot['comments'] ?? task['metadata']?.['comments'],
      shares: analyticsSnapshot['shares'] ?? task['metadata']?.['shares'],
      saves: analyticsSnapshot['saves'] ?? task['metadata']?.['saves'],
      followers: analyticsSnapshot['followers'] ?? task['metadata']?.['followers'],
    })
  }

  private readMetrics(snapshot: AnalyticsRecord): AnalyticsMetricSet {
    const metrics = snapshot['metrics'] && typeof snapshot['metrics'] === 'object'
      ? snapshot['metrics']
      : {}

    return this.normalizeMetrics({
      views: metrics['views'] ?? snapshot['views'],
      likes: metrics['likes'] ?? snapshot['likes'],
      comments: metrics['comments'] ?? snapshot['comments'],
      shares: metrics['shares'] ?? snapshot['shares'],
      saves: metrics['saves'] ?? snapshot['saves'],
      followers: metrics['followers'] ?? snapshot['followers'],
    })
  }

  private readDelta(snapshot: AnalyticsRecord) {
    const delta = snapshot['deltaFromPrevious']
    if (!delta || typeof delta !== 'object') {
      return null
    }

    return {
      views: this.toMetric(delta['views']),
      likes: this.toMetric(delta['likes']),
      comments: this.toMetric(delta['comments']),
      shares: this.toMetric(delta['shares']),
      saves: this.toMetric(delta['saves']),
    }
  }

  private normalizeMetrics(metrics: AnalyticsMetricsInput): AnalyticsMetricSet {
    return {
      views: this.toMetric(metrics.views),
      likes: this.toMetric(metrics.likes),
      comments: this.toMetric(metrics.comments),
      shares: this.toMetric(metrics.shares),
      saves: this.toMetric(metrics.saves),
      followers: this.toMetric(metrics.followers),
    }
  }

  private buildDelta(previous: AnalyticsMetricSet, current: AnalyticsMetricSet) {
    return {
      views: Math.max(0, current.views - previous.views),
      likes: Math.max(0, current.likes - previous.likes),
      comments: Math.max(0, current.comments - previous.comments),
      shares: Math.max(0, current.shares - previous.shares),
      saves: Math.max(0, current.saves - previous.saves),
    }
  }

  private generateStubMetrics(
    task: VideoTaskRecord,
    lastSnapshot: AnalyticsRecord | null,
    daysSincePublish: number,
  ): AnalyticsMetricSet {
    const baseline = lastSnapshot ? this.readMetrics(lastSnapshot) : this.readTaskMetrics(task)
    const seedViews = baseline.views > 0
      ? baseline.views
      : this.randomInt(600, 1800) + Math.max(daysSincePublish, 0) * this.randomInt(60, 140)
    const growthMultiplier = daysSincePublish <= 7
      ? 0.18
      : daysSincePublish <= 30
        ? 0.09
        : 0.04
    const growthViews = Math.max(25, Math.round(seedViews * growthMultiplier + this.randomInt(18, 120)))
    const nextViews = seedViews + growthViews

    const nextLikes = Math.max(
      baseline.likes,
      baseline.likes + Math.max(3, Math.round(growthViews * (0.045 + Math.random() * 0.035))),
    )
    const nextComments = Math.max(
      baseline.comments,
      baseline.comments + Math.max(1, Math.round(growthViews * (0.008 + Math.random() * 0.01))),
    )
    const nextShares = Math.max(
      baseline.shares,
      baseline.shares + Math.max(1, Math.round(growthViews * (0.004 + Math.random() * 0.008))),
    )
    const nextSaves = Math.max(
      baseline.saves,
      baseline.saves + Math.max(1, Math.round(growthViews * (0.006 + Math.random() * 0.01))),
    )
    const nextFollowers = Math.max(
      baseline.followers,
      baseline.followers + Math.max(0, Math.round(growthViews * (0.001 + Math.random() * 0.003))),
    )

    return {
      views: nextViews,
      likes: nextLikes,
      comments: nextComments,
      shares: nextShares,
      saves: nextSaves,
      followers: nextFollowers,
    }
  }

  private toSnapshotResponse(snapshot: AnalyticsRecord) {
    const metrics = this.readMetrics(snapshot)
    return {
      id: snapshot['_id']?.toString?.() || '',
      videoTaskId: this.stringifyIdentifier(snapshot['videoTaskId']),
      orgId: this.stringifyIdentifier(snapshot['orgId']),
      platform: typeof snapshot['platform'] === 'string' ? snapshot['platform'] : '',
      publishPostId: typeof snapshot['publishPostId'] === 'string' && snapshot['publishPostId']
        ? snapshot['publishPostId']
        : typeof snapshot['platformPostId'] === 'string'
          ? snapshot['platformPostId']
          : '',
      publishPostUrl: typeof snapshot['platformPostUrl'] === 'string' ? snapshot['platformPostUrl'] : '',
      recordedAt: this.toDate(snapshot['recordedAt']) || new Date(),
      daysSincePublish: Number(snapshot['daysSincePublish'] || 0),
      metrics,
      deltaFromPrevious: this.readDelta(snapshot),
      dataSource: typeof snapshot['dataSource'] === 'string' ? snapshot['dataSource'] : VideoAnalyticsDataSource.TIKHUB,
      engagementRate: this.calculateEngagementRate(metrics),
      raw: snapshot['raw'] && typeof snapshot['raw'] === 'object' ? snapshot['raw'] : {},
    }
  }

  private calculateEngagementRate(metrics: AnalyticsMetricSet) {
    if (metrics.views <= 0) {
      return 0
    }

    return Number((((metrics.likes + metrics.comments + metrics.shares + metrics.saves) / metrics.views) * 100).toFixed(4))
  }

  private diffDays(startAt: Date, endAt: Date) {
    const diff = this.startOfUtcDay(endAt).getTime() - this.startOfUtcDay(startAt).getTime()
    return Math.max(0, Math.floor(diff / (24 * 60 * 60 * 1000)))
  }

  private daysAgo(days: number) {
    return new Date(Date.now() - Math.max(0, days) * 24 * 60 * 60 * 1000)
  }

  private randomInt(min: number, max: number) {
    const normalizedMin = Math.ceil(min)
    const normalizedMax = Math.floor(max)
    return Math.floor(Math.random() * (normalizedMax - normalizedMin + 1)) + normalizedMin
  }

  private startOfUtcDay(date: Date) {
    return new Date(Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      0,
      0,
      0,
      0,
    ))
  }

  private toDate(value: unknown) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value
    }

    if (typeof value === 'string' || typeof value === 'number') {
      const parsed = new Date(value)
      if (!Number.isNaN(parsed.getTime())) {
        return parsed
      }
    }

    return null
  }

  private toMetric(value: unknown) {
    const normalized = Number(value || 0)
    if (!Number.isFinite(normalized) || normalized <= 0) {
      return 0
    }

    return Math.trunc(normalized)
  }

  private stringifyIdentifier(value: unknown) {
    if (typeof value === 'string') {
      return value
    }

    if (value && typeof value === 'object' && 'toString' in value && typeof value.toString === 'function') {
      return value.toString()
    }

    return ''
  }
}
