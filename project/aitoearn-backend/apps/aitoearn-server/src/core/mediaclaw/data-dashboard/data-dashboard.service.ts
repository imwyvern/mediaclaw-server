import { BadRequestException, Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Organization, VideoTask, VideoTaskStatus } from '@yikart/mongodb'
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
}

@Injectable()
export class DataDashboardService {
  constructor(
    @InjectModel(VideoTask.name) private readonly videoTaskModel: Model<VideoTask>,
    @InjectModel(Organization.name) private readonly organizationModel: Model<Organization>,
  ) {}

  async getContentHealth(orgId: string) {
    const last30Days = new Date()
    last30Days.setDate(last30Days.getDate() - 30)

    const [overview] = await this.videoTaskModel.aggregate<{
      totalVideos: number
      completedVideos: number
      totalViews: number
      totalLikes: number
      totalComments: number
      avgCompletionMetric: number
      publishedDaysCount: number
    }>([
      {
        $match: {
          ...this.buildOrgMatch(orgId),
          createdAt: { $gte: last30Days },
        },
      },
      ...this.buildMetricStages(),
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
          avgCompletionMetric: { $avg: '$contentCompletionRate' },
          publishedDays: { $addToSet: '$publishedDay' },
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
          avgCompletionMetric: 1,
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
    ]).exec()

    const totalVideos = overview?.totalVideos || 0
    const completedVideos = overview?.completedVideos || 0
    const totalViews = overview?.totalViews || 0
    const totalLikes = overview?.totalLikes || 0
    const totalComments = overview?.totalComments || 0
    const fallbackCompletionRate = totalVideos > 0 ? (completedVideos / totalVideos) * 100 : 0

    return {
      orgId,
      windowDays: 30,
      engagementRate: totalViews > 0
        ? this.round(((totalLikes + totalComments) / totalViews) * 100)
        : 0,
      completionRate: this.round(
        overview?.avgCompletionMetric && overview.avgCompletionMetric > 0
          ? overview.avgCompletionMetric
          : fallbackCompletionRate,
      ),
      publishingConsistency: this.round(((overview?.publishedDaysCount || 0) / 30) * 100),
      totals: {
        totalVideos,
        completedVideos,
        totalViews,
        totalLikes,
        totalComments,
      },
    }
  }

  async getCompetitorBenchmark(orgId: string, industry: string) {
    const health = await this.getContentHealth(orgId)
    const baseline = this.getIndustryBaseline(industry)

    return {
      orgId,
      industry,
      source: 'stub',
      orgMetrics: {
        engagementRate: health.engagementRate,
        completionRate: health.completionRate,
        publishingConsistency: health.publishingConsistency,
      },
      industryAverage: baseline,
      delta: {
        engagementRate: this.round(health.engagementRate - baseline.engagementRate),
        completionRate: this.round(health.completionRate - baseline.completionRate),
        publishingConsistency: this.round(health.publishingConsistency - baseline.publishingConsistency),
      },
    }
  }

  async getColdStartRecommendations(orgId: string) {
    const tasks = await this.videoTaskModel.find(
      this.buildOrgMatch(orgId),
      {
        copy: 1,
        metadata: 1,
        createdAt: 1,
      },
    )
      .sort({ createdAt: -1 })
      .limit(20)
      .lean()
      .exec()

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
      postingTimes: ['09:00-10:00', '12:00-13:00', '19:00-21:00'],
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

  private async getOrgIndustry(orgId: string) {
    if (!Types.ObjectId.isValid(orgId)) {
      return 'generic'
    }

    const org = await this.organizationModel.findById(orgId, { settings: 1 }).lean().exec()
    const industry = org?.settings?.['industry']
    return typeof industry === 'string' && industry.trim() ? industry.trim() : 'generic'
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
      ...this.buildMetricStages(),
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
        },
      },
      { $sort: { createdAt: -1 } },
      { $limit: 200 },
    ]).exec()

    return tasks
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
      ['benchmark', 'engagementRateDelta', String(benchmark.delta.engagementRate)],
      ['benchmark', 'completionRateDelta', String(benchmark.delta.completionRate)],
      ['benchmark', 'publishingConsistencyDelta', String(benchmark.delta.publishingConsistency)],
      ['coldStart', 'contentTypes', coldStart.contentTypes.join('|')],
      ['coldStart', 'postingTimes', coldStart.postingTimes.join('|')],
      ['coldStart', 'hashtags', coldStart.hashtags.join('|')],
      ['tasks', 'header', 'taskId|status|createdAt|publishedAt|views|likes|comments'],
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

  private buildMetricStages(): PipelineStage[] {
    return [
      {
        $addFields: {
          views: this.buildMetricExpression([
            'metadata.views',
            'metadata.viewCount',
            'metadata.metrics.views',
            'metadata.performance.views',
          ]),
          likes: this.buildMetricExpression([
            'metadata.likes',
            'metadata.likeCount',
            'metadata.metrics.likes',
            'metadata.performance.likes',
          ]),
          comments: this.buildMetricExpression([
            'metadata.comments',
            'metadata.commentCount',
            'metadata.metrics.comments',
            'metadata.performance.comments',
          ]),
          contentCompletionRate: this.buildMetricExpression([
            'metadata.completionRate',
            'metadata.metrics.completionRate',
            'metadata.performance.completionRate',
          ]),
          publishedAtValue: {
            $ifNull: [
              '$metadata.publishedAt',
              '$completedAt',
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

  private getIndustryBaseline(industry: string) {
    const normalizedIndustry = industry.trim().toLowerCase()
    const baselines: Record<string, { engagementRate: number, completionRate: number, publishingConsistency: number }> = {
      beauty: { engagementRate: 6.8, completionRate: 42, publishingConsistency: 72 },
      education: { engagementRate: 5.2, completionRate: 38, publishingConsistency: 65 },
      food: { engagementRate: 7.1, completionRate: 44, publishingConsistency: 70 },
      generic: { engagementRate: 4.8, completionRate: 35, publishingConsistency: 60 },
      technology: { engagementRate: 4.5, completionRate: 33, publishingConsistency: 58 },
    }

    return baselines[normalizedIndustry] || baselines['generic']
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

  private escapeCsv(value: string) {
    return `"${value.replace(/"/g, '""')}"`
  }

  private round(value: number) {
    return Number(value.toFixed(2))
  }
}
