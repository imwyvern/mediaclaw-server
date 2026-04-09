import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import {
  NotificationEvent,
  PlatformAccount,
  PublishRecord,
  VideoTask,
} from '@yikart/mongodb'
import { Model, Types } from 'mongoose'

import { NotificationService } from '../notification/notification.service'

type PlatformAccountRecord = Record<string, any>
type VideoTaskRecord = Record<string, any>
type PublishRecordDocument = Record<string, any>

interface AccountHealthSnapshot {
  healthScore: number
  status: 'healthy' | 'warning' | 'risk'
  postFrequency: {
    postsLast7Days: number
    postsLast30Days: number
    postsLast90Days: number
    avgPostsPerWeek: number
    avgGapDays: number
  }
  engagementRate: {
    current7Days: number
    previous7Days: number
    current30Days: number
    deltaPct: number
  }
  lowPlayRatio: {
    ratio: number
    lowPlayCount: number
    totalSamples: number
    thresholdViews: number
  }
  anomalies: Array<{
    type: string
    severity: 'warning' | 'critical'
    message: string
    currentValue: number
    threshold: number
    detectedAt: Date
  }>
  lastCheckedAt: Date
  lastAlertedAt: Date | null
  lastPublishedAt: Date | null
}

interface AccountVideoMetric {
  publishedAt: Date
  views: number
  engagementRate: number
}

@Injectable()
export class HealthMonitorService {
  private readonly lookbackDays = 90
  private readonly alertCooldownMs = 24 * 60 * 60 * 1000
  private readonly fallbackLowPlayThreshold = 500

  constructor(
    @InjectModel(PlatformAccount.name)
    private readonly platformAccountModel: Model<PlatformAccount>,
    @InjectModel(PublishRecord.name)
    private readonly publishRecordModel: Model<PublishRecord>,
    @InjectModel(VideoTask.name)
    private readonly videoTaskModel: Model<VideoTask>,
    private readonly notificationService: NotificationService,
  ) {}

  async getAccountHealth(orgId: string, id: string) {
    const account = await this.findAccount(orgId, id)
    const [videoMetrics, publishRecords] = await Promise.all([
      this.findVideoMetrics(account),
      this.findPublishRecords(account),
    ])

    const snapshot = this.buildSnapshot(account, videoMetrics, publishRecords)
    const previousSnapshot = this.asRecord(account['healthSnapshot'])
    const shouldAlert = this.shouldAlert(previousSnapshot, snapshot)
    const persistedSnapshot = {
      ...snapshot,
      lastAlertedAt: shouldAlert ? snapshot.lastCheckedAt : this.toDate(previousSnapshot['lastAlertedAt']),
    }

    await this.platformAccountModel.findByIdAndUpdate(account['_id'], {
      $set: {
        'healthSnapshot': persistedSnapshot,
        'metrics.totalViews': this.computeTotalViews(videoMetrics),
        'metrics.avgEngagement': snapshot.engagementRate.current30Days,
        'lastSyncedAt': snapshot.lastCheckedAt,
      },
    }).exec()

    if (shouldAlert && persistedSnapshot.anomalies.length > 0) {
      await this.notificationService.send(
        account['orgId']?.toString?.() || orgId,
        NotificationEvent.TASK_FAILED,
        {
          type: 'platform_account_health_alert',
          platformAccountId: account['_id']?.toString?.() || '',
          accountId: account['accountId'] || '',
          accountName: account['accountName'] || '',
          platform: account['platform'] || '',
          healthScore: persistedSnapshot.healthScore,
          anomalies: persistedSnapshot.anomalies.map(item => ({
            type: item.type,
            severity: item.severity,
            message: item.message,
            currentValue: item.currentValue,
            threshold: item.threshold,
          })),
        },
      )
    }

    return {
      account: {
        id: account['_id']?.toString?.() || '',
        platform: account['platform'] || '',
        accountId: account['accountId'] || '',
        accountName: account['accountName'] || '',
      },
      ...persistedSnapshot,
    }
  }

  private async findAccount(orgId: string, id: string) {
    const query = Types.ObjectId.isValid(id)
      ? {
          _id: new Types.ObjectId(id),
          ...this.buildOrgMatch(orgId),
        }
      : {
          accountId: id,
          ...this.buildOrgMatch(orgId),
        }
    const account = await this.platformAccountModel.findOne(query).lean().exec() as PlatformAccountRecord | null
    if (!account) {
      throw new NotFoundException('Platform account not found')
    }

    return account
  }

  private async findVideoMetrics(account: PlatformAccountRecord) {
    const since = this.daysAgo(this.lookbackDays)
    const accountObjectId = account['_id']?.toString?.() || ''
    const accountId = String(account['accountId'] || '')
    const orgId = account['orgId']?.toString?.() || String(account['orgId'] || '')
    const tasks = await this.videoTaskModel.find({
      ...this.buildOrgMatch(orgId),
      publishedAt: { $gte: since, $ne: null },
      $or: [
        { 'metadata.distribution.platformAccountId': accountObjectId },
        { 'metadata.distribution.employeeDispatch.platformAccountId': accountObjectId },
        { 'metadata.platformAccountId': accountObjectId },
        { 'metadata.accountId': accountId },
      ],
    })
      .sort({ publishedAt: -1, updatedAt: -1 })
      .lean()
      .exec() as VideoTaskRecord[]

    return tasks
      .map(task => this.toAccountVideoMetric(task))
      .filter((item): item is AccountVideoMetric => item !== null)
  }

  private async findPublishRecords(account: PlatformAccountRecord) {
    return this.publishRecordModel.find({
      accountId: account['accountId'],
      publishTime: { $gte: this.daysAgo(this.lookbackDays) },
    })
      .sort({ publishTime: -1, createdAt: -1 })
      .lean()
      .exec() as Promise<PublishRecordDocument[]>
  }

  private buildSnapshot(
    account: PlatformAccountRecord,
    videoMetrics: AccountVideoMetric[],
    publishRecords: PublishRecordDocument[],
  ): AccountHealthSnapshot {
    const now = new Date()
    const publishDates = this.resolvePublishDates(videoMetrics, publishRecords)
    const metrics7 = videoMetrics.filter(item => this.isWithinDays(item.publishedAt, 7, now))
    const metrics8to14 = videoMetrics.filter((item) => {
      const days = this.diffDays(item.publishedAt, now)
      return days >= 8 && days <= 14
    })
    const metrics30 = videoMetrics.filter(item => this.isWithinDays(item.publishedAt, 30, now))
    const postsLast7Days = publishDates.filter(date => this.isWithinDays(date, 7, now)).length
    const postsLast30Days = publishDates.filter(date => this.isWithinDays(date, 30, now)).length
    const postsLast90Days = publishDates.filter(date => this.isWithinDays(date, 90, now)).length
    const current7Days = this.average(metrics7.map(item => item.engagementRate))
    const previous7Days = this.average(metrics8to14.map(item => item.engagementRate))
    const current30Days = this.average(metrics30.map(item => item.engagementRate))
    const deltaPct = previous7Days > 0
      ? this.round(((current7Days - previous7Days) / previous7Days) * 100)
      : current7Days > 0
        ? 100
        : 0
    const thresholdViews = this.calculateLowPlayThreshold(metrics30)
    const lowPlayCount = metrics30.filter(item => item.views > 0 && item.views < thresholdViews).length
    const lowPlayRatio = metrics30.length > 0
      ? this.round(lowPlayCount / metrics30.length)
      : 0
    const anomalies = this.detectAnomalies({
      current7Days,
      previous7Days,
      lowPlayRatio,
      postsLast7Days,
      thresholdViews,
      now,
    })
    const healthScore = this.calculateHealthScore({
      postsLast7Days,
      postsLast30Days,
      current30Days,
      lowPlayRatio,
      anomalies,
    })
    const status = anomalies.some(item => item.severity === 'critical')
      ? 'risk'
      : healthScore >= 80
        ? 'healthy'
        : healthScore >= 60
          ? 'warning'
          : 'risk'
    const lastPublishedAt = publishDates[0] || null

    return {
      healthScore,
      status,
      postFrequency: {
        postsLast7Days,
        postsLast30Days,
        postsLast90Days,
        avgPostsPerWeek: this.round((postsLast30Days / 30) * 7),
        avgGapDays: this.calculateAverageGapDays(publishDates),
      },
      engagementRate: {
        current7Days,
        previous7Days,
        current30Days,
        deltaPct,
      },
      lowPlayRatio: {
        ratio: lowPlayRatio,
        lowPlayCount,
        totalSamples: metrics30.length,
        thresholdViews,
      },
      anomalies,
      lastCheckedAt: now,
      lastAlertedAt: null,
      lastPublishedAt,
    }
  }

  private resolvePublishDates(videoMetrics: AccountVideoMetric[], publishRecords: PublishRecordDocument[]) {
    const dates = videoMetrics.length > 0
      ? videoMetrics.map(item => item.publishedAt)
      : publishRecords
          .map(record => this.toDate(record['publishTime']))
          .filter((item): item is Date => item !== null)

    return dates.sort((left, right) => right.getTime() - left.getTime())
  }

  private toAccountVideoMetric(task: VideoTaskRecord): AccountVideoMetric | null {
    const publishedAt = this.toDate(
      task['publishedAt']
      || task['metadata']?.['publishedAt']
      || task['metadata']?.['publishInfo']?.['publishedAt'],
    )
    if (!publishedAt) {
      return null
    }

    const analyticsSnapshot = this.asRecord(task['analyticsSnapshot'])
    const analyticsMetadata = this.asRecord(task['metadata']?.['analyticsSnapshot'] || task['metadata']?.['analytics'])
    const metrics = this.asRecord(analyticsMetadata['metrics'])
    const views = this.toMetric(
      analyticsSnapshot['views']
      ?? metrics['views']
      ?? task['metadata']?.['views'],
    )
    const engagementRate = this.toRate(
      analyticsSnapshot['engagementRate']
      ?? analyticsMetadata['engagementRate']
      ?? task['metadata']?.['engagementRate'],
    )

    return {
      publishedAt,
      views,
      engagementRate,
    }
  }

  private detectAnomalies(input: {
    current7Days: number
    previous7Days: number
    lowPlayRatio: number
    postsLast7Days: number
    thresholdViews: number
    now: Date
  }) {
    const anomalies: AccountHealthSnapshot['anomalies'] = []

    if (input.previous7Days > 0 && input.current7Days <= input.previous7Days * 0.5) {
      anomalies.push({
        type: 'engagement_drop',
        severity: 'critical',
        message: '近 7 天互动率较前一周期下滑超过 50%',
        currentValue: input.current7Days,
        threshold: this.round(input.previous7Days * 0.5),
        detectedAt: input.now,
      })
    }

    if (input.lowPlayRatio > 0.3) {
      anomalies.push({
        type: 'high_low_play_ratio',
        severity: input.lowPlayRatio > 0.5 ? 'critical' : 'warning',
        message: '近 30 天低播放占比超过 30%',
        currentValue: this.round(input.lowPlayRatio * 100),
        threshold: 30,
        detectedAt: input.now,
      })
    }

    if (input.postsLast7Days === 0) {
      anomalies.push({
        type: 'posting_stalled',
        severity: 'warning',
        message: '近 7 天没有新增发布内容',
        currentValue: 0,
        threshold: 1,
        detectedAt: input.now,
      })
    }

    return anomalies
  }

  private calculateHealthScore(input: {
    postsLast7Days: number
    postsLast30Days: number
    current30Days: number
    lowPlayRatio: number
    anomalies: AccountHealthSnapshot['anomalies']
  }) {
    let score = 100

    if (input.postsLast7Days === 0) {
      score -= 20
    }
    else if (input.postsLast7Days < 2) {
      score -= 10
    }

    if (input.postsLast30Days < 4) {
      score -= 10
    }

    if (input.current30Days < 3) {
      score -= 10
    }

    score -= Math.min(35, Math.round(input.lowPlayRatio * 100 * 0.6))
    score -= input.anomalies.filter(item => item.severity === 'critical').length * 15
    score -= input.anomalies.filter(item => item.severity === 'warning').length * 5

    return Math.max(0, Math.min(100, score))
  }

  private shouldAlert(previousSnapshot: Record<string, any>, nextSnapshot: AccountHealthSnapshot) {
    if (nextSnapshot.anomalies.length === 0) {
      return false
    }

    const previousAlertedAt = this.toDate(previousSnapshot['lastAlertedAt'])
    const previousSignature = this.anomalySignature(this.asArray(previousSnapshot['anomalies']))
    const nextSignature = this.anomalySignature(nextSnapshot.anomalies)

    if (!previousAlertedAt) {
      return true
    }

    if (previousSignature !== nextSignature) {
      return true
    }

    return nextSnapshot.lastCheckedAt.getTime() - previousAlertedAt.getTime() >= this.alertCooldownMs
  }

  private anomalySignature(items: Array<Record<string, any>>) {
    return items
      .map(item => `${String(item['type'] || '')}:${String(item['severity'] || '')}`)
      .sort()
      .join('|')
  }

  private calculateLowPlayThreshold(metrics: AccountVideoMetric[]) {
    if (metrics.length === 0) {
      return this.fallbackLowPlayThreshold
    }

    const averageViews = this.average(metrics.map(item => item.views))
    return Math.max(this.fallbackLowPlayThreshold, Math.round(averageViews * 0.3))
  }

  private calculateAverageGapDays(dates: Date[]) {
    if (dates.length < 2) {
      return 0
    }

    let totalGap = 0
    for (let index = 1; index < dates.length; index += 1) {
      totalGap += this.diffDays(dates[index], dates[index - 1])
    }

    return this.round(totalGap / (dates.length - 1))
  }

  private computeTotalViews(metrics: AccountVideoMetric[]) {
    return metrics.reduce((sum, item) => sum + item.views, 0)
  }

  private average(values: number[]) {
    if (values.length === 0) {
      return 0
    }

    return this.round(values.reduce((sum, value) => sum + value, 0) / values.length)
  }

  private isWithinDays(date: Date, days: number, now: Date) {
    return this.diffDays(date, now) <= days
  }

  private diffDays(start: Date, end: Date) {
    const delta = end.getTime() - start.getTime()
    return Math.max(0, Math.floor(delta / (24 * 60 * 60 * 1000)))
  }

  private daysAgo(days: number) {
    const value = new Date()
    value.setDate(value.getDate() - days)
    return value
  }

  private toMetric(value: unknown) {
    const normalized = Number(value || 0)
    return Number.isFinite(normalized) ? Math.max(0, Math.round(normalized)) : 0
  }

  private toRate(value: unknown) {
    const normalized = Number(value || 0)
    return Number.isFinite(normalized) ? this.round(Math.max(0, normalized)) : 0
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

  private round(value: number) {
    return Number(value.toFixed(2))
  }

  private buildOrgMatch(orgId: string) {
    const clauses: Record<string, unknown>[] = [{ orgId }]
    if (Types.ObjectId.isValid(orgId)) {
      clauses.unshift({ orgId: new Types.ObjectId(orgId) })
    }

    return clauses.length === 1 ? clauses[0] : { $or: clauses }
  }

  private asRecord(value: unknown) {
    return value && typeof value === 'object' ? value as Record<string, any> : {}
  }

  private asArray(value: unknown) {
    return Array.isArray(value)
      ? value.filter(item => item && typeof item === 'object') as Array<Record<string, any>>
      : []
  }
}
