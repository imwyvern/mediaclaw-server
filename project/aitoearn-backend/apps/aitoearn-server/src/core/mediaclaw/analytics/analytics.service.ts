import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { VideoTask, VideoTaskStatus } from '@yikart/mongodb'
import { Model, PipelineStage, Types } from 'mongoose'

type TrendPeriod = 'daily' | 'weekly' | 'monthly'

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectModel(VideoTask.name) private readonly videoTaskModel: Model<VideoTask>,
  ) {}

  async getOverview(orgId: string) {
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
      ...this.buildMetricStages(),
      {
        $group: {
          _id: null,
          totalVideos: { $sum: 1 },
          creditsUsed: { $sum: { $ifNull: ['$creditsConsumed', 0] } },
          successCount: {
            $sum: {
              $cond: [{ $eq: ['$status', VideoTaskStatus.COMPLETED] }, 1, 0],
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

  async getVideoStats(taskId: string) {
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
      { $match: { _id: new Types.ObjectId(taskId) } },
      ...this.buildMetricStages(),
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
      ...this.buildMetricStages(),
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
              $cond: [{ $eq: ['$status', VideoTaskStatus.COMPLETED] }, 1, 0],
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
          status: VideoTaskStatus.COMPLETED,
        },
      },
      ...this.buildMetricStages(),
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

  private round(value: number) {
    return Number(value.toFixed(2))
  }
}
