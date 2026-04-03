import { Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Cron } from '@nestjs/schedule'
import { VideoAnalytics, VideoTask, VideoTaskStatus } from '@yikart/mongodb'
import { Model, Types } from 'mongoose'
import { TikHubService } from '../acquisition/tikhub.service'

interface VideoTaskAnalyticsMetadata {
  analyticsSnapshot?: Record<string, any>
  analytics_snapshot?: Record<string, any>
  metrics?: Record<string, any>
  performance?: Record<string, any>
  publishInfo?: Record<string, any>
  platform?: string
  sourcePlatform?: string
  platformPostId?: string
  videoId?: string
  analyticsVideoId?: string
  platformPostUrl?: string
}

interface VideoTaskAnalyticsRecord {
  _id?: { toString: () => string }
  status?: VideoTaskStatus | string
  analyticsSnapshot?: Record<string, any>
  metadata?: VideoTaskAnalyticsMetadata
  source?: {
    type?: string
    videoId?: string
  }
  platformPostId?: string
  platformPostUrl?: string
  outputVideoUrl?: string
  sourceVideoUrl?: string
}

interface CollectedMetrics {
  views: number
  likes: number
  comments: number
  shares: number
  saves: number
  engagementRate: number
  source: string
  raw: Record<string, any> | null
}

@Injectable()
export class AnalyticsCollectorService {
  private readonly logger = new Logger(AnalyticsCollectorService.name)
  private readonly retentionWindowMs = 180 * 24 * 60 * 60 * 1000

  constructor(
    @InjectModel(VideoTask.name)
    private readonly videoTaskModel: Model<VideoTask>,
    @InjectModel(VideoAnalytics.name)
    private readonly videoAnalyticsModel: Model<VideoAnalytics>,
    private readonly tikHubService: TikHubService,
  ) {}

  @Cron('0 3 * * *')
  async collectDailySnapshots() {
    const summary = await this.collectSnapshots()
    this.logger.log('Analytics collector finished: ' + summary.collected + '/' + summary.scanned + ' snapshots persisted')
    return summary
  }

  async collectSnapshots(limit = 200, orgId?: string) {
    const since = new Date(Date.now() - this.retentionWindowMs)
    const recordedAt = this.startOfUtcDay(new Date())
    const query: Record<string, any> = {
      status: {
        $in: [
          VideoTaskStatus.COMPLETED,
          VideoTaskStatus.APPROVED,
          VideoTaskStatus.PUBLISHED,
        ],
      },
      createdAt: { $gte: since },
    }

    if (orgId) {
      query['$and'] = [this.buildOrgMatch(orgId)]
    }

    const tasks = await this.videoTaskModel.find(query)
      .sort({ publishedAt: -1, completedAt: -1, updatedAt: -1 })
      .limit(Math.max(1, Math.min(Number(limit) || 200, 1000)))
      .lean()
      .exec()

    let collected = 0
    let skipped = 0
    let failed = 0

    for (const task of tasks) {
      const taskRecord = task as VideoTaskAnalyticsRecord & Record<string, any>
      const platform = this.readPlatform(taskRecord)
      const platformPostId = this.readPlatformPostId(taskRecord)
      const platformPostUrl = this.readPlatformPostUrl(taskRecord)
      const metrics = await this.resolveMetrics(taskRecord, platform, platformPostId)

      if (!platform || !metrics) {
        skipped += 1
        continue
      }

      try {
        await this.videoAnalyticsModel.findOneAndUpdate(
          {
            videoTaskId: taskRecord['_id'],
            platform,
            recordedAt,
          },
          {
            $set: {
              views: metrics.views,
              likes: metrics.likes,
              comments: metrics.comments,
              shares: metrics.shares,
              engagementRate: metrics.engagementRate,
              platformPostId,
              platformPostUrl,
              metadata: {
                saves: metrics.saves,
                source: metrics.source,
                taskStatus: taskRecord['status'] || '',
                collectedAt: new Date().toISOString(),
                raw: metrics.raw,
              },
            },
            $setOnInsert: {
              videoTaskId: taskRecord['_id'],
              platform,
              recordedAt,
            },
          },
          {
            upsert: true,
            new: true,
          },
        ).exec()

        await this.videoTaskModel.findByIdAndUpdate(taskRecord['_id'], {
          $set: {
            analyticsSnapshot: this.toTaskAnalyticsSnapshot(metrics),
            platformPostId: taskRecord['platformPostId'] || platformPostId,
            platformPostUrl: taskRecord['platformPostUrl'] || platformPostUrl,
            'metadata.analyticsSnapshot': {
              platform,
              platformPostId,
              platformPostUrl,
              recordedAt: recordedAt.toISOString(),
              ...this.toTaskAnalyticsSnapshot(metrics),
            },
            'metadata.analytics_snapshot': {
              platform,
              platformPostId,
              platformPostUrl,
              recordedAt: recordedAt.toISOString(),
              ...this.toTaskAnalyticsSnapshot(metrics),
            },
            'metadata.views': metrics.views,
            'metadata.likes': metrics.likes,
            'metadata.comments': metrics.comments,
            'metadata.shares': metrics.shares,
            'metadata.engagementRate': metrics.engagementRate,
          },
        }).exec()

        collected += 1
      }
      catch (error) {
        failed += 1
        this.logger.warn('Analytics collection failed for task ' + (taskRecord['_id']?.toString?.() || 'unknown') + ': ' + (error instanceof Error ? error.message : String(error)))
      }
    }

    return {
      scanned: tasks.length,
      collected,
      skipped,
      failed,
      recordedAt: recordedAt.toISOString(),
      orgId: orgId || null,
    }
  }

  private async resolveMetrics(task: VideoTaskAnalyticsRecord, platform: string, platformPostId: string) {
    if (platform && platformPostId) {
      try {
        const detail = await this.tikHubService.getVideoDetail(platform, platformPostId)
        const rawMetrics = this.readRecord(detail?.data?.metrics)
        if (rawMetrics) {
          const views = this.toMetric(rawMetrics['views'])
          const likes = this.toMetric(rawMetrics['likes'])
          const comments = this.toMetric(rawMetrics['comments'])
          const shares = this.toMetric(rawMetrics['shares'])
          const saves = this.toMetric(rawMetrics['favorites'] ?? rawMetrics['saves'])
          const engagementRate = views > 0
            ? Number((((likes + comments + shares + saves) / views) * 100).toFixed(4))
            : 0

          return {
            views,
            likes,
            comments,
            shares,
            saves,
            engagementRate,
            source: 'tikhub',
            raw: this.readRecord(detail?.data),
          } satisfies CollectedMetrics
        }
      }
      catch (error) {
        this.logger.warn('TikHub analytics fallback for task ' + (task['_id']?.toString?.() || 'unknown') + ': ' + (error instanceof Error ? error.message : String(error)))
      }
    }

    const fallback = this.readExistingMetrics(task)
    if (!fallback) {
      return null
    }

    return {
      ...fallback,
      source: 'task_snapshot',
      raw: null,
    } satisfies CollectedMetrics
  }

  private readExistingMetrics(task: VideoTaskAnalyticsRecord) {
    const metadata = task.metadata
    const candidates = [
      task.analyticsSnapshot,
      metadata?.analyticsSnapshot,
      metadata?.analytics_snapshot,
      metadata?.metrics,
      metadata?.performance,
    ]

    for (const candidate of candidates) {
      if (candidate && typeof candidate === 'object') {
        const views = this.toMetric(candidate['views'])
        const likes = this.toMetric(candidate['likes'])
        const comments = this.toMetric(candidate['comments'])
        const shares = this.toMetric(candidate['shares'])
        const saves = this.toMetric(candidate['saves'] ?? candidate['favorites'])
        const engagementRate = this.toDecimal(candidate['engagementRate'])

        if (views || likes || comments || shares || saves || engagementRate) {
          return {
            views,
            likes,
            comments,
            shares,
            saves,
            engagementRate,
          }
        }
      }
    }

    return null
  }

  private readPlatform(task: VideoTaskAnalyticsRecord) {
    const candidates = [
      task.metadata?.publishInfo?.['platform'],
      task.metadata?.platform,
      task.metadata?.sourcePlatform,
      task.source?.type,
    ]

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        const normalized = candidate.trim().toLowerCase()
        if (normalized === 'rednote' || normalized === 'xhs') {
          return 'xiaohongshu'
        }
        return normalized
      }
    }

    return ''
  }

  private readPlatformPostId(task: VideoTaskAnalyticsRecord) {
    const candidates = [
      task.platformPostId,
      task.source?.videoId,
      task.metadata?.platformPostId,
      task.metadata?.videoId,
      task.metadata?.analyticsVideoId,
    ]

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim()
      }
    }

    return ''
  }

  private readPlatformPostUrl(task: VideoTaskAnalyticsRecord) {
    const candidates = [
      task.platformPostUrl,
      task.metadata?.publishInfo?.['publishUrl'],
      task.metadata?.platformPostUrl,
      task.outputVideoUrl,
      task.sourceVideoUrl,
    ]

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim()
      }
    }

    return ''
  }

  private toTaskAnalyticsSnapshot(metrics: CollectedMetrics) {
    return {
      views: metrics.views,
      likes: metrics.likes,
      comments: metrics.comments,
      shares: metrics.shares,
      engagementRate: metrics.engagementRate,
    }
  }

  private buildOrgMatch(orgId: string) {
    const clauses: Record<string, any>[] = [{ userId: orgId }]
    if (Types.ObjectId.isValid(orgId)) {
      clauses.unshift({ orgId: new Types.ObjectId(orgId) })
    }

    return clauses.length === 1 ? clauses[0] : { $or: clauses }
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

  private toMetric(value: unknown) {
    const normalized = Number(value || 0)
    if (!Number.isFinite(normalized) || normalized <= 0) {
      return 0
    }

    return Math.trunc(normalized)
  }

  private toDecimal(value: unknown) {
    const normalized = Number(value || 0)
    return Number.isFinite(normalized) && normalized > 0
      ? Number(normalized.toFixed(4))
      : 0
  }

  private readRecord(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, any>
      : null
  }
}
