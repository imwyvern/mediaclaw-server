import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import {
  CopyEmotionalTone,
  CopyHistory,
  CopyPerformance,
  Organization,
  VideoTask,
} from '@yikart/mongodb'
import { Model, Types } from 'mongoose'

interface CopyMetricsInput {
  views?: number
  likes?: number
  comments?: number
  shares?: number
  saves?: number
  ctr?: number
}

interface NormalizedCopyMetrics {
  views: number
  likes: number
  comments: number
  shares: number
  saves: number
  ctr: number
}

interface CopyFeatureSnapshot {
  titleLength: number
  hasBlueWords: boolean
  blueWordCount: number
  hasCommentGuide: boolean
  hashtagCount: number
  emotionalTone: CopyEmotionalTone
}

interface TopPatternSummary {
  titleLengthRange: string
  hasBlueWords: boolean
  emotionalTone: CopyEmotionalTone
  avgPerformanceScore: number
  avgCtr: number
  avgHashtagCount: number
  sampleSize: number
  exampleCopies: Array<{
    id: string
    title: string
    subtitle: string
    hashtags: string[]
    blueWords: string[]
    commentGuide: string
  }>
}

@Injectable()
export class CopyStrategyService {
  constructor(
    @InjectModel(CopyPerformance.name)
    private readonly copyPerformanceModel: Model<CopyPerformance>,
    @InjectModel(CopyHistory.name)
    private readonly copyHistoryModel: Model<CopyHistory>,
    @InjectModel(VideoTask.name)
    private readonly videoTaskModel: Model<VideoTask>,
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<Organization>,
  ) {}

  async recordCopyPerformance(
    copyHistoryId: string,
    videoTaskId: string,
    metricsInput: CopyMetricsInput,
  ) {
    const normalizedCopyHistoryId = this.toObjectIdString(copyHistoryId, 'copyHistoryId')
    const normalizedVideoTaskId = this.toObjectIdString(videoTaskId, 'videoTaskId')

    const [copyHistory, videoTask] = await Promise.all([
      this.copyHistoryModel.findById(new Types.ObjectId(normalizedCopyHistoryId)).exec(),
      this.videoTaskModel.findById(new Types.ObjectId(normalizedVideoTaskId)).exec(),
    ])

    if (!copyHistory) {
      throw new NotFoundException('Copy history not found')
    }

    if (!videoTask) {
      throw new NotFoundException('Video task not found')
    }

    if (
      copyHistory.taskId
      && copyHistory.taskId.toString() !== normalizedVideoTaskId
    ) {
      throw new BadRequestException('copyHistoryId does not match videoTaskId')
    }

    const metrics = this.normalizeMetrics(metricsInput)
    const copyFeatures = this.extractCopyFeatures(copyHistory)
    const performanceScore = this.calculatePerformanceScore(metrics)
    const orgId = copyHistory.orgId.toString()
    const platform = this.resolvePlatform(videoTask)
    const recordedAt = new Date()

    const performanceRecord = await this.copyPerformanceModel.findOneAndUpdate(
      {
        copyHistoryId: normalizedCopyHistoryId,
        videoTaskId: normalizedVideoTaskId,
      },
      {
        $set: {
          copyHistoryId: normalizedCopyHistoryId,
          videoTaskId: normalizedVideoTaskId,
          orgId,
          platform,
          metrics,
          copyFeatures,
          performanceScore,
          recordedAt,
        },
      },
      {
        upsert: true,
        new: true,
      },
    ).lean().exec()

    await this.copyHistoryModel.findByIdAndUpdate(copyHistory._id, {
      $set: {
        performance: {
          views: metrics.views,
          clicks: metrics.likes + metrics.comments + metrics.shares + metrics.saves,
          ctr: metrics.ctr,
        },
      },
    }).exec()

    const strategyHints = await this.updateStrategyFromPerformance(orgId)

    return {
      record: this.serializePerformanceRecord(performanceRecord),
      strategyHints,
    }
  }

  async getTopPerformingPatterns(
    orgId: string,
    platform?: string,
    limit = 5,
  ): Promise<TopPatternSummary[]> {
    const normalizedOrgId = this.toObjectIdString(orgId, 'orgId')
    const normalizedLimit = Math.min(Math.max(Math.trunc(Number(limit) || 5), 1), 20)
    const matchStage: Record<string, unknown> = {
      orgId: normalizedOrgId,
    }

    if (platform?.trim()) {
      matchStage['platform'] = platform.trim()
    }

    const groups = await this.copyPerformanceModel.aggregate([
      { $match: matchStage },
      {
        $addFields: {
          titleLengthRange: this.buildTitleLengthRangeExpression(),
        },
      },
      {
        $group: {
          _id: {
            titleLengthRange: '$titleLengthRange',
            hasBlueWords: '$copyFeatures.hasBlueWords',
            emotionalTone: '$copyFeatures.emotionalTone',
          },
          avgPerformanceScore: { $avg: '$performanceScore' },
          avgCtr: { $avg: '$metrics.ctr' },
          avgHashtagCount: { $avg: '$copyFeatures.hashtagCount' },
          sampleSize: { $sum: 1 },
          sampleCopyHistoryIds: { $push: '$copyHistoryId' },
        },
      },
      {
        $sort: {
          avgPerformanceScore: -1,
          sampleSize: -1,
        },
      },
      { $limit: normalizedLimit },
    ]).exec() as Array<Record<string, any>>

    const sampleIds = [...new Set(
      groups.flatMap(item => (item['sampleCopyHistoryIds'] || []).slice(0, 3)),
    )].filter((value): value is string => typeof value === 'string' && Types.ObjectId.isValid(value))

    const exampleMap = new Map<string, Record<string, any>>()
    if (sampleIds.length > 0) {
      const examples = await this.copyHistoryModel.find({
        _id: {
          $in: sampleIds.map(item => new Types.ObjectId(item)),
        },
      }).lean().exec() as Array<Record<string, any>>

      for (const item of examples) {
        exampleMap.set(item['_id'].toString(), item)
      }
    }

    return groups.map((item) => {
      const groupId = item['_id'] || {}
      const exampleCopies = (item['sampleCopyHistoryIds'] || [])
        .slice(0, 3)
        .map((sampleId: string) => exampleMap.get(sampleId))
        .filter((candidate: Record<string, any> | undefined): candidate is Record<string, any> => Boolean(candidate))
        .map((candidate: Record<string, any>) => ({
          id: candidate['_id'].toString(),
          title: candidate['title'] || '',
          subtitle: candidate['subtitle'] || '',
          hashtags: candidate['hashtags'] || [],
          blueWords: candidate['blueWords'] || [],
          commentGuide: candidate['commentGuide'] || '',
        }))

      return {
        titleLengthRange: groupId['titleLengthRange'] || 'unknown',
        hasBlueWords: Boolean(groupId['hasBlueWords']),
        emotionalTone: (groupId['emotionalTone'] || 'neutral') as CopyEmotionalTone,
        avgPerformanceScore: Number((item['avgPerformanceScore'] || 0).toFixed(2)),
        avgCtr: Number((item['avgCtr'] || 0).toFixed(4)),
        avgHashtagCount: Number((item['avgHashtagCount'] || 0).toFixed(2)),
        sampleSize: Number(item['sampleSize'] || 0),
        exampleCopies,
      }
    })
  }

  async updateStrategyFromPerformance(orgId: string) {
    const normalizedOrgId = this.toObjectIdString(orgId, 'orgId')
    const insights = await this.getCopyInsights(normalizedOrgId, '90d')
    const topPatterns = await this.getTopPerformingPatterns(normalizedOrgId, undefined, 3)

    const bestPattern = topPatterns[0]
    const bestBlueWordGroup = insights['blueWordEffectiveness']
      .find((item: Record<string, unknown>) => item['hasBlueWords'] === true)
    const worstBlueWordGroup = insights['blueWordEffectiveness']
      .find((item: Record<string, unknown>) => item['hasBlueWords'] === false)

    const strategyHints = {
      updatedAt: new Date().toISOString(),
      recommendedTitleLengthRange: bestPattern?.titleLengthRange || null,
      recommendedTones: insights['emotionalToneInsights']
        .slice(0, 2)
        .map((item: Record<string, unknown>) => item['emotionalTone'])
        .filter((item): item is string => typeof item === 'string'),
      optimalHashtagCount: insights['optimalHashtagCount'],
      blueWordPolicy: bestBlueWordGroup && worstBlueWordGroup
        && Number(bestBlueWordGroup['avgPerformanceScore'] || 0) > Number(worstBlueWordGroup['avgPerformanceScore'] || 0)
        ? 'prefer_blue_words'
        : 'use_blue_words_selectively',
      topPatterns,
      note: 'TODO: feed these hints into the copy generation prompt after the loop is validated.',
    }

    const updated = await this.organizationModel.findByIdAndUpdate(
      new Types.ObjectId(normalizedOrgId),
      {
        $set: {
          'settings.copyStrategyHints': strategyHints,
        },
      },
      { new: true },
    ).lean().exec()

    if (!updated) {
      throw new NotFoundException('Organization not found')
    }

    return strategyHints
  }

  async getCopyInsights(orgId: string, period = '30d') {
    const normalizedOrgId = this.toObjectIdString(orgId, 'orgId')
    const { startDate, normalizedPeriod } = this.resolvePeriod(period)
    const matchStage = {
      orgId: normalizedOrgId,
      recordedAt: {
        $gte: startDate,
      },
    }

    const commonStages = [
      { $match: matchStage },
      {
        $addFields: {
          titleLengthRange: this.buildTitleLengthRangeExpression(),
        },
      },
    ]

    const [summary, titlePatterns, hashtagPerformance, blueWordEffectiveness, emotionalToneInsights] = await Promise.all([
      this.copyPerformanceModel.aggregate([
        ...commonStages,
        {
          $group: {
            _id: null,
            totalRecords: { $sum: 1 },
            avgPerformanceScore: { $avg: '$performanceScore' },
            avgViews: { $avg: '$metrics.views' },
            avgCtr: { $avg: '$metrics.ctr' },
          },
        },
      ]).exec() as Promise<Array<Record<string, any>>>,
      this.copyPerformanceModel.aggregate([
        ...commonStages,
        {
          $group: {
            _id: {
              titleLengthRange: '$titleLengthRange',
              emotionalTone: '$copyFeatures.emotionalTone',
            },
            avgPerformanceScore: { $avg: '$performanceScore' },
            count: { $sum: 1 },
          },
        },
        {
          $sort: {
            avgPerformanceScore: -1,
            count: -1,
          },
        },
        { $limit: 5 },
      ]).exec() as Promise<Array<Record<string, any>>>,
      this.copyPerformanceModel.aggregate([
        ...commonStages,
        {
          $group: {
            _id: '$copyFeatures.hashtagCount',
            avgPerformanceScore: { $avg: '$performanceScore' },
            count: { $sum: 1 },
          },
        },
        {
          $sort: {
            avgPerformanceScore: -1,
            count: -1,
          },
        },
      ]).exec() as Promise<Array<Record<string, any>>>,
      this.copyPerformanceModel.aggregate([
        ...commonStages,
        {
          $group: {
            _id: '$copyFeatures.hasBlueWords',
            avgPerformanceScore: { $avg: '$performanceScore' },
            count: { $sum: 1 },
          },
        },
        {
          $sort: {
            _id: -1,
          },
        },
      ]).exec() as Promise<Array<Record<string, any>>>,
      this.copyPerformanceModel.aggregate([
        ...commonStages,
        {
          $group: {
            _id: '$copyFeatures.emotionalTone',
            avgPerformanceScore: { $avg: '$performanceScore' },
            count: { $sum: 1 },
          },
        },
        {
          $sort: {
            avgPerformanceScore: -1,
            count: -1,
          },
        },
      ]).exec() as Promise<Array<Record<string, any>>>,
    ])

    const summaryRow = summary[0] || {}
    const bestHashtagPattern = hashtagPerformance[0]

    return {
      orgId: normalizedOrgId,
      period: normalizedPeriod,
      startDate: startDate.toISOString(),
      totalRecords: Number(summaryRow['totalRecords'] || 0),
      avgPerformanceScore: Number((summaryRow['avgPerformanceScore'] || 0).toFixed(2)),
      avgViews: Number((summaryRow['avgViews'] || 0).toFixed(2)),
      avgCtr: Number((summaryRow['avgCtr'] || 0).toFixed(4)),
      bestPerformingTitlePatterns: titlePatterns.map((item) => ({
        titleLengthRange: item['_id']?.['titleLengthRange'] || 'unknown',
        emotionalTone: item['_id']?.['emotionalTone'] || 'neutral',
        avgPerformanceScore: Number((item['avgPerformanceScore'] || 0).toFixed(2)),
        count: Number(item['count'] || 0),
      })),
      optimalHashtagCount: bestHashtagPattern ? Number(bestHashtagPattern['_id'] || 0) : 0,
      hashtagPerformance: hashtagPerformance.map((item) => ({
        hashtagCount: Number(item['_id'] || 0),
        avgPerformanceScore: Number((item['avgPerformanceScore'] || 0).toFixed(2)),
        count: Number(item['count'] || 0),
      })),
      blueWordEffectiveness: blueWordEffectiveness.map((item) => ({
        hasBlueWords: Boolean(item['_id']),
        avgPerformanceScore: Number((item['avgPerformanceScore'] || 0).toFixed(2)),
        count: Number(item['count'] || 0),
      })),
      emotionalToneInsights: emotionalToneInsights.map((item) => ({
        emotionalTone: item['_id'] || 'neutral',
        avgPerformanceScore: Number((item['avgPerformanceScore'] || 0).toFixed(2)),
        count: Number(item['count'] || 0),
      })),
    }
  }

  private normalizeMetrics(input: CopyMetricsInput): NormalizedCopyMetrics {
    return {
      views: this.normalizeCount(input.views),
      likes: this.normalizeCount(input.likes),
      comments: this.normalizeCount(input.comments),
      shares: this.normalizeCount(input.shares),
      saves: this.normalizeCount(input.saves),
      ctr: this.normalizeRate(input.ctr),
    }
  }

  private extractCopyFeatures(copyHistory: CopyHistory): CopyFeatureSnapshot {
    const title = copyHistory.title?.trim() || ''
    const subtitle = copyHistory.subtitle?.trim() || ''
    const blueWords = (copyHistory.blueWords || []).map(item => item.trim()).filter(Boolean)
    const embeddedBlueWords = title.match(/#[^\s#]+/g) || []
    const uniqueBlueWords = [...new Set([...blueWords, ...embeddedBlueWords])]
    const commentGuide = copyHistory.commentGuide?.trim() || ''

    return {
      titleLength: title.length,
      hasBlueWords: uniqueBlueWords.length > 0,
      blueWordCount: uniqueBlueWords.length,
      hasCommentGuide: Boolean(commentGuide),
      hashtagCount: (copyHistory.hashtags || []).filter(Boolean).length,
      emotionalTone: this.detectEmotionalTone([title, subtitle, commentGuide].filter(Boolean).join('\n')),
    }
  }

  private detectEmotionalTone(text: string): CopyEmotionalTone {
    const normalized = text.trim().toLowerCase()
    if (!normalized) {
      return 'neutral'
    }

    if (/(马上|立刻|赶紧|限时|现在|别错过|速看|即刻)/.test(normalized)) {
      return 'urgent'
    }

    if (/(为什么|怎么|如何|到底|居然|秘密|真相|竟然|\?)/.test(normalized)) {
      return 'curious'
    }

    if (/(太绝了|爆了|惊喜|上头|封神|高能|狠狠|冲一波|必看)/.test(normalized)) {
      return 'exciting'
    }

    return 'neutral'
  }

  private calculatePerformanceScore(metrics: NormalizedCopyMetrics) {
    const safeViews = Math.max(metrics.views, 1)
    const weightedEngagement = metrics.likes + (metrics.comments * 2) + (metrics.shares * 3) + (metrics.saves * 2)
    const engagementRate = weightedEngagement / safeViews
    const viewsScore = Math.min(35, Math.log10(metrics.views + 1) * 10)
    const engagementScore = Math.min(45, engagementRate * 100)
    const ctrScore = Math.min(20, metrics.ctr * 100)

    return Number((viewsScore + engagementScore + ctrScore).toFixed(2))
  }

  private resolvePlatform(task: VideoTask) {
    const metadata = this.toPlainObject(task.metadata)
    const sourceMetadata = this.toPlainObject(task.source?.metadata)

    return this.readString(metadata['platform'])
      || this.readString(sourceMetadata['platform'])
      || 'general'
  }

  private resolvePeriod(period: string) {
    const normalized = period.trim().toLowerCase()
    const matchedDays = normalized.match(/^(\d{1,3})d$/)
    const days = matchedDays
      ? Number(matchedDays[1])
      : normalized === '7d'
        ? 7
        : normalized === '90d'
          ? 90
          : 30

    const startDate = new Date()
    startDate.setDate(startDate.getDate() - Math.max(days, 1))

    return {
      normalizedPeriod: `${Math.max(days, 1)}d`,
      startDate,
    }
  }

  private buildTitleLengthRangeExpression() {
    return {
      $switch: {
        branches: [
          {
            case: { $lte: ['$copyFeatures.titleLength', 12] },
            then: '0-12',
          },
          {
            case: { $lte: ['$copyFeatures.titleLength', 24] },
            then: '13-24',
          },
          {
            case: { $lte: ['$copyFeatures.titleLength', 36] },
            then: '25-36',
          },
        ],
        default: '37+',
      },
    }
  }

  private serializePerformanceRecord(item: Record<string, any> | null) {
    if (!item) {
      return null
    }

    return {
      id: item['_id']?.toString?.() || null,
      copyHistoryId: item['copyHistoryId'],
      videoTaskId: item['videoTaskId'],
      orgId: item['orgId'],
      platform: item['platform'],
      metrics: item['metrics'] || {},
      copyFeatures: item['copyFeatures'] || {},
      performanceScore: Number(item['performanceScore'] || 0),
      recordedAt: item['recordedAt'] || null,
      createdAt: item['createdAt'] || null,
      updatedAt: item['updatedAt'] || null,
    }
  }

  private normalizeCount(value: unknown) {
    const normalized = Number(value || 0)
    if (!Number.isFinite(normalized) || normalized <= 0) {
      return 0
    }

    return Math.trunc(normalized)
  }

  private normalizeRate(value: unknown) {
    const normalized = Number(value || 0)
    if (!Number.isFinite(normalized) || normalized <= 0) {
      return 0
    }

    if (normalized > 1) {
      return Number((normalized / 100).toFixed(4))
    }

    return Number(normalized.toFixed(4))
  }

  private toPlainObject(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {}
    }

    return value as Record<string, unknown>
  }

  private readString(value: unknown) {
    return typeof value === 'string' ? value.trim() : ''
  }

  private toObjectIdString(value: string, field: string) {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`${field} is invalid`)
    }

    return value
  }
}
