import { Cron, CronExpression } from '@nestjs/schedule'
import { InjectModel } from '@nestjs/mongoose'
import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { Model, Types } from 'mongoose'
import { VideoTask, ViralContent, ViralContentRemixStatus } from '@yikart/mongodb'

interface ViralMetricsInput {
  views?: number
  likes?: number
  comments?: number
  shares?: number
}

@Injectable()
export class DiscoveryService {
  private readonly logger = new Logger(DiscoveryService.name)

  constructor(
    @InjectModel(ViralContent.name)
    private readonly viralContentModel: Model<ViralContent>,
    @InjectModel(VideoTask.name)
    private readonly videoTaskModel: Model<VideoTask>,
  ) {}

  calculateViralScore(metrics: ViralMetricsInput) {
    const views = this.normalizeMetric(metrics.views)
    const likes = this.normalizeMetric(metrics.likes)
    const comments = this.normalizeMetric(metrics.comments)
    const shares = this.normalizeMetric(metrics.shares)
    const weightedScore = (views * 0.3) + (likes * 0.25) + (comments * 0.25) + (shares * 0.2)

    return this.round(Math.min(100, Math.log10(weightedScore + 1) * 20))
  }

  async filterP90(industry: string) {
    const query = industry?.trim() ? { industry: industry.trim() } : {}
    const candidates = await this.viralContentModel.find(query)
      .sort({ viralScore: -1, discoveredAt: -1 })
      .lean()
      .exec()

    if (candidates.length === 0) {
      return []
    }

    const count = Math.max(1, Math.ceil(candidates.length * 0.1))
    return candidates.slice(0, count)
  }

  async getRecommendationPool(orgId: string, limit = 10, industry?: string) {
    const normalizedLimit = Math.min(Math.max(Math.trunc(Number(limit) || 10), 1), 50)
    const p90Candidates = await this.filterP90(industry || '')
    const orgTaskIds = await this.getOrgTaskIds(orgId)
    const excludedTaskIds = new Set(orgTaskIds)

    const pool = p90Candidates
      .filter(item => {
        if (item.remixStatus !== ViralContentRemixStatus.PENDING) {
          return false
        }

        if (!item.remixTaskId) {
          return true
        }

        return !excludedTaskIds.has(item.remixTaskId.toString())
      })
      .slice(0, normalizedLimit)
      .map(item => ({
        contentId: item._id.toString(),
        platform: item.platform,
        videoId: item.videoId,
        title: item.title,
        author: item.author,
        viralScore: item.viralScore,
        industry: item.industry,
        keywords: item.keywords,
        contentUrl: item.contentUrl,
        thumbnailUrl: item.thumbnailUrl,
        discoveredAt: item.discoveredAt,
      }))

    return {
      orgId,
      total: pool.length,
      source: pool.length > 0 ? 'p90' : 'empty',
      items: pool,
    }
  }

  async markRemixed(contentId: string, taskId: string) {
    if (!Types.ObjectId.isValid(contentId)) {
      throw new NotFoundException('Viral content not found')
    }

    const update: Record<string, any> = {
      remixStatus: ViralContentRemixStatus.REMIXED,
      remixTaskId: Types.ObjectId.isValid(taskId) ? new Types.ObjectId(taskId) : null,
    }

    const content = await this.viralContentModel.findByIdAndUpdate(
      contentId,
      { $set: update },
      { new: true },
    ).exec()

    if (!content) {
      throw new NotFoundException('Viral content not found')
    }

    return content
  }

  @Cron(CronExpression.EVERY_6_HOURS)
  async scheduledDiscoveryScan() {
    this.logger.debug('Discovery scan cron is stubbed for Sprint 4 and ready for future worker wiring.')
  }

  private async getOrgTaskIds(orgId: string) {
    const match = this.buildOrgMatch(orgId)
    const tasks = await this.videoTaskModel.find(match, { _id: 1 }).lean().exec()
    return tasks.map(task => task._id.toString())
  }

  private buildOrgMatch(orgId: string) {
    const clauses: Record<string, any>[] = [{ userId: orgId }]
    if (Types.ObjectId.isValid(orgId)) {
      clauses.unshift({ orgId: new Types.ObjectId(orgId) })
    }

    return clauses.length === 1 ? clauses[0] : { $or: clauses }
  }

  private normalizeMetric(value?: number) {
    if (!Number.isFinite(value)) {
      return 0
    }

    return Math.max(0, Number(value))
  }

  private round(value: number) {
    return Number(value.toFixed(2))
  }
}
