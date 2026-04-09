import { Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { VideoAnalytics, VideoTask } from '@yikart/mongodb'
import { Model } from 'mongoose'

import { AnalyticsCollectorService } from './analytics-collector.service'
import {
  EffectTrackerCohort,
  getEffectTrackerWindow,
} from './effect-tracker.constants'

type VideoTaskRecord = Record<string, any>
type AnalyticsRecord = Record<string, any>

interface AnalyticsMetricSet {
  views: number
  likes: number
  comments: number
  shares: number
  saves: number
  followers: number
}

@Injectable()
export class EffectTrackerService {
  private readonly logger = new Logger(EffectTrackerService.name)
  private readonly batchLimit = 300

  constructor(
    @InjectModel(VideoTask.name)
    private readonly videoTaskModel: Model<VideoTask>,
    @InjectModel(VideoAnalytics.name)
    private readonly videoAnalyticsModel: Model<VideoAnalytics>,
    private readonly analyticsCollectorService: AnalyticsCollectorService,
  ) {}

  async trackWindow(cohort: EffectTrackerCohort) {
    const window = getEffectTrackerWindow(cohort)
    if (!window) {
      throw new Error(`Unknown effect tracker cohort: ${cohort}`)
    }

    const tasks = await this.findEligibleTasks(window.minDays, window.maxDays)
    let tracked = 0
    let skipped = 0
    let failed = 0
    const items: Array<Record<string, unknown>> = []

    for (const task of tasks) {
      try {
        const trackingResult = await this.trackTask(task, cohort, window.label)
        items.push(trackingResult)
        if (trackingResult['tracked']) {
          tracked += 1
        }
        else {
          skipped += 1
        }
      }
      catch (error) {
        failed += 1
        const taskId = task['_id']?.toString?.() || ''
        this.logger.warn({
          message: 'effect tracking failed',
          cohort,
          taskId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    return {
      cohort,
      label: window.label,
      scanned: tasks.length,
      tracked,
      skipped,
      failed,
      items,
      trackedAt: new Date().toISOString(),
    }
  }

  private async findEligibleTasks(minDays: number, maxDays: number) {
    const tasks = await this.videoTaskModel.find({
      publishedAt: {
        $ne: null,
      },
      $or: [
        { platformPostId: { $exists: true, $ne: '' } },
        { 'metadata.platformPostId': { $exists: true, $ne: '' } },
        { 'metadata.analyticsVideoId': { $exists: true, $ne: '' } },
        { 'metadata.publishInfo.publishUrl': { $exists: true, $ne: '' } },
      ],
    })
      .sort({ publishedAt: -1, updatedAt: -1 })
      .limit(this.batchLimit)
      .lean()
      .exec() as VideoTaskRecord[]

    const now = new Date()

    return tasks.filter((task) => {
      const publishedAt = this.resolvePublishedAt(task)
      if (!publishedAt) {
        return false
      }

      const daysSincePublish = this.diffDays(publishedAt, now)
      return daysSincePublish >= minDays && daysSincePublish <= maxDays
    })
  }

  private async trackTask(task: VideoTaskRecord, cohort: EffectTrackerCohort, label: string) {
    const taskId = task['_id']?.toString?.() || ''
    const collected = await this.analyticsCollectorService.collectForVideo(taskId)
    const trackedAt = new Date()

    if (!collected['metrics'] || !collected['snapshot']) {
      await this.videoTaskModel.findByIdAndUpdate(task['_id'], {
        $set: {
          'metadata.effectTracking': {
            cohort,
            label,
            tracked: false,
            reason: collected['reason'] || 'metrics_unavailable',
            source: collected['source'] || 'unavailable',
            lastTrackedAt: trackedAt.toISOString(),
          },
          'metadata.analytics.lastTrackedAt': trackedAt.toISOString(),
        },
      }).exec()

      return {
        taskId,
        tracked: false,
        source: collected['source'] || 'unavailable',
        reason: collected['reason'] || 'metrics_unavailable',
      }
    }

    const trend = await this.buildTrend(taskId)
    await this.videoTaskModel.findByIdAndUpdate(task['_id'], {
      $set: {
        'metadata.analyticsTrend': trend,
        'metadata.effectTracking': {
          cohort,
          label,
          tracked: true,
          source: collected['source'] || 'tikhub',
          publishPostId: collected['snapshot']?.['publishPostId'] || task['platformPostId'] || '',
          publishPostUrl: collected['snapshot']?.['publishPostUrl'] || task['platformPostUrl'] || '',
          latestRecordedAt: collected['snapshot']?.['recordedAt'] || trackedAt.toISOString(),
          lastTrackedAt: trackedAt.toISOString(),
        },
        'metadata.analytics.lastTrackedAt': trackedAt.toISOString(),
      },
    }).exec()

    return {
      taskId,
      tracked: true,
      source: collected['source'] || 'tikhub',
      trendDirection: trend.direction,
      engagementRate: trend.current.engagementRate,
      views: trend.current.views,
      trackedAt: trackedAt.toISOString(),
    }
  }

  private async buildTrend(videoTaskId: string) {
    const snapshots = await this.videoAnalyticsModel.find({ videoTaskId })
      .sort({ recordedAt: -1 })
      .limit(2)
      .lean()
      .exec() as AnalyticsRecord[]

    const current = snapshots[0] || null
    const previous = snapshots[1] || null
    const currentMetrics = this.readMetrics(current)
    const previousMetrics = this.readMetrics(previous)
    const currentEngagementRate = this.readEngagementRate(current, currentMetrics)
    const previousEngagementRate = this.readEngagementRate(previous, previousMetrics)
    const engagementRateDelta = this.round(currentEngagementRate - previousEngagementRate)
    const engagementRateDeltaPct = previousEngagementRate > 0
      ? this.round((engagementRateDelta / previousEngagementRate) * 100)
      : currentEngagementRate > 0
        ? 100
        : 0
    const viewsDelta = currentMetrics.views - previousMetrics.views
    const direction = engagementRateDelta > 0.1
      ? 'up'
      : engagementRateDelta < -0.1
        ? 'down'
        : 'flat'

    return {
      current: {
        recordedAt: this.toIsoString(current?.['recordedAt']),
        engagementRate: currentEngagementRate,
        views: currentMetrics.views,
        likes: currentMetrics.likes,
        comments: currentMetrics.comments,
        shares: currentMetrics.shares,
      },
      previous: previous
        ? {
            recordedAt: this.toIsoString(previous['recordedAt']),
            engagementRate: previousEngagementRate,
            views: previousMetrics.views,
            likes: previousMetrics.likes,
            comments: previousMetrics.comments,
            shares: previousMetrics.shares,
          }
        : null,
      delta: {
        engagementRate: engagementRateDelta,
        engagementRatePct: engagementRateDeltaPct,
        views: viewsDelta,
        likes: currentMetrics.likes - previousMetrics.likes,
        comments: currentMetrics.comments - previousMetrics.comments,
        shares: currentMetrics.shares - previousMetrics.shares,
      },
      direction,
      generatedAt: new Date().toISOString(),
    }
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

    return null
  }

  private readMetrics(snapshot: AnalyticsRecord | null): AnalyticsMetricSet {
    if (!snapshot) {
      return {
        views: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        saves: 0,
        followers: 0,
      }
    }

    const metrics = snapshot['metrics'] && typeof snapshot['metrics'] === 'object'
      ? snapshot['metrics']
      : {}

    return {
      views: this.toMetric(metrics['views'] ?? snapshot['views']),
      likes: this.toMetric(metrics['likes'] ?? snapshot['likes']),
      comments: this.toMetric(metrics['comments'] ?? snapshot['comments']),
      shares: this.toMetric(metrics['shares'] ?? snapshot['shares']),
      saves: this.toMetric(metrics['saves'] ?? snapshot['saves']),
      followers: this.toMetric(metrics['followers'] ?? snapshot['followers']),
    }
  }

  private readEngagementRate(snapshot: AnalyticsRecord | null, metrics: AnalyticsMetricSet) {
    if (!snapshot) {
      return 0
    }

    const value = Number(snapshot['engagementRate'] || 0)
    if (value > 0) {
      return this.round(value)
    }

    if (metrics.views <= 0) {
      return 0
    }

    return this.round(((metrics.likes + metrics.comments + metrics.shares + metrics.saves) / metrics.views) * 100)
  }

  private diffDays(start: Date, end: Date) {
    const ms = end.getTime() - start.getTime()
    return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)))
  }

  private toDate(value: unknown) {
    if (!value) {
      return null
    }

    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value
    }

    const parsed = new Date(String(value))
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  private toMetric(value: unknown) {
    const normalized = Number(value || 0)
    if (!Number.isFinite(normalized)) {
      return 0
    }

    return Math.max(0, Math.round(normalized))
  }

  private round(value: number) {
    return Number(value.toFixed(2))
  }

  private toIsoString(value: unknown) {
    return this.toDate(value)?.toISOString() || null
  }
}
