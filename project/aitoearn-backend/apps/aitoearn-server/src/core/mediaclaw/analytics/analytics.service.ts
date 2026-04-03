import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { VideoAnalytics, VideoTask, VideoTaskStatus } from '@yikart/mongodb'
import { Model, PipelineStage, Types } from 'mongoose'
import { MEDIACLAW_SUCCESS_STATUSES } from '../video-task-status.utils'
import { AnalyticsCollectorService } from './analytics-collector.service'

type TrendPeriod = 'daily' | 'weekly' | 'monthly'

interface OverviewWindowSummary {
  windowDays: number
  trackedVideos: number
  publishedVideos: number
  totalViews: number
  totalLikes: number
  totalComments: number
  totalShares: number
  avgViewsPerVideo: number
  avgEngagementRate: number
  latestRecordedAt: Date | null
}

interface VideoHistoryItem {
  recordedAt: Date
  dayOffset: number
  checkpoint: string
  views: number
  likes: number
  comments: number
  shares: number
  engagementRate: number
  platformPostId: string
  platformPostUrl: string
  source: 'video_analytics' | 'task_snapshot'
}

interface BenchmarkItem {
  industry: string
  industryKey: string
  trackedVideos: number
  avgViews: number
  avgLikes: number
  avgComments: number
  avgShares: number
  avgEngagementRate: number
}

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectModel(VideoTask.name) private readonly videoTaskModel: Model<VideoTask>,
    @InjectModel(VideoAnalytics.name)
    private readonly videoAnalyticsModel: Model<VideoAnalytics>,
    private readonly analyticsCollectorService: AnalyticsCollectorService,
  ) {}

  async getOverview(orgId: string) {
    const [summary, last7Days, last30Days] = await Promise.all([
      this.getTaskOverviewSummary(orgId),
      this.getOverviewWindow(orgId, 7),
      this.getOverviewWindow(orgId, 30),
    ])

    return {
      summary,
      last7Days,
      last30Days,
      source: 'video_analytics',
    }
  }

  async getVideoStats(orgId: string, taskId: string) {
    if (!Types.ObjectId.isValid(taskId)) {
      throw new NotFoundException('Video task not found')
    }

    const [stats] = await this.videoTaskModel.aggregate<{
      taskId: Types.ObjectId
      status: VideoTaskStatus
      outputVideoUrl: string
      createdAt: Date
      completedAt: Date | null
      views: number
      likes: number
      comments: number
      engagementScore: number
    }>([
      {
        $match: {
          _id: new Types.ObjectId(taskId),
          ...this.buildOrgMatch(orgId),
        },
      },
      ...this.buildTaskMetricStages(),
      {
        $project: {
          _id: 0,
          taskId: '$_id',
          status: 1,
          outputVideoUrl: 1,
          createdAt: 1,
          completedAt: 1,
          views: 1,
          likes: 1,
          comments: 1,
          engagementScore: {
            $add: ['$likes', { $multiply: ['$comments', 2] }],
          },
        },
      },
    ]).exec()

    if (!stats) {
      throw new NotFoundException('Video task not found')
    }

    return {
      taskId: stats.taskId.toString(),
      status: stats.status,
      outputVideoUrl: stats.outputVideoUrl,
      createdAt: stats.createdAt,
      completedAt: stats.completedAt,
      performance: {
        views: stats.views,
        likes: stats.likes,
        comments: stats.comments,
        engagementScore: stats.engagementScore,
        engagementRate: stats.views > 0
          ? this.round(((stats.likes + stats.comments) / stats.views) * 100)
          : 0,
      },
    }
  }

  async getVideoHistory(orgId: string, videoId: string) {
    const task = await this.resolveTaskRecord(orgId, videoId)
    const baselineAt = this.resolveBaselineAt(task)
    const maxRecordedAt = new Date(baselineAt.getTime() + 90 * 24 * 60 * 60 * 1000)

    const snapshots = await this.videoAnalyticsModel.find({
      videoTaskId: task._id,
      recordedAt: { $lte: maxRecordedAt },
    })
      .sort({ recordedAt: 1 })
      .lean()
      .exec()

    const history = snapshots.map(snapshot => this.toHistoryItem(snapshot as any, baselineAt, 'video_analytics'))
    if (history.length === 0) {
      const fallbackHistory = this.buildTaskSnapshotHistory(task, baselineAt)
      if (fallbackHistory) {
        history.push(fallbackHistory)
      }
    }

    if (history.length === 0) {
      throw new NotFoundException('Video analytics not found')
    }

    return {
      taskId: task._id.toString(),
      videoId: this.readTaskVideoId(task, videoId),
      platform: this.readTaskPlatform(task),
      status: task.status || '',
      baselineAt,
      history,
      milestones: this.buildMilestones(history),
      latest: history.at(-1) || null,
      source: history.some(item => item.source === 'video_analytics')
        ? 'video_analytics'
        : 'task_snapshot',
    }
  }

  async getBenchmark(orgId: string, industry?: string) {
    const since = this.daysAgo(30)
    const normalizedIndustry = (industry || '').trim().toLowerCase()
    const [market, organization] = await Promise.all([
      this.aggregateBenchmark(since),
      this.aggregateBenchmark(since, this.buildOrgMatch(orgId)),
    ])

    const marketItems = normalizedIndustry
      ? market.filter(item => item.industryKey === normalizedIndustry)
      : market
    const organizationItems = normalizedIndustry
      ? organization.filter(item => item.industryKey === normalizedIndustry)
      : organization

    return normalizedIndustry
      ? {
          source: 'video_analytics',
          windowDays: 30,
          benchmark: marketItems[0] || this.buildEmptyBenchmark(industry || normalizedIndustry),
          organization: organizationItems[0] || null,
        }
      : {
          source: 'video_analytics',
          windowDays: 30,
          items: marketItems,
          organization: organizationItems,
        }
  }

  async refreshAnalytics(orgId: string, limit = 50) {
    const normalizedLimit = Math.max(1, Math.min(Number(limit) || 50, 500))
    const summary = await this.analyticsCollectorService.collectSnapshots(
      normalizedLimit,
      orgId,
    )

    return {
      source: 'tikhub',
      scope: 'organization',
      ...summary,
    }
  }

  async getTrends(orgId: string, period: TrendPeriod = 'daily') {
    const unit = this.normalizePeriod(period)

    return this.videoTaskModel.aggregate<{
      periodStart: Date
      totalVideos: number
      completedVideos: number
      creditsUsed: number
      views: number
      likes: number
      comments: number
      successRate: number
    }>([
      { $match: this.buildOrgMatch(orgId) },
      ...this.buildTaskMetricStages(),
      {
        $group: {
          _id: {
            $dateTrunc: {
              date: '$createdAt',
              unit,
            },
          },
          totalVideos: { $sum: 1 },
          completedVideos: {
            $sum: {
              $cond: [{ $in: ['$status', MEDIACLAW_SUCCESS_STATUSES] }, 1, 0],
            },
          },
          creditsUsed: { $sum: { $ifNull: ['$creditsConsumed', 0] } },
          views: { $sum: '$views' },
          likes: { $sum: '$likes' },
          comments: { $sum: '$comments' },
        },
      },
      {
        $project: {
          _id: 0,
          periodStart: '$_id',
          totalVideos: 1,
          completedVideos: 1,
          creditsUsed: 1,
          views: 1,
          likes: 1,
          comments: 1,
          successRate: {
            $cond: [
              { $gt: ['$totalVideos', 0] },
              {
                $multiply: [
                  { $divide: ['$completedVideos', '$totalVideos'] },
                  100,
                ],
              },
              0,
            ],
          },
        },
      },
      { $sort: { periodStart: 1 } },
    ]).exec().then(items => items.map(item => ({
      ...item,
      successRate: this.round(item.successRate),
    })))
  }

  async getTopContent(orgId: string, limit = 10) {
    const normalizedLimit = Math.max(1, Math.min(Number(limit) || 10, 100))

    return this.videoTaskModel.aggregate<{
      taskId: Types.ObjectId
      brandId: Types.ObjectId | null
      pipelineId: Types.ObjectId | null
      outputVideoUrl: string
      views: number
      likes: number
      comments: number
      engagementScore: number
      completedAt: Date | null
    }>([
      {
        $match: {
          ...this.buildOrgMatch(orgId),
          status: { $in: MEDIACLAW_SUCCESS_STATUSES },
        },
      },
      ...this.buildTaskMetricStages(),
      {
        $project: {
          _id: 0,
          taskId: '$_id',
          brandId: 1,
          pipelineId: 1,
          outputVideoUrl: 1,
          views: 1,
          likes: 1,
          comments: 1,
          engagementScore: {
            $add: ['$likes', { $multiply: ['$comments', 2] }],
          },
          completedAt: 1,
        },
      },
      { $sort: { engagementScore: -1, completedAt: -1 } },
      { $limit: normalizedLimit },
    ]).exec().then(items => items.map(item => ({
      taskId: item.taskId.toString(),
      brandId: item.brandId?.toString() || null,
      pipelineId: item.pipelineId?.toString() || null,
      outputVideoUrl: item.outputVideoUrl,
      views: item.views,
      likes: item.likes,
      comments: item.comments,
      engagementScore: item.engagementScore,
      completedAt: item.completedAt,
    })))
  }

  private async getTaskOverviewSummary(orgId: string) {
    const [overview] = await this.videoTaskModel.aggregate<{
      totalVideos: number
      creditsUsed: number
      successCount: number
      avgProductionTimeMs: number | null
      totalViews: number
      totalLikes: number
      totalComments: number
    }>([
      { $match: this.buildOrgMatch(orgId) },
      ...this.buildTaskMetricStages(),
      {
        $group: {
          _id: null,
          totalVideos: { $sum: 1 },
          creditsUsed: { $sum: { $ifNull: ['$creditsConsumed', 0] } },
          successCount: {
            $sum: {
              $cond: [{ $in: ['$status', MEDIACLAW_SUCCESS_STATUSES] }, 1, 0],
            },
          },
          avgProductionTimeMs: { $avg: '$productionTimeMs' },
          totalViews: { $sum: '$views' },
          totalLikes: { $sum: '$likes' },
          totalComments: { $sum: '$comments' },
        },
      },
    ]).exec()

    const totalVideos = overview?.totalVideos || 0
    const successCount = overview?.successCount || 0

    return {
      totalVideos,
      creditsUsed: overview?.creditsUsed || 0,
      successRate: totalVideos > 0 ? this.round((successCount / totalVideos) * 100) : 0,
      avgProductionTimeMs: overview?.avgProductionTimeMs || 0,
      avgProductionTimeMinutes: overview?.avgProductionTimeMs
        ? this.round(overview.avgProductionTimeMs / 1000 / 60)
        : 0,
      performance: {
        views: overview?.totalViews || 0,
        likes: overview?.totalLikes || 0,
        comments: overview?.totalComments || 0,
      },
    }
  }

  private async getOverviewWindow(orgId: string, windowDays: number): Promise<OverviewWindowSummary> {
    const since = this.daysAgo(windowDays)
    const [summary] = await this.videoAnalyticsModel.aggregate<OverviewWindowSummary & { _id: null }>([
      ...this.buildLatestAnalyticsBasePipeline(since),
      { $match: this.prefixKeys('task', this.buildOrgMatch(orgId)) },
      {
        $addFields: {
          normalizedEngagementRate: {
            $cond: [
              { $gt: ['$views', 0] },
              {
                $cond: [
                  { $gt: ['$engagementRate', 0] },
                  '$engagementRate',
                  {
                    $multiply: [
                      {
                        $divide: [
                          { $add: ['$likes', '$comments', '$shares'] },
                          '$views',
                        ],
                      },
                      100,
                    ],
                  },
                ],
              },
              0,
            ],
          },
        },
      },
      {
        $group: {
          _id: null,
          trackedVideos: { $sum: 1 },
          publishedVideos: {
            $sum: {
              $cond: [{ $eq: ['$task.status', VideoTaskStatus.PUBLISHED] }, 1, 0],
            },
          },
          totalViews: { $sum: '$views' },
          totalLikes: { $sum: '$likes' },
          totalComments: { $sum: '$comments' },
          totalShares: { $sum: '$shares' },
          avgViewsPerVideo: { $avg: '$views' },
          avgEngagementRate: { $avg: '$normalizedEngagementRate' },
          latestRecordedAt: { $max: '$recordedAt' },
        },
      },
      {
        $project: {
          _id: 0,
          windowDays: { $literal: windowDays },
          trackedVideos: 1,
          publishedVideos: 1,
          totalViews: 1,
          totalLikes: 1,
          totalComments: 1,
          totalShares: 1,
          avgViewsPerVideo: 1,
          avgEngagementRate: 1,
          latestRecordedAt: 1,
        },
      },
    ]).exec()

    return {
      windowDays,
      trackedVideos: summary?.trackedVideos || 0,
      publishedVideos: summary?.publishedVideos || 0,
      totalViews: summary?.totalViews || 0,
      totalLikes: summary?.totalLikes || 0,
      totalComments: summary?.totalComments || 0,
      totalShares: summary?.totalShares || 0,
      avgViewsPerVideo: this.round(summary?.avgViewsPerVideo || 0),
      avgEngagementRate: this.round(summary?.avgEngagementRate || 0),
      latestRecordedAt: summary?.latestRecordedAt || null,
    }
  }

  private async aggregateBenchmark(
    since: Date,
    taskMatch?: Record<string, any>,
  ): Promise<BenchmarkItem[]> {
    const pipeline: PipelineStage[] = [
      ...this.buildLatestAnalyticsBasePipeline(since),
      {
        $lookup: {
          from: 'brands',
          localField: 'task.brandId',
          foreignField: '_id',
          as: 'brand',
        },
      },
      {
        $addFields: {
          brand: { $arrayElemAt: ['$brand', 0] },
        },
      },
    ]

    if (taskMatch) {
      pipeline.push({ $match: this.prefixKeys('task', taskMatch) })
    }

    pipeline.push(
      {
        $addFields: {
          industry: {
            $let: {
              vars: {
                brandIndustry: {
                  $trim: {
                    input: { $ifNull: ['$brand.industry', ''] },
                  },
                },
                taskIndustry: {
                  $trim: {
                    input: { $ifNull: ['$task.metadata.industry', ''] },
                  },
                },
              },
              in: {
                $cond: [
                  { $ne: ['$$brandIndustry', ''] },
                  '$$brandIndustry',
                  {
                    $cond: [
                      { $ne: ['$$taskIndustry', ''] },
                      '$$taskIndustry',
                      'unknown',
                    ],
                  },
                ],
              },
            },
          },
        },
      },
      {
        $addFields: {
          industryKey: { $toLower: '$industry' },
          normalizedEngagementRate: {
            $cond: [
              { $gt: ['$views', 0] },
              {
                $cond: [
                  { $gt: ['$engagementRate', 0] },
                  '$engagementRate',
                  {
                    $multiply: [
                      {
                        $divide: [
                          { $add: ['$likes', '$comments', '$shares'] },
                          '$views',
                        ],
                      },
                      100,
                    ],
                  },
                ],
              },
              0,
            ],
          },
        },
      },
      {
        $group: {
          _id: {
            industry: '$industry',
            industryKey: '$industryKey',
          },
          trackedVideos: { $sum: 1 },
          avgViews: { $avg: '$views' },
          avgLikes: { $avg: '$likes' },
          avgComments: { $avg: '$comments' },
          avgShares: { $avg: '$shares' },
          avgEngagementRate: { $avg: '$normalizedEngagementRate' },
        },
      },
      {
        $project: {
          _id: 0,
          industry: '$_id.industry',
          industryKey: '$_id.industryKey',
          trackedVideos: 1,
          avgViews: 1,
          avgLikes: 1,
          avgComments: 1,
          avgShares: 1,
          avgEngagementRate: 1,
        },
      },
      { $sort: { trackedVideos: -1, avgViews: -1 } },
    )

    const items = await this.videoAnalyticsModel.aggregate<BenchmarkItem>(pipeline).exec()
    return items.map(item => ({
      industry: item.industry,
      industryKey: item.industryKey,
      trackedVideos: item.trackedVideos,
      avgViews: this.round(item.avgViews),
      avgLikes: this.round(item.avgLikes),
      avgComments: this.round(item.avgComments),
      avgShares: this.round(item.avgShares),
      avgEngagementRate: this.round(item.avgEngagementRate),
    }))
  }

  private buildEmptyBenchmark(industry: string): BenchmarkItem {
    return {
      industry,
      industryKey: industry.trim().toLowerCase(),
      trackedVideos: 0,
      avgViews: 0,
      avgLikes: 0,
      avgComments: 0,
      avgShares: 0,
      avgEngagementRate: 0,
    }
  }

  private buildLatestAnalyticsBasePipeline(since: Date): PipelineStage[] {
    return [
      { $match: { recordedAt: { $gte: since } } },
      { $sort: { videoTaskId: 1, recordedAt: -1 } },
      {
        $group: {
          _id: '$videoTaskId',
          latestAnalytics: { $first: '$$ROOT' },
        },
      },
      {
        $replaceRoot: {
          newRoot: '$latestAnalytics',
        },
      },
      {
        $lookup: {
          from: 'video_tasks',
          localField: 'videoTaskId',
          foreignField: '_id',
          as: 'task',
        },
      },
      { $unwind: '$task' },
    ]
  }

  private async resolveTaskRecord(orgId: string, videoId: string) {
    const match = Types.ObjectId.isValid(videoId)
      ? { _id: new Types.ObjectId(videoId) }
      : {
          $or: [
            { platformPostId: videoId },
            { 'source.videoId': videoId },
            { 'metadata.videoId': videoId },
            { 'metadata.analyticsVideoId': videoId },
          ],
        }

    const task = await this.videoTaskModel.findOne({
      $and: [this.buildOrgMatch(orgId), match],
    }).lean().exec() as any | null

    if (!task?._id) {
      throw new NotFoundException('Video task not found')
    }

    return task
  }

  private resolveBaselineAt(task: any) {
    const candidates = [task.publishedAt, task.completedAt, task.createdAt]
    for (const candidate of candidates) {
      if (candidate instanceof Date && !Number.isNaN(candidate.getTime())) {
        return candidate
      }
      if (typeof candidate === 'string' || typeof candidate === 'number') {
        const parsed = new Date(candidate)
        if (!Number.isNaN(parsed.getTime())) {
          return parsed
        }
      }
    }

    return new Date()
  }

  private toHistoryItem(
    snapshot: any,
    baselineAt: Date,
    source: 'video_analytics' | 'task_snapshot',
  ): VideoHistoryItem {
    const recordedAt = snapshot.recordedAt instanceof Date
      ? snapshot.recordedAt
      : new Date(snapshot.recordedAt || baselineAt)
    const dayOffset = Math.max(0, Math.floor((recordedAt.getTime() - baselineAt.getTime()) / (24 * 60 * 60 * 1000)))

    return {
      recordedAt,
      dayOffset,
      checkpoint: `T+${dayOffset}`,
      views: this.toMetric(snapshot.views),
      likes: this.toMetric(snapshot.likes),
      comments: this.toMetric(snapshot.comments),
      shares: this.toMetric(snapshot.shares),
      engagementRate: this.toDecimal(snapshot.engagementRate),
      platformPostId: this.readString(snapshot.platformPostId),
      platformPostUrl: this.readString(snapshot.platformPostUrl),
      source,
    }
  }

  private buildTaskSnapshotHistory(task: any, baselineAt: Date) {
    const snapshot = task.analyticsSnapshot && typeof task.analyticsSnapshot === 'object'
      ? task.analyticsSnapshot
      : task.metadata?.analyticsSnapshot || task.metadata?.analytics_snapshot || null

    if (!snapshot || typeof snapshot !== 'object') {
      return null
    }

    const hasMetrics = this.toMetric(snapshot['views'])
      || this.toMetric(snapshot['likes'])
      || this.toMetric(snapshot['comments'])
      || this.toMetric(snapshot['shares'])
      || this.toDecimal(snapshot['engagementRate'])

    if (!hasMetrics) {
      return null
    }

    return this.toHistoryItem(
      {
        ...snapshot,
        recordedAt: snapshot['recordedAt'] || task.publishedAt || task.completedAt || task.createdAt || baselineAt,
        platformPostId: task.platformPostId || task.metadata?.platformPostId || '',
        platformPostUrl: task.platformPostUrl || task.metadata?.platformPostUrl || task.outputVideoUrl || '',
      },
      baselineAt,
      'task_snapshot',
    )
  }

  private buildMilestones(history: VideoHistoryItem[]) {
    const checkpoints = [1, 3, 7, 30, 90]
    return checkpoints.map(day => {
      const matched = history.find(item => item.dayOffset >= day) || null
      return {
        checkpoint: `T+${day}`,
        snapshot: matched,
      }
    })
  }

  private readTaskPlatform(task: any) {
    const candidates = [
      task.metadata?.publishInfo?.platform,
      task.metadata?.platform,
      task.metadata?.sourcePlatform,
      task.source?.type,
    ]

    for (const candidate of candidates) {
      const value = this.readString(candidate).toLowerCase()
      if (!value) {
        continue
      }

      if (value === 'xhs' || value === 'rednote') {
        return 'xiaohongshu'
      }

      return value
    }

    return ''
  }

  private readTaskVideoId(task: any, fallback: string) {
    const candidates = [
      task.platformPostId,
      task.source?.videoId,
      task.metadata?.videoId,
      task.metadata?.analyticsVideoId,
      fallback,
    ]

    for (const candidate of candidates) {
      const value = this.readString(candidate)
      if (value) {
        return value
      }
    }

    return fallback
  }

  private normalizePeriod(period: TrendPeriod) {
    if (period === 'weekly') {
      return 'week' as const
    }

    if (period === 'monthly') {
      return 'month' as const
    }

    return 'day' as const
  }

  private buildOrgMatch(orgId: string) {
    const clauses: Record<string, any>[] = [{ userId: orgId }]
    if (Types.ObjectId.isValid(orgId)) {
      clauses.unshift({ orgId: new Types.ObjectId(orgId) })
    }

    return clauses.length === 1 ? clauses[0] : { $or: clauses }
  }

  private buildTaskMetricStages(analyticsStartDate?: Date): PipelineStage[] {
    const analyticsMatch: Record<string, any> = {
      $expr: { $eq: ['$videoTaskId', '$$taskId'] },
    }

    if (analyticsStartDate) {
      analyticsMatch['recordedAt'] = { $gte: analyticsStartDate }
    }

    return [
      {
        $lookup: {
          from: 'video_analytics',
          let: { taskId: '$_id' },
          pipeline: [
            {
              $match: analyticsMatch,
            },
            { $sort: { recordedAt: -1 } },
            { $limit: 1 },
            {
              $project: {
                _id: 0,
                views: 1,
                likes: 1,
                comments: 1,
                shares: 1,
                engagementRate: 1,
                recordedAt: 1,
              },
            },
          ],
          as: 'latestAnalytics',
        },
      },
      {
        $addFields: {
          latestAnalytics: { $arrayElemAt: ['$latestAnalytics', 0] },
        },
      },
      {
        $addFields: {
          views: this.buildMetricExpression([
            'latestAnalytics.views',
            'analyticsSnapshot.views',
            'metadata.views',
            'metadata.viewCount',
            'metadata.metrics.views',
            'metadata.performance.views',
          ]),
          likes: this.buildMetricExpression([
            'latestAnalytics.likes',
            'analyticsSnapshot.likes',
            'metadata.likes',
            'metadata.likeCount',
            'metadata.metrics.likes',
            'metadata.performance.likes',
          ]),
          comments: this.buildMetricExpression([
            'latestAnalytics.comments',
            'analyticsSnapshot.comments',
            'metadata.comments',
            'metadata.commentCount',
            'metadata.metrics.comments',
            'metadata.performance.comments',
          ]),
          shares: this.buildMetricExpression([
            'latestAnalytics.shares',
            'analyticsSnapshot.shares',
            'metadata.shares',
            'metadata.shareCount',
            'metadata.metrics.shares',
            'metadata.performance.shares',
          ]),
          productionTimeMs: {
            $cond: [
              {
                $and: [
                  { $ne: ['$completedAt', null] },
                  { $ne: ['$startedAt', null] },
                ],
              },
              { $subtract: ['$completedAt', '$startedAt'] },
              null,
            ],
          },
        },
      },
    ]
  }

  private buildMetricExpression(paths: string[]) {
    return paths.reduceRight<any>(
      (fallback, path) => ({
        $ifNull: [
          {
            $convert: {
              input: `$${path}`,
              to: 'double',
              onError: 0,
              onNull: 0,
            },
          },
          fallback,
        ],
      }),
      0,
    )
  }

  private prefixKeys(prefix: string, query: any): any {
    if ('$or' in query && Array.isArray(query['$or'])) {
      return {
        $or: query['$or'].map((item: Record<string, any>) => this.prefixKeys(prefix, item)),
      }
    }

    return Object.fromEntries(
      Object.entries(query).map(([key, value]) => [`${prefix}.${key}`, value]),
    )
  }

  private daysAgo(days: number) {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  }

  private readString(value: unknown) {
    return typeof value === 'string' ? value.trim() : ''
  }

  private toMetric(value: unknown) {
    const normalized = Number(value || 0)
    return Number.isFinite(normalized) && normalized > 0
      ? Math.trunc(normalized)
      : 0
  }

  private toDecimal(value: unknown) {
    const normalized = Number(value || 0)
    return Number.isFinite(normalized)
      ? this.round(normalized)
      : 0
  }

  private round(value: number) {
    return Number(value.toFixed(2))
  }
}
