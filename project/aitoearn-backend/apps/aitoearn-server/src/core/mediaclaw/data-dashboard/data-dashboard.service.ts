import { BadRequestException, Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import {
  Organization,
  OrgType,
  Subscription,
  SubscriptionPlan,
  SubscriptionStatus,
  VideoAnalytics,
  VideoTask,
  VideoTaskStatus,
} from '@yikart/mongodb'
import { Model, PipelineStage, Types } from 'mongoose'
import { MEDIACLAW_SUCCESS_STATUSES } from '../video-task-status.utils'

interface DateRangeInput {
  startDate?: string
  endDate?: string
}

interface ExportTaskRow {
  taskId: string
  status: VideoTaskStatus
  createdAt: Date
  publishedAt: Date | null
  views: number
  likes: number
  comments: number
  shares: number
}

type DashboardTier = 'basic' | 'standard' | 'advanced' | 'full'

interface HealthSignalSummary {
  trackedVideos: number
  lowPlayRatio: number
  abnormalEngagementRatio: number
  firstDayDecayRate: number
}

interface OverviewActivityPoint {
  date: string
  totalVideos: number
  completedVideos: number
  totalViews: number
}

interface ContentHealthPayload {
  orgId: string
  source: 'mongodb' | 'task_snapshot'
  dashboardTier: DashboardTier
  windowDays: number
  engagementRate: number
  averageEngagementRate: number
  completionRate: number
  publishingConsistency: number
  averageViewsPerVideo: number
  trackedVideos: number
  lowPlayRatio: number
  abnormalEngagementRatio: number
  firstDayDecayRate: number
  totals: {
    totalVideos: number
    completedVideos: number
    totalViews: number
    totalLikes: number
    totalComments: number
    totalShares: number
  }
}

interface BenchmarkPayload {
  engagementRate: number
  completionRate: number
  publishingConsistency: number
  averageViewsPerVideo: number
  lowPlayRatio: number
  abnormalEngagementRatio: number
  firstDayDecayRate: number
  trackedVideos: number
  taskCount: number
}

@Injectable()
export class DataDashboardService {
  constructor(
    @InjectModel(VideoTask.name) private readonly videoTaskModel: Model<VideoTask>,
    @InjectModel(VideoAnalytics.name) private readonly videoAnalyticsModel: Model<VideoAnalytics>,
    @InjectModel(Organization.name) private readonly organizationModel: Model<Organization>,
    @InjectModel(Subscription.name) private readonly subscriptionModel: Model<Subscription>,
  ) {}

  async getOverview(orgId: string) {
    const health = await this.getContentHealth(orgId)
    const activity = await this.buildOverviewActivity(orgId)
    const recentVideos = await this.videoTaskModel.find(
      this.buildOrgMatch(orgId),
      {
        copy: 1,
        metadata: 1,
        brandId: 1,
        brandName: 1,
        status: 1,
        taskType: 1,
        sourceVideoUrl: 1,
        outputVideoUrl: 1,
        creditsConsumed: 1,
        createdAt: 1,
        updatedAt: 1,
        completedAt: 1,
        publishedAt: 1,
      },
    )
      .sort({ createdAt: -1 })
      .limit(5)
      .lean()
      .exec()

    const totalVideos = health.totals?.totalVideos || 0
    const completedVideos = health.totals?.completedVideos || 0

    return {
      orgId,
      source: health.source,
      dashboardTier: health.dashboardTier,
      windowDays: health.windowDays,
      summary: {
        totalVideos,
        completedVideos,
        successRate: totalVideos > 0
          ? this.round((completedVideos / totalVideos) * 100)
          : 0,
        totalViews: health.totals?.totalViews || 0,
        averageViewsPerVideo: health.averageViewsPerVideo || 0,
        engagementRate: health.engagementRate || 0,
        publishingConsistency: health.publishingConsistency || 0,
        trackedVideos: typeof health.trackedVideos === 'number' ? health.trackedVideos : 0,
      },
      activity,
      recentVideos,
    }
  }

  async getContentHealth(orgId: string) {
    const [tier, payload] = await Promise.all([
      this.getDashboardTier(orgId),
      this.buildContentHealthPayload(orgId),
    ])

    return this.applyTierVisibility(tier, payload)
  }

  async getCompetitorBenchmark(orgId: string, industry: string) {
    const last30Days = this.buildDaysAgo(30)

    const [tier, resolvedIndustry, health, benchmark] = await Promise.all([
      this.getDashboardTier(orgId),
      this.getResolvedIndustry(orgId, industry),
      this.buildContentHealthPayload(orgId),
      this.getIndustryBenchmark(industry, last30Days),
    ])

    const industryAverage = benchmark ?? await this.getIndustryBenchmark('generic', last30Days)

    return this.applyTierVisibility(tier, {
      orgId,
      industry: resolvedIndustry,
      source: benchmark ? 'mongodb' : (industryAverage ? 'fallback' : 'empty'),
      dashboardTier: tier,
      orgMetrics: {
        engagementRate: health.engagementRate,
        completionRate: health.completionRate,
        publishingConsistency: health.publishingConsistency,
        averageViewsPerVideo: health.averageViewsPerVideo,
        lowPlayRatio: health.lowPlayRatio,
        abnormalEngagementRatio: health.abnormalEngagementRatio,
        firstDayDecayRate: health.firstDayDecayRate,
      },
      industryAverage: industryAverage ? {
        engagementRate: industryAverage.engagementRate,
        completionRate: industryAverage.completionRate,
        publishingConsistency: industryAverage.publishingConsistency,
        averageViewsPerVideo: industryAverage.averageViewsPerVideo,
        lowPlayRatio: industryAverage.lowPlayRatio,
        abnormalEngagementRatio: industryAverage.abnormalEngagementRatio,
        firstDayDecayRate: industryAverage.firstDayDecayRate,
        trackedVideos: industryAverage.trackedVideos,
        taskCount: industryAverage.taskCount,
      } : null,
      delta: industryAverage ? {
        engagementRate: this.round(health.engagementRate - industryAverage.engagementRate),
        completionRate: this.round(health.completionRate - industryAverage.completionRate),
        publishingConsistency: this.round(health.publishingConsistency - industryAverage.publishingConsistency),
        averageViewsPerVideo: this.round(health.averageViewsPerVideo - industryAverage.averageViewsPerVideo),
        lowPlayRatio: this.round(health.lowPlayRatio - industryAverage.lowPlayRatio),
        abnormalEngagementRatio: this.round(health.abnormalEngagementRatio - industryAverage.abnormalEngagementRatio),
        firstDayDecayRate: this.round(health.firstDayDecayRate - industryAverage.firstDayDecayRate),
      } : null,
    })
  }

  async getColdStartRecommendations(orgId: string) {
    const [tasks, postingWindows] = await Promise.all([
      this.videoTaskModel.find(
        this.buildOrgMatch(orgId),
        {
          copy: 1,
          metadata: 1,
          createdAt: 1,
          publishedAt: 1,
          completedAt: 1,
        },
      )
        .sort({ createdAt: -1 })
        .limit(20)
        .lean()
        .exec(),
      this.videoTaskModel.aggregate<{ window: string }>([
        {
          $match: {
            ...this.buildOrgMatch(orgId),
            $or: [
              { publishedAt: { $ne: null } },
              { completedAt: { $ne: null } },
              { 'metadata.publishedAt': { $exists: true, $ne: null } },
            ],
          },
        },
        ...this.buildTaskMetricStages(),
        {
          $match: {
            publishedAtValue: { $ne: null },
          },
        },
        {
          $project: {
            window: {
              $concat: [
                {
                  $dateToString: {
                    format: '%H:00',
                    date: '$publishedAtValue',
                  },
                },
                '-',
                {
                  $dateToString: {
                    format: '%H:00',
                    date: {
                      $dateAdd: {
                        startDate: '$publishedAtValue',
                        unit: 'hour',
                        amount: 1,
                      },
                    },
                  },
                },
              ],
            },
          },
        },
        { $group: { _id: '$window', count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
        { $limit: 3 },
        { $project: { _id: 0, window: '$_id' } },
      ]).exec(),
    ])

    const hashtags = this.pickTopHashtags(tasks)
    const scenes = [...new Set(
      tasks
        .map((task) => {
          const scene = task.metadata?.['scene'] || task.metadata?.['campaign']
          return typeof scene === 'string' ? scene.trim() : ''
        })
        .filter(Boolean),
    )].slice(0, 3)

    return {
      orgId,
      recommendationLevel: tasks.length < 5 ? 'cold_start' : 'optimize',
      contentTypes: scenes.length > 0
        ? scenes
        : ['案例拆解', '前后对比', '问题答疑'],
      postingTimes: postingWindows.length > 0
        ? postingWindows.map(item => item.window)
        : ['09:00-10:00', '12:00-13:00', '19:00-21:00'],
      hashtags: hashtags.length > 0
        ? hashtags
        : ['#爆款拆解', '#品牌增长', '#内容复用'],
    }
  }

  async exportReport(orgId: string, format: string, dateRange: DateRangeInput) {
    const normalizedFormat = format.trim().toLowerCase()
    if (!['csv', 'json'].includes(normalizedFormat)) {
      throw new BadRequestException('format must be csv or json')
    }

    const normalizedRange = this.normalizeDateRange(dateRange)
    const industry = await this.getOrgIndustry(orgId)

    const [health, benchmark, coldStart, tasks] = await Promise.all([
      this.getContentHealth(orgId),
      this.getCompetitorBenchmark(orgId, industry),
      this.getColdStartRecommendations(orgId),
      this.getTasksForExport(orgId, normalizedRange),
    ])

    if (normalizedFormat === 'csv') {
      return {
        format: 'csv',
        fileName: `mediaclaw-report-${orgId}.csv`,
        dateRange: normalizedRange,
        contentType: 'text/csv',
        content: this.buildCsvReport(health, benchmark, coldStart, tasks),
      }
    }

    return {
      format: 'json',
      fileName: `mediaclaw-report-${orgId}.json`,
      dateRange: normalizedRange,
      contentType: 'application/json',
      data: {
        health,
        benchmark,
        coldStart,
        tasks,
      },
    }
  }

  private async buildContentHealthPayload(orgId: string): Promise<ContentHealthPayload> {
    const last30Days = this.buildDaysAgo(30)
    const [tier, [overview], healthSignals] = await Promise.all([
      this.getDashboardTier(orgId),
      this.videoTaskModel.aggregate<{
        totalVideos: number
        completedVideos: number
        totalViews: number
        totalLikes: number
        totalComments: number
        totalShares: number
        avgCompletionMetric: number
        avgEngagementMetric: number
        publishedDaysCount: number
        analyticsBackfilledVideos: number
      }>([
        {
          $match: {
            ...this.buildOrgMatch(orgId),
            createdAt: { $gte: last30Days },
          },
        },
        ...this.buildTaskMetricStages(last30Days),
        {
          $group: {
            _id: null,
            totalVideos: { $sum: 1 },
            completedVideos: {
              $sum: {
                $cond: [{ $in: ['$status', MEDIACLAW_SUCCESS_STATUSES] }, 1, 0],
              },
            },
            totalViews: { $sum: '$views' },
            totalLikes: { $sum: '$likes' },
            totalComments: { $sum: '$comments' },
            totalShares: { $sum: '$shares' },
            avgCompletionMetric: { $avg: '$contentCompletionRate' },
            avgEngagementMetric: { $avg: '$engagementRateMetric' },
            publishedDays: { $addToSet: '$publishedDay' },
            analyticsBackfilledVideos: {
              $sum: {
                $cond: [{ $ifNull: ['$latestAnalytics.recordedAt', false] }, 1, 0],
              },
            },
          },
        },
        {
          $project: {
            _id: 0,
            totalVideos: 1,
            completedVideos: 1,
            totalViews: 1,
            totalLikes: 1,
            totalComments: 1,
            totalShares: 1,
            avgCompletionMetric: 1,
            avgEngagementMetric: 1,
            analyticsBackfilledVideos: 1,
            publishedDaysCount: {
              $size: {
                $filter: {
                  input: '$publishedDays',
                  as: 'day',
                  cond: { $ne: ['$$day', null] },
                },
              },
            },
          },
        },
      ]).exec(),
      this.getHealthSignalSummary(orgId, last30Days),
    ])

    const totalVideos = overview?.totalVideos || 0
    const completedVideos = overview?.completedVideos || 0
    const totalViews = overview?.totalViews || 0
    const totalLikes = overview?.totalLikes || 0
    const totalComments = overview?.totalComments || 0
    const totalShares = overview?.totalShares || 0
    const fallbackCompletionRate = totalVideos > 0 ? (completedVideos / totalVideos) * 100 : 0

    return {
      orgId,
      source: overview?.analyticsBackfilledVideos ? 'mongodb' : 'task_snapshot',
      dashboardTier: tier,
      windowDays: 30,
      engagementRate: totalViews > 0
        ? this.round(((totalLikes + totalComments + totalShares) / totalViews) * 100)
        : 0,
      averageEngagementRate: this.round(overview?.avgEngagementMetric || 0),
      completionRate: this.round(
        overview?.avgCompletionMetric && overview.avgCompletionMetric > 0
          ? overview.avgCompletionMetric
          : fallbackCompletionRate,
      ),
      publishingConsistency: this.round(((overview?.publishedDaysCount || 0) / 30) * 100),
      averageViewsPerVideo: totalVideos > 0 ? this.round(totalViews / totalVideos) : 0,
      trackedVideos: healthSignals.trackedVideos,
      lowPlayRatio: healthSignals.lowPlayRatio,
      abnormalEngagementRatio: healthSignals.abnormalEngagementRatio,
      firstDayDecayRate: healthSignals.firstDayDecayRate,
      totals: {
        totalVideos,
        completedVideos,
        totalViews,
        totalLikes,
        totalComments,
        totalShares,
      },
    }
  }

  private async getOrgIndustry(orgId: string) {
    if (!Types.ObjectId.isValid(orgId)) {
      return 'generic'
    }

    const org = await this.organizationModel.findById(orgId, { settings: 1 }).lean().exec()
    const industry = org?.settings?.['industry']
    return typeof industry === 'string' && industry.trim() ? industry.trim() : 'generic'
  }

  private async getResolvedIndustry(orgId: string, requestedIndustry?: string) {
    if (requestedIndustry && requestedIndustry.trim() && requestedIndustry.trim().toLowerCase() !== 'generic') {
      return requestedIndustry.trim()
    }

    return this.getOrgIndustry(orgId)
  }

  private async getDashboardTier(orgId: string): Promise<DashboardTier> {
    const orgObjectId = Types.ObjectId.isValid(orgId) ? new Types.ObjectId(orgId) : null
    const [organization, subscription] = await Promise.all([
      orgObjectId
        ? this.organizationModel.findById(orgObjectId, { type: 1, planId: 1 }).lean().exec()
        : Promise.resolve(null),
      orgObjectId
        ? this.subscriptionModel.findOne(
          { orgId: orgObjectId, status: SubscriptionStatus.ACTIVE },
          { plan: 1 },
        ).sort({ createdAt: -1 }).lean().exec()
        : Promise.resolve(null),
    ])

    if (subscription?.plan === SubscriptionPlan.FLAGSHIP) {
      return 'full'
    }
    if (subscription?.plan === SubscriptionPlan.PRO) {
      return 'advanced'
    }
    if (subscription?.plan === SubscriptionPlan.TEAM) {
      return 'standard'
    }

    if (organization?.type === OrgType.ENTERPRISE) {
      return 'full'
    }
    if (organization?.type === OrgType.PROFESSIONAL) {
      return 'advanced'
    }
    if (organization?.type === OrgType.TEAM) {
      return 'standard'
    }

    const normalizedPlanId = organization?.planId?.trim().toLowerCase() || ''
    if (normalizedPlanId.includes('flagship') || normalizedPlanId.includes('full')) {
      return 'full'
    }
    if (normalizedPlanId.includes('pro') || normalizedPlanId.includes('advanced')) {
      return 'advanced'
    }
    if (normalizedPlanId.includes('team') || normalizedPlanId.includes('standard')) {
      return 'standard'
    }

    return 'basic'
  }

  private async getHealthSignalSummary(orgId: string, startDate: Date): Promise<HealthSignalSummary> {
    const [summary] = await this.videoAnalyticsModel.aggregate<HealthSignalSummary>([
      {
        $match: {
          recordedAt: { $gte: startDate },
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
      {
        $match: this.prefixKeys('task.', this.buildOrgMatch(orgId)),
      },
      { $sort: { videoTaskId: 1, recordedAt: 1 } },
      {
        $group: {
          _id: '$videoTaskId',
          snapshots: {
            $push: {
              recordedAt: '$recordedAt',
              views: '$views',
              engagementRate: '$engagementRate',
            },
          },
          latestViews: { $last: '$views' },
          latestEngagementRate: { $last: '$engagementRate' },
        },
      },
      {
        $project: {
          latestViews: 1,
          latestEngagementRate: 1,
          firstSnapshot: { $arrayElemAt: ['$snapshots', 0] },
          secondSnapshot: { $arrayElemAt: ['$snapshots', 1] },
        },
      },
      {
        $group: {
          _id: null,
          trackedVideos: { $sum: 1 },
          lowPlayRatio: {
            $avg: {
              $cond: [{ $lt: ['$latestViews', 500] }, 100, 0],
            },
          },
          abnormalEngagementRatio: {
            $avg: {
              $cond: [
                {
                  $or: [
                    { $lt: ['$latestEngagementRate', 1] },
                    { $gt: ['$latestEngagementRate', 15] },
                  ],
                },
                100,
                0,
              ],
            },
          },
          firstDayDecayRate: {
            $avg: {
              $cond: [
                {
                  $and: [
                    { $gt: ['$firstSnapshot.engagementRate', 0] },
                    { $ne: ['$secondSnapshot', null] },
                  ],
                },
                {
                  $max: [
                    0,
                    {
                      $multiply: [
                        {
                          $divide: [
                            {
                              $subtract: [
                                '$firstSnapshot.engagementRate',
                                '$secondSnapshot.engagementRate',
                              ],
                            },
                            '$firstSnapshot.engagementRate',
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
      },
      {
        $project: {
          _id: 0,
          trackedVideos: 1,
          lowPlayRatio: { $round: ['$lowPlayRatio', 2] },
          abnormalEngagementRatio: { $round: ['$abnormalEngagementRatio', 2] },
          firstDayDecayRate: { $round: ['$firstDayDecayRate', 2] },
        },
      },
    ]).exec()

    return summary || {
      trackedVideos: 0,
      lowPlayRatio: 0,
      abnormalEngagementRatio: 0,
      firstDayDecayRate: 0,
    }
  }

  private async getIndustryBenchmark(industry: string, startDate: Date): Promise<BenchmarkPayload | null> {
    const normalizedIndustry = industry.trim().toLowerCase()
    const industryMatch = normalizedIndustry !== 'generic'
      ? [{
        $match: {
          $expr: {
            $eq: [
              {
                $trim: {
                  input: {
                    $toLower: {
                      $ifNull: ['$organization.settings.industry', 'generic'],
                    },
                  },
                },
              },
              normalizedIndustry,
            ],
          },
        },
      }]
      : []

    const [benchmark] = await this.videoTaskModel.aggregate<BenchmarkPayload>([
      {
        $match: {
          createdAt: { $gte: startDate },
        },
      },
      {
        $lookup: {
          from: 'organizations',
          localField: 'orgId',
          foreignField: '_id',
          as: 'organization',
        },
      },
      {
        $unwind: {
          path: '$organization',
          preserveNullAndEmptyArrays: true,
        },
      },
      ...industryMatch,
      ...this.buildTaskMetricStages(startDate),
      {
        $group: {
          _id: null,
          taskCount: { $sum: 1 },
          totalViews: { $sum: '$views' },
          totalLikes: { $sum: '$likes' },
          totalComments: { $sum: '$comments' },
          totalShares: { $sum: '$shares' },
          completionRate: { $avg: '$contentCompletionRate' },
          publishingDays: { $addToSet: '$publishedDay' },
          lowPlayRatio: {
            $avg: {
              $cond: [{ $lt: ['$views', 500] }, 100, 0],
            },
          },
          abnormalEngagementRatio: {
            $avg: {
              $cond: [
                {
                  $or: [
                    { $lt: ['$engagementRateMetric', 1] },
                    { $gt: ['$engagementRateMetric', 15] },
                  ],
                },
                100,
                0,
              ],
            },
          },
          firstDayDecayRate: {
            $avg: {
              $max: [
                0,
                {
                  $subtract: [
                    {
                      $convert: {
                        input: '$metadata.firstDayEngagementRate',
                        to: 'double',
                        onNull: 0,
                        onError: 0,
                      },
                    },
                    '$engagementRateMetric',
                  ],
                },
              ],
            },
          },
          trackedVideos: {
            $sum: {
              $cond: [{ $ifNull: ['$latestAnalytics.recordedAt', false] }, 1, 0],
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          taskCount: 1,
          trackedVideos: 1,
          engagementRate: {
            $round: [
              {
                $cond: [
                  { $gt: ['$totalViews', 0] },
                  {
                    $multiply: [
                      {
                        $divide: [
                          { $add: ['$totalLikes', '$totalComments', '$totalShares'] },
                          '$totalViews',
                        ],
                      },
                      100,
                    ],
                  },
                  0,
                ],
              },
              2,
            ],
          },
          completionRate: { $round: ['$completionRate', 2] },
          publishingConsistency: {
            $round: [
              {
                $multiply: [
                  {
                    $divide: [
                      {
                        $size: {
                          $filter: {
                            input: '$publishingDays',
                            as: 'day',
                            cond: { $ne: ['$$day', null] },
                          },
                        },
                      },
                      30,
                    ],
                  },
                  100,
                ],
              },
              2,
            ],
          },
          averageViewsPerVideo: {
            $round: [
              {
                $cond: [
                  { $gt: ['$taskCount', 0] },
                  { $divide: ['$totalViews', '$taskCount'] },
                  0,
                ],
              },
              2,
            ],
          },
          lowPlayRatio: { $round: ['$lowPlayRatio', 2] },
          abnormalEngagementRatio: { $round: ['$abnormalEngagementRatio', 2] },
          firstDayDecayRate: { $round: ['$firstDayDecayRate', 2] },
        },
      },
    ]).exec()

    return benchmark || null
  }

  private async getTasksForExport(orgId: string, dateRange: { startDate: Date, endDate: Date }) {
    const tasks = await this.videoTaskModel.aggregate<ExportTaskRow>([
      {
        $match: {
          ...this.buildOrgMatch(orgId),
          createdAt: {
            $gte: dateRange.startDate,
            $lte: dateRange.endDate,
          },
        },
      },
      ...this.buildTaskMetricStages(),
      {
        $project: {
          _id: 0,
          taskId: { $toString: '$_id' },
          status: 1,
          createdAt: 1,
          publishedAt: '$publishedAtValue',
          views: 1,
          likes: 1,
          comments: 1,
          shares: 1,
        },
      },
      { $sort: { createdAt: -1 } },
      { $limit: 200 },
    ]).exec()

    return tasks
  }

  private async buildOverviewActivity(orgId: string) {
    const startDate = this.buildDaysAgo(13)
    const items = await this.videoTaskModel.aggregate<OverviewActivityPoint>([
      {
        $match: {
          ...this.buildOrgMatch(orgId),
          createdAt: { $gte: startDate },
        },
      },
      ...this.buildTaskMetricStages(startDate),
      {
        $group: {
          _id: {
            $dateToString: {
              date: '$createdAt',
              format: '%Y-%m-%d',
            },
          },
          totalVideos: { $sum: 1 },
          completedVideos: {
            $sum: {
              $cond: [{ $in: ['$status', MEDIACLAW_SUCCESS_STATUSES] }, 1, 0],
            },
          },
          totalViews: { $sum: '$views' },
        },
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          date: '$_id',
          totalVideos: 1,
          completedVideos: 1,
          totalViews: { $round: ['$totalViews', 0] },
        },
      },
    ]).exec()

    const itemMap = new Map(items.map(item => [item.date, item]))
    const activity: OverviewActivityPoint[] = []

    for (let offset = 13; offset >= 0; offset -= 1) {
      const current = this.buildDaysAgo(offset)
      const key = current.toISOString().slice(0, 10)
      activity.push(itemMap.get(key) || {
        date: key,
        totalVideos: 0,
        completedVideos: 0,
        totalViews: 0,
      })
    }

    return activity
  }

  private buildCsvReport(
    health: Awaited<ReturnType<DataDashboardService['getContentHealth']>>,
    benchmark: Awaited<ReturnType<DataDashboardService['getCompetitorBenchmark']>>,
    coldStart: Awaited<ReturnType<DataDashboardService['getColdStartRecommendations']>>,
    tasks: ExportTaskRow[],
  ) {
    const rows = [
      ['section', 'key', 'value'],
      ['health', 'engagementRate', String(health.engagementRate)],
      ['health', 'completionRate', String(health.completionRate)],
      ['health', 'publishingConsistency', String(health.publishingConsistency)],
      ['benchmark', 'industry', benchmark.industry],
      ['benchmark', 'engagementRateDelta', String(benchmark.delta?.engagementRate || 0)],
      ['benchmark', 'completionRateDelta', String(benchmark.delta?.completionRate || 0)],
      ['benchmark', 'publishingConsistencyDelta', String(benchmark.delta?.publishingConsistency || 0)],
      ['benchmark', 'averageViewsPerVideoDelta', String(benchmark.delta?.averageViewsPerVideo || 0)],
      ['coldStart', 'contentTypes', coldStart.contentTypes.join('|')],
      ['coldStart', 'postingTimes', coldStart.postingTimes.join('|')],
      ['coldStart', 'hashtags', coldStart.hashtags.join('|')],
      ['tasks', 'header', 'taskId|status|createdAt|publishedAt|views|likes|comments|shares'],
      ...tasks.map(task => ([
        'tasks',
        'row',
        [
          task.taskId,
          task.status,
          task.createdAt.toISOString(),
          task.publishedAt ? task.publishedAt.toISOString() : '',
          String(task.views),
          String(task.likes),
          String(task.comments),
          String(task.shares),
        ].join('|'),
      ])),
    ]

    return rows
      .map(columns => columns.map(value => this.escapeCsv(value)).join(','))
      .join('\n')
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
          engagementRateMetric: this.buildMetricExpression([
            'latestAnalytics.engagementRate',
            'analyticsSnapshot.engagementRate',
            'metadata.engagementRate',
            'metadata.metrics.engagementRate',
            'metadata.performance.engagementRate',
          ]),
          contentCompletionRate: this.buildMetricExpression([
            'metadata.completionRate',
            'metadata.metrics.completionRate',
            'metadata.performance.completionRate',
          ]),
          publishedAtValue: {
            $ifNull: [
              '$publishedAt',
              {
                $ifNull: [
                  {
                    $convert: {
                      input: '$metadata.publishedAt',
                      to: 'date',
                      onNull: null,
                      onError: null,
                    },
                  },
                  '$completedAt',
                ],
              },
            ],
          },
        },
      },
      {
        $addFields: {
          publishedDay: {
            $cond: [
              { $ne: ['$publishedAtValue', null] },
              {
                $dateToString: {
                  date: '$publishedAtValue',
                  format: '%Y-%m-%d',
                },
              },
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

  private prefixKeys(prefix: string, query: Record<string, any>): Record<string, any> {
    if ('$or' in query && Array.isArray(query['$or'])) {
      return {
        $or: query['$or'].map((item: Record<string, any>) => this.prefixKeys(prefix, item)),
      }
    }

    return Object.entries(query).reduce<Record<string, any>>((accumulator, [key, value]) => {
      accumulator[`${prefix}${key}`] = value
      return accumulator
    }, {})
  }

  private applyTierVisibility<T extends Record<string, any>>(tier: DashboardTier, payload: T) {
    if (tier === 'full') {
      return payload
    }

    const result: any = { ...payload }

    if (tier === 'advanced') {
      delete result.firstDayDecayRate
      if (result.orgMetrics) {
        delete result.orgMetrics.firstDayDecayRate
      }
      if (result.industryAverage) {
        delete result.industryAverage.firstDayDecayRate
      }
      if (result.delta) {
        delete result.delta.firstDayDecayRate
      }
      return result as T
    }

    delete result.lowPlayRatio
    delete result.abnormalEngagementRatio
    delete result.firstDayDecayRate
    delete result.trackedVideos

    if (tier === 'standard') {
      if (result.orgMetrics) {
        delete result.orgMetrics.lowPlayRatio
        delete result.orgMetrics.abnormalEngagementRatio
        delete result.orgMetrics.firstDayDecayRate
      }
      if (result.industryAverage) {
        delete result.industryAverage.lowPlayRatio
        delete result.industryAverage.abnormalEngagementRatio
        delete result.industryAverage.firstDayDecayRate
        delete result.industryAverage.trackedVideos
        delete result.industryAverage.taskCount
      }
      if (result.delta) {
        delete result.delta.lowPlayRatio
        delete result.delta.abnormalEngagementRatio
        delete result.delta.firstDayDecayRate
      }
      return result as T
    }

    delete result.averageEngagementRate
    delete result.averageViewsPerVideo
    if (result.totals) {
      delete result.totals.totalShares
    }
    if (result.orgMetrics) {
      delete result.orgMetrics.averageViewsPerVideo
      delete result.orgMetrics.lowPlayRatio
      delete result.orgMetrics.abnormalEngagementRatio
      delete result.orgMetrics.firstDayDecayRate
    }
    if (result.industryAverage) {
      delete result.industryAverage.averageViewsPerVideo
      delete result.industryAverage.lowPlayRatio
      delete result.industryAverage.abnormalEngagementRatio
      delete result.industryAverage.firstDayDecayRate
      delete result.industryAverage.trackedVideos
      delete result.industryAverage.taskCount
    }
    if (result.delta) {
      delete result.delta.averageViewsPerVideo
      delete result.delta.lowPlayRatio
      delete result.delta.abnormalEngagementRatio
      delete result.delta.firstDayDecayRate
    }

    return result as T
  }

  private normalizeDateRange(input: DateRangeInput) {
    const endDate = input.endDate ? new Date(input.endDate) : new Date()
    const startDate = input.startDate ? new Date(input.startDate) : new Date(endDate)

    if (!input.startDate) {
      startDate.setDate(endDate.getDate() - 30)
    }

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      throw new BadRequestException('Invalid date range')
    }

    if (startDate > endDate) {
      throw new BadRequestException('startDate must be before endDate')
    }

    return { startDate, endDate }
  }

  private pickTopHashtags(tasks: Array<{ copy?: { hashtags?: string[] } }>) {
    const counters = new Map<string, number>()

    tasks.forEach((task) => {
      task.copy?.hashtags?.forEach((hashtag) => {
        if (!hashtag) {
          return
        }

        counters.set(hashtag, (counters.get(hashtag) || 0) + 1)
      })
    })

    return [...counters.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([hashtag]) => hashtag)
  }

  private buildDaysAgo(days: number) {
    const date = new Date()
    date.setDate(date.getDate() - days)
    return date
  }

  private escapeCsv(value: string) {
    return `"${value.replace(/"/g, '""')}"`
  }

  private round(value: number) {
    return Number(value.toFixed(2))
  }
}
