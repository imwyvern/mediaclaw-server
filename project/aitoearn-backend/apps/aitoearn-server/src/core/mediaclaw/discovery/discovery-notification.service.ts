import { Injectable, Logger, Optional } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import {
  DiscoveryNotification,
  DiscoveryNotificationStatus,
  NotificationEvent,
  ViralContent,
} from '@yikart/mongodb'
import { Model, Types } from 'mongoose'
import { NotificationService } from '../notification/notification.service'

type NotificationCandidate = Pick<
  ViralContent,
  'industry' | 'platform' | 'videoId' | 'title' | 'viralScore' | 'contentUrl'
>

@Injectable()
export class DiscoveryNotificationService {
  private readonly logger = new Logger(DiscoveryNotificationService.name)

  constructor(
    @InjectModel(DiscoveryNotification.name)
    private readonly discoveryNotificationModel: Model<DiscoveryNotification>,
    @Optional()
    private readonly notificationService?: NotificationService,
  ) {}

  async notifyNewDiscoveries(orgId: string, items: NotificationCandidate[]) {
    if (!items.length) {
      return null
    }

    const orderedItems = [...items].sort((left, right) => {
      if ((right.viralScore || 0) !== (left.viralScore || 0)) {
        return (right.viralScore || 0) - (left.viralScore || 0)
      }

      return (right.videoId || '').localeCompare(left.videoId || '')
    })
    const [firstItem] = orderedItems
    const topItems = orderedItems.slice(0, 3).map(item => ({
      videoId: item.videoId || '',
      title: item.title || '',
      viralScore: this.round(item.viralScore || 0),
      contentUrl: item.contentUrl || '',
    }))
    const title = `${this.platformLabel(firstItem.platform)} ${firstItem.industry || '通用'} 新发现 ${orderedItems.length} 条候选爆款`
    const summary = [
      `本轮扫描命中 ${orderedItems.length} 条待处理爆款候选。`,
      topItems.length > 0
        ? `最高爆款分 ${this.round(topItems[0].viralScore)}。`
        : '',
      topItems.length > 0
        ? `优先关注：${topItems.map(item => item.title || item.videoId).join(' / ')}`
        : '',
    ]
      .filter(Boolean)
      .join(' ')
    const notifiedAt = new Date()

    const created = await this.discoveryNotificationModel.create({
      orgId: new Types.ObjectId(orgId),
      industry: firstItem.industry || '',
      platform: firstItem.platform || '',
      title,
      summary,
      itemCount: orderedItems.length,
      topItems,
      notifiedAt,
      status: DiscoveryNotificationStatus.PENDING,
    })

    const response = {
      id: created._id.toString(),
      orgId,
      industry: firstItem.industry || '',
      platform: firstItem.platform || '',
      title,
      summary,
      itemCount: orderedItems.length,
      topItems,
      notifiedAt,
      status: DiscoveryNotificationStatus.PENDING,
    }

    if (this.notificationService) {
      await this.notificationService.sendNotification(orgId, NotificationEvent.DISCOVERY_VIRAL_ALERT, {
        discoveryNotificationId: response.id,
        ...response,
      }).catch((error) => {
        this.logger.warn(`Discovery notification delivery failed for org ${orgId}: ${error instanceof Error ? error.message : String(error)}`)
      })
    }

    this.logger.log(
      JSON.stringify({
        message: 'Discovery notification queued',
        ...response,
      }),
    )

    return response
  }

  private platformLabel(platform?: string) {
    const normalizedPlatform = (platform || '').trim().toLowerCase()
    const labels: Record<string, string> = {
      douyin: '抖音',
      xhs: '小红书',
      kuaishou: '快手',
      bilibili: 'Bilibili',
    }

    return labels[normalizedPlatform] || normalizedPlatform || '未知平台'
  }

  private round(value: number) {
    return Number(value.toFixed(2))
  }
}
