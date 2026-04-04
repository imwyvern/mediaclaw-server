import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { VideoAnalytics, VideoTask, VideoTaskStatus } from '@yikart/mongodb'
import { Model, PipelineStage, Types } from 'mongoose'

import { MEDIACLAW_SUCCESS_STATUSES } from '../video-task-status.utils'
import { AnalyticsCollectorService } from './analytics-collector.service'

type TrendPeriod = 'daily' | 'weekly' | 'monthly'
type AnalyticsMetricKey = 'views' | 'likes' | 'comments' | 'shares' | 'saves' | 'followers' | 'engagementRate'
type AnalyticsRecord = Record<string, any>
type VideoTaskRecord = Record<string, any>
type PrefixedAnalyticsQuery = Record<string, unknown>

interface OverviewWindowSummary {
  windowDays: number
  trackedVideos: number
  publishedVideos: number
  totalViews: number
  totalLikes: number
  totalComments: number
  totalShares: number
  totalSaves: number
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
  saves: number
  followers: number
  engagementRate: number
  publishPostId: string
  publishPostUrl: string
  deltaFromPrevious: {
    views: number
    likes: number
    comments: number
    shares: number
    saves: number
  } | null
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

  async getOverview(orgId: string, period = 30) {
    const requestedWindowDays = Math.max(1, Math.min(Number(period) || 30, 365))
    const [summary, last7Days, last30Days, requestedWindow] = await Promise.all([
      this.getTaskOverviewSummary(orgId, requestedWindowDays),
      this.getOverviewWindow(orgId, 7),
      this.getOverviewWindow(orgId, 30),
      this.getOverviewWindow(orgId, requestedWindowDays),
    ])

    return {
      summary,
      last7Days,
      last30Days,
      requestedWindow,
      source: 'video_analytics',
    }
  }

  async getVideoStats(orgId: string, taskId: string) {
    const task = await this.resolveTaskRecord(orgId, taskId)
    const latest = await this.analyticsCollectorService.getVideoLatestMetrics(task['_id'].toString())
    const metrics = this.readMetrics(latest)
    const engagementRate = Number(latest['engagementRate'] || this.calculateEngagementRate(metrics))

    return {
      taskId: task['_id'].toString(),
      status: task['status'] || '',
      outputVideoUrl: task['outputVideoUrl'] || '',
      createdAt: task['createdAt'] || null,
      completedAt: task['completedAt'] || null,
      publishedAt: this.resolveBaselineAt(task),
      performance: {
        views: metrics.views,
        likes: metrics.likes,
        comments: metrics.comments,
        shares: metrics.shares,
        saves: metrics.saves,
        followers: metrics.followers,
        engagementScore: metrics.likes + metrics.comments * 2 + metrics.shares * 3,
        engagementRate: this.round(engagementRate),
      },
      latestAnalytics: latest,
    }
  }

  async getVideoHistory(orgId: string, videoId: string) {
    const task = await this.resolveTaskRecord(orgId, videoId)
    const baselineAt = this.resolveBaselineAt(task)
    const series = await this.analyticsCollectorService.getVideoTimeSeries(task['_id'].toString(), 90)
    const history = (series['points'] || []).map((snapshot: AnalyticsRecord) => this.toHistoryItem(snapshot, baselineAt, 'video_analytics'))

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
      taskId: task['_id'].toString(),
      videoId: this.readTaskVideoId(task, videoId),
      platform: this.readTaskPlatform(task),
      status: task['status'] || '',
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
      this.aggregateBenchmark(since, orgId),
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

  async refreshAnalytics(orgId: string, limit = 50, period = 90) {
    const normalizedLimit = Math.max(1, Math.min(Number(limit) || 50, 500))
    const summary = await this.analyticsCollectorService.collectForOrg(
      orgId,
      period,
      normalizedLimit,
    )

    return {
      source: summary['items']?.some((item: Record<string, unknown>) => item['source'] === 'tikhub')
        ? 'tikhub'
        : 'unavailable',
      scope: 'organization',
      ...summary,
    }
  }

  async getTrends(
    orgId: string,
    period: TrendPeriod = 'daily',
    metric: AnalyticsMetricKey = 'views',
    windowDays = 30,
  ) {
    const unit = this.normalizePeriod(period)
    const metricKey = this.resolveMetricKey(metric)
    const since = this.daysAgo(windowDays)

    const items = await this.videoAnalyticsModel.aggregate<Record<string, any>>([
      { $match: { recordedAt: { $gte: since } } },
      ...this.buildAnalyticsMetricProjectionStages(),
      {
        $lookup: {
          from: 'video_tasks',
          localField: 'videoTaskId',
          foreignField: '_id',
          as: 'task',
        },
      },
      { $unwind: '$task' },
      { $match: this.prefixKeys('task', this.buildOrgMatch(orgId)) },
      { $sort: { recordedAt: 1 } },
      {
        $group: {
          _id: {
            bucket: {
              $dateTrunc: {
                date: '$recordedAt',
                unit,
              },
            },
            videoTaskId: '$videoTaskId',
          },
          metricValue: { $last: `$${metricKey}` },
          trackedAt: { $last: '$recordedAt' },
        },
      },
      {
        $group: {
          _id: '$_id.bucket',
          value: { $sum: '$metricValue' },
          trackedVideos: { $sum: 1 },
          latestRecordedAt: { $max: '$trackedAt' },
        },
      },
      {
        $project: {
          _id: 0,
          periodStart: '$_id',
          metric: { $literal: metricKey },
          value: 1,
          trackedVideos: 1,
          latestRecordedAt: 1,
        },
      },
      { $sort: { periodStart: 1 } },
    ]).exec()

    if (items.length > 0) {
      return items.map(item => ({
        ...item,
        value: this.round(item['value']),
      }))
    }

    return this.getTaskTrendsFallback(orgId, period, metricKey, since)
  }

  async getTopContent(
    orgId: string,
    limit = 10,
    metric: AnalyticsMetricKey = 'views',
    period = 30,
  ) {
    const normalizedLimit = Math.max(1, Math.min(Number(limit) || 10, 100))
    const metricKey = this.resolveMetricKey(metric)
    const since = this.daysAgo(period)

    const items = await this.videoAnalyticsModel.aggregate<Record<string, any>>([
      { $match: { recordedAt: { $gte: since } } },
      { $sort: { videoTaskId: 1, recordedAt: -1 } },
      {
        $group: {
          _id: '$videoTaskId',
          latestAnalytics: { $first: '$$ROOT' },
        },
      },
      { $replaceRoot: { newRoot: '$latestAnalytics' } },
      ...this.buildAnalyticsMetricProjectionStages(),
      {
        $lookup: {
          from: 'video_tasks',
          localField: 'videoTaskId',
          foreignField: '_id',
          as: 'task',
        },
      },
      { $unwind: '$task' },
      { $match: this.prefixKeys('task', this.buildOrgMatch(orgId)) },
      {
        $project: {
          _id: 0,
          taskId: '$task._id',
          brandId: '$task.brandId',
          pipelineId: '$task.pipelineId',
          outputVideoUrl: '$task.outputVideoUrl',
          completedAt: '$task.completedAt',
          publishedAt: '$task.publishedAt',
          latestRecordedAt: '$recordedAt',
          metric: { $literal: metricKey },
          metricValue: `$${metricKey}`,
          views: '$views',
          likes: '$likes',
          comments: '$comments',
          shares: '$shares',
          saves: '$saves',
          followers: '$followers',
          engagementRate: '$engagementRate',
        },
      },
      { $sort: { metricValue: -1, latestRecordedAt: -1 } },
      { $limit: normalizedLimit },
    ]).exec()

    if (items.length > 0) {
      return items.map(item => ({
        taskId: item['taskId']?.toString?.() || '',
        brandId: item['brandId']?.toString?.() || null,
        pipelineId: item['pipelineId']?.toString?.() || null,
        outputVideoUrl: item['outputVideoUrl'] || '',
        metric: metricKey,
        metricValue: this.round(item['metricValue']),
        views: this.toMetric(item['views']),
        likes: this.toMetric(item['likes']),
        comments: this.toMetric(item['comments']),
        shares: this.toMetric(item['shares']),
        saves: this.toMetric(item['saves']),
        followers: this.toMetric(item['followers']),
        engagementRate: this.round(item['engagementRate']),
        completedAt: item['completedAt'] || null,
        publishedAt: item['publishedAt'] || null,
        latestRecordedAt: item['latestRecordedAt'] || null,
      }))
    }

    return this.getTopContentFallback(orgId, normalizedLimit, metricKey, since)
  }

  async collectVideo(orgId: string, videoTaskId: string) {
    const task = await this.resolveTaskRecord(orgId, videoTaskId)
    return this.analyticsCollectorService.collectForVideo(task['_id'].toString())
  }

  async getVideoTimeSeries(orgId: string, videoTaskId: string, period = 90) {
    const task = await this.resolveTaskRecord(orgId, videoTaskId)
    return this.analyticsCollectorService.getVideoTimeSeries(task['_id'].toString(), period)
  }

  async getVideoLatestMetrics(orgId: string, videoTaskId: string) {
    const task = await this.resolveTaskRecord(orgId, videoTaskId)
    return this.analyticsCollectorService.getVideoLatestMetrics(task['_id'].toString())
  }

  private async getTaskOverviewSummary(orgId: string, windowDays: number) {
    const [overview, performance] = await Promise.all([
      this.videoTaskModel.aggregate<Record<string, any>>([
        { $match: this.buildOrgMatch(orgId) },
        ...this.buildTaskMetricStages(this.daysAgo(windowDays)),
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
          },
        },
      ]).exec(),
      this.getOverviewWindow(orgId, windowDays),
    ])

    const row = overview[0] || {}
    const totalVideos = Number(row['totalVideos'] || 0)
    const successCount = Number(row['successCount'] || 0)

    return {
      totalVideos,
      creditsUsed: Number(row['creditsUsed'] || 0),
      successRate: totalVideos > 0 ? this.round((successCount / totalVideos) * 100) : 0,
      avgProductionTimeMs: Number(row['avgProductionTimeMs'] || 0),
      avgProductionTimeMinutes: row['avgProductionTimeMs']
        ? this.round(Number(row['avgProductionTimeMs']) / 1000 / 60)
        : 0,
      performance: {
        trackedVideos: performance.trackedVideos,
        publishedVideos: performance.publishedVideos,
        views: performance.totalViews,
        likes: performance.totalLikes,
        comments: performance.totalComments,
        shares: performance.totalShares,
        saves: performance.totalSaves,
        avgViewsPerVideo: performance.avgViewsPerVideo,
        avgEngagementRate: performance.avgEngagementRate,
        latestRecordedAt: performance.latestRecordedAt,
      },
    }
  }

  private async getOverviewWindow(orgId: string, windowDays: number): Promise<OverviewWindowSummary> {
    const since = this.daysAgo(windowDays)
    const items = await this.videoAnalyticsModel.aggregate<Record<string, any>>([
      ...this.buildLatestAnalyticsBasePipeline(since),
      { $match: this.prefixKeys('task', this.buildOrgMatch(orgId)) },
      {
        $group: {
          _id: null,
          trackedVideos: { $sum: 1 },
          publishedVideos: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $eq: ['$task.status', VideoTaskStatus.PUBLISHED] },
                    { $ne: ['$task.publishedAt', null] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          totalViews: { $sum: '$views' },
          totalLikes: { $sum: '$likes' },
          totalComments: { $sum: '$comments' },
          totalShares: { $sum: '$shares' },
          totalSaves: { $sum: '$saves' },
          avgViewsPerVideo: { $avg: '$views' },
          avgEngagementRate: { $avg: '$engagementRate' },
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
          totalSaves: 1,
          avgViewsPerVideo: 1,
          avgEngagementRate: 1,
          latestRecordedAt: 1,
        },
      },
    ]).exec()

    const summary = items[0] || {}
    return {
      windowDays,
      trackedVideos: Number(summary['trackedVideos'] || 0),
      publishedVideos: Number(summary['publishedVideos'] || 0),
      totalViews: Number(summary['totalViews'] || 0),
      totalLikes: Number(summary['totalLikes'] || 0),
      totalComments: Number(summary['totalComments'] || 0),
      totalShares: Number(summary['totalShares'] || 0),
      totalSaves: Number(summary['totalSaves'] || 0),
      avgViewsPerVideo: this.round(summary['avgViewsPerVideo']),
      avgEngagementRate: this.round(summary['avgEngagementRate']),
      latestRecordedAt: summary['latestRecordedAt'] || null,
    }
  }

  private async aggregateBenchmark(since: Date, orgId?: string): Promise<BenchmarkItem[]> {
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

    if (orgId) {
      pipeline.push({ $match: this.prefixKeys('task', this.buildOrgMatch(orgId)) })
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
          avgEngagementRate: { $avg: '$engagementRate' },
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

    const items = await this.videoAnalyticsModel.aggregate<Record<string, any>>(pipeline).exec()
    return items.map(item => ({
      industry: String(item['industry'] || 'unknown'),
      industryKey: String(item['industryKey'] || 'unknown'),
      trackedVideos: Number(item['trackedVideos'] || 0),
      avgViews: this.round(item['avgViews']),
      avgLikes: this.round(item['avgLikes']),
      avgComments: this.round(item['avgComments']),
      avgShares: this.round(item['avgShares']),
      avgEngagementRate: this.round(item['avgEngagementRate']),
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
      ...this.buildAnalyticsMetricProjectionStages(),
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
    }).lean().exec() as VideoTaskRecord | null

    if (!task || !task['_id']) {
      throw new NotFoundException('Video task not found')
    }

    return task
  }

  private resolveBaselineAt(task: VideoTaskRecord) {
    const candidates = [task['publishedAt'], task['metadata']?.['publishedAt'], task['completedAt'], task['createdAt']]
    for (const candidate of candidates) {
      const parsed = this.toDate(candidate)
      if (parsed) {
        return parsed
      }
    }

    return new Date()
  }

  private toHistoryItem(
    snapshot: AnalyticsRecord,
    baselineAt: Date,
    source: 'video_analytics' | 'task_snapshot',
  ): VideoHistoryItem {
    const recordedAt = this.toDate(snapshot['recordedAt']) || baselineAt
    const metrics = this.readMetrics(snapshot)
    const dayOffset = Math.max(0, Math.floor((recordedAt.getTime() - baselineAt.getTime()) / (24 * 60 * 60 * 1000)))

    return {
      recordedAt,
      dayOffset,
      checkpoint: `T+${dayOffset}`,
      views: metrics.views,
      likes: metrics.likes,
      comments: metrics.comments,
      shares: metrics.shares,
      saves: metrics.saves,
      followers: metrics.followers,
      engagementRate: this.calculateEngagementRate(metrics, snapshot['engagementRate']),
      publishPostId: this.readString(snapshot['publishPostId'] || snapshot['platformPostId']),
      publishPostUrl: this.readString(snapshot['publishPostUrl'] || snapshot['platformPostUrl']),
      deltaFromPrevious: this.readDelta(snapshot),
      source,
    }
  }

  private buildTaskSnapshotHistory(task: VideoTaskRecord, baselineAt: Date) {
    const snapshot = task['analyticsSnapshot'] && typeof task['analyticsSnapshot'] === 'object'
      ? task['analyticsSnapshot']
      : task['metadata']?.['analyticsSnapshot'] || task['metadata']?.['analytics_snapshot'] || task['metadata']?.['analytics'] || null

    if (!snapshot || typeof snapshot !== 'object') {
      return null
    }

    const metrics = this.readMetrics(snapshot)
    const hasMetrics = metrics.views || metrics.likes || metrics.comments || metrics.shares || metrics.saves || metrics.followers
    if (!hasMetrics) {
      return null
    }

    return this.toHistoryItem(
      {
        ...snapshot,
        recordedAt: snapshot['recordedAt'] || task['publishedAt'] || task['completedAt'] || task['createdAt'] || baselineAt,
        publishPostId: task['platformPostId'] || task['metadata']?.['platformPostId'] || '',
        publishPostUrl: task['platformPostUrl'] || task['metadata']?.['platformPostUrl'] || task['outputVideoUrl'] || '',
        metrics,
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

  private readTaskPlatform(task: VideoTaskRecord) {
    const candidates = [
      task['metadata']?.['publishInfo']?.['platform'],
      task['metadata']?.['platform'],
      task['metadata']?.['sourcePlatform'],
      task['source']?.['type'],
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

  private readTaskVideoId(task: VideoTaskRecord, fallback: string) {
    const candidates = [
      task['platformPostId'],
      task['source']?.['videoId'],
      task['metadata']?.['videoId'],
      task['metadata']?.['analyticsVideoId'],
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

  private resolveMetricKey(metric: string): AnalyticsMetricKey {
    if (
      metric === 'likes'
      || metric === 'comments'
      || metric === 'shares'
      || metric === 'saves'
      || metric === 'followers'
      || metric === 'engagementRate'
    ) {
      return metric
    }

    return 'views'
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
                metrics: 1,
                views: 1,
                likes: 1,
                comments: 1,
                shares: 1,
                saves: 1,
                followers: 1,
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
            'latestAnalytics.metrics.views',
            'analyticsSnapshot.views',
            'metadata.analyticsSnapshot.metrics.views',
            'metadata.analytics.metrics.views',
            'metadata.views',
            'metadata.viewCount',
            'metadata.metrics.views',
            'metadata.performance.views',
          ]),
          likes: this.buildMetricExpression([
            'latestAnalytics.likes',
            'latestAnalytics.metrics.likes',
            'analyticsSnapshot.likes',
            'metadata.analyticsSnapshot.metrics.likes',
            'metadata.analytics.metrics.likes',
            'metadata.likes',
            'metadata.likeCount',
            'metadata.metrics.likes',
            'metadata.performance.likes',
          ]),
          comments: this.buildMetricExpression([
            'latestAnalytics.comments',
            'latestAnalytics.metrics.comments',
            'analyticsSnapshot.comments',
            'metadata.analyticsSnapshot.metrics.comments',
            'metadata.analytics.metrics.comments',
            'metadata.comments',
            'metadata.commentCount',
            'metadata.metrics.comments',
            'metadata.performance.comments',
          ]),
          shares: this.buildMetricExpression([
            'latestAnalytics.shares',
            'latestAnalytics.metrics.shares',
            'analyticsSnapshot.shares',
            'metadata.analyticsSnapshot.metrics.shares',
            'metadata.analytics.metrics.shares',
            'metadata.shares',
            'metadata.shareCount',
            'metadata.metrics.shares',
            'metadata.performance.shares',
          ]),
          saves: this.buildMetricExpression([
            'latestAnalytics.saves',
            'latestAnalytics.metrics.saves',
            'metadata.analyticsSnapshot.metrics.saves',
            'metadata.analytics.metrics.saves',
            'metadata.saves',
          ]),
          followers: this.buildMetricExpression([
            'latestAnalytics.followers',
            'latestAnalytics.metrics.followers',
            'metadata.analyticsSnapshot.metrics.followers',
            'metadata.analytics.metrics.followers',
            'metadata.followers',
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
      {
        $addFields: {
          engagementRate: {
            $cond: [
              { $gt: ['$views', 0] },
              {
                $cond: [
                  { $gt: ['$latestAnalytics.engagementRate', 0] },
                  '$latestAnalytics.engagementRate',
                  {
                    $multiply: [
                      {
                        $divide: [
                          { $add: ['$likes', '$comments', '$shares', '$saves'] },
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
    ]
  }

  private buildAnalyticsMetricProjectionStages(): PipelineStage[] {
    return [
      {
        $addFields: {
          views: this.buildMetricExpression(['views', 'metrics.views']),
          likes: this.buildMetricExpression(['likes', 'metrics.likes']),
          comments: this.buildMetricExpression(['comments', 'metrics.comments']),
          shares: this.buildMetricExpression(['shares', 'metrics.shares']),
          saves: this.buildMetricExpression(['saves', 'metrics.saves']),
          followers: this.buildMetricExpression(['followers', 'metrics.followers']),
        },
      },
      {
        $addFields: {
          engagementRate: {
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
                          { $add: ['$likes', '$comments', '$shares', '$saves'] },
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

  private prefixKeys(prefix: string, query: PrefixedAnalyticsQuery): PrefixedAnalyticsQuery {
    if ('$or' in query && Array.isArray(query['$or'])) {
      return {
        $or: query['$or'].map(item => this.prefixKeys(prefix, item as PrefixedAnalyticsQuery)),
      }
    }

    const entries = Object.entries(query)
    return Object.fromEntries(entries.map(([key, value]) => [`${prefix}.${key}`, value]))
  }

  private async getTaskTrendsFallback(
    orgId: string,
    period: TrendPeriod,
    metricKey: AnalyticsMetricKey,
    since: Date,
  ) {
    const unit = this.normalizePeriod(period)
    return this.videoTaskModel.aggregate<Record<string, any>>([
      { $match: this.buildOrgMatch(orgId) },
      ...this.buildTaskMetricStages(since),
      {
        $group: {
          _id: {
            $dateTrunc: {
              date: '$createdAt',
              unit,
            },
          },
          value: { $sum: `$${metricKey}` },
          trackedVideos: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          periodStart: '$_id',
          metric: { $literal: metricKey },
          value: 1,
          trackedVideos: 1,
          latestRecordedAt: null,
        },
      },
      { $sort: { periodStart: 1 } },
    ]).exec().then(items => items.map(item => ({
      ...item,
      value: this.round(item['value']),
    })))
  }

  private async getTopContentFallback(
    orgId: string,
    limit: number,
    metricKey: AnalyticsMetricKey,
    since: Date,
  ) {
    return this.videoTaskModel.aggregate<Record<string, any>>([
      {
        $match: {
          ...this.buildOrgMatch(orgId),
          status: { $in: MEDIACLAW_SUCCESS_STATUSES },
        },
      },
      ...this.buildTaskMetricStages(since),
      {
        $project: {
          _id: 0,
          taskId: '$_id',
          brandId: 1,
          pipelineId: 1,
          outputVideoUrl: 1,
          completedAt: 1,
          publishedAt: 1,
          metric: { $literal: metricKey },
          metricValue: `$${metricKey}`,
          views: 1,
          likes: 1,
          comments: 1,
          shares: 1,
          saves: 1,
          followers: 1,
          engagementRate: 1,
        },
      },
      { $sort: { metricValue: -1, completedAt: -1 } },
      { $limit: limit },
    ]).exec().then(items => items.map(item => ({
      taskId: item['taskId']?.toString?.() || '',
      brandId: item['brandId']?.toString?.() || null,
      pipelineId: item['pipelineId']?.toString?.() || null,
      outputVideoUrl: item['outputVideoUrl'] || '',
      metric: metricKey,
      metricValue: this.round(item['metricValue']),
      views: this.toMetric(item['views']),
      likes: this.toMetric(item['likes']),
      comments: this.toMetric(item['comments']),
      shares: this.toMetric(item['shares']),
      saves: this.toMetric(item['saves']),
      followers: this.toMetric(item['followers']),
      engagementRate: this.round(item['engagementRate']),
      completedAt: item['completedAt'] || null,
      publishedAt: item['publishedAt'] || null,
      latestRecordedAt: null,
    })))
  }

  private readMetrics(record: AnalyticsRecord) {
    const metrics = record['metrics'] && typeof record['metrics'] === 'object'
      ? record['metrics']
      : {}

    return {
      views: this.toMetric(metrics['views'] ?? record['views']),
      likes: this.toMetric(metrics['likes'] ?? record['likes']),
      comments: this.toMetric(metrics['comments'] ?? record['comments']),
      shares: this.toMetric(metrics['shares'] ?? record['shares']),
      saves: this.toMetric(metrics['saves'] ?? record['saves']),
      followers: this.toMetric(metrics['followers'] ?? record['followers']),
    }
  }

  private readDelta(record: AnalyticsRecord) {
    const delta = record['deltaFromPrevious']
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

  private calculateEngagementRate(metrics: ReturnType<AnalyticsService['readMetrics']>, fallback?: unknown) {
    const normalizedFallback = Number(fallback || 0)
    if (Number.isFinite(normalizedFallback) && normalizedFallback > 0) {
      return Number(normalizedFallback.toFixed(4))
    }

    if (metrics.views <= 0) {
      return 0
    }

    return Number((((metrics.likes + metrics.comments + metrics.shares + metrics.saves) / metrics.views) * 100).toFixed(4))
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

  private readString(value: unknown) {
    return typeof value === 'string' ? value : ''
  }

  private toMetric(value: unknown) {
    const normalized = Number(value || 0)
    if (!Number.isFinite(normalized) || normalized <= 0) {
      return 0
    }

    return Math.trunc(normalized)
  }

  private round(value: unknown) {
    const normalized = Number(value || 0)
    return Number.isFinite(normalized)
      ? Number(normalized.toFixed(2))
      : 0
  }

  private daysAgo(days: number) {
    return new Date(Date.now() - Math.max(0, Number(days) || 0) * 24 * 60 * 60 * 1000)
  }
}
