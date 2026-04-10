import os from 'node:os'
import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import axios from 'axios'
import { MediaclawConfigService } from '../mediaclaw-config.service'
import { MonitoringMetricsService } from './monitoring-metrics.service'

interface MonitoringAlertItem {
  code: 'http_5xx_rate' | 'video_failure_rate' | 'queue_depth' | 'memory_usage'
  severity: 'warning' | 'critical'
  threshold: string
  currentValue: string
  detail: string
}

@Injectable()
export class MonitoringAlertService {
  private readonly logger = new Logger(MonitoringAlertService.name)

  constructor(
    private readonly metricsService: MonitoringMetricsService,
    private readonly configService: MediaclawConfigService,
  ) {}

  @Cron('*/5 * * * *')
  async checkThresholds() {
    await this.metricsService.captureQueueMetrics()
    const snapshot = this.metricsService.getOperationalSnapshot()
    const memoryUsageRatio = this.resolveMemoryUsageRatio()
    const alerts: MonitoringAlertItem[] = []

    if (snapshot.http.errorRate > 0.05) {
      alerts.push({
        code: 'http_5xx_rate',
        severity: 'critical',
        threshold: '> 5%',
        currentValue: `${(snapshot.http.errorRate * 100).toFixed(2)}%`,
        detail: `5xx=${snapshot.http.serverErrors}, total=${snapshot.http.totalRequests}`,
      })
    }

    if (snapshot.video.failureRate > 0.3) {
      alerts.push({
        code: 'video_failure_rate',
        severity: 'critical',
        threshold: '> 30%',
        currentValue: `${(snapshot.video.failureRate * 100).toFixed(2)}%`,
        detail: `failed=${snapshot.video.failed}, total=${snapshot.video.total}`,
      })
    }

    if (snapshot.queue.depth > 100) {
      alerts.push({
        code: 'queue_depth',
        severity: 'warning',
        threshold: '> 100',
        currentValue: String(snapshot.queue.depth),
        detail: `latency=${snapshot.queue.latency}ms`,
      })
    }

    if (memoryUsageRatio > 0.8) {
      alerts.push({
        code: 'memory_usage',
        severity: 'critical',
        threshold: '> 80%',
        currentValue: `${(memoryUsageRatio * 100).toFixed(2)}%`,
        detail: `rss=${process.memoryUsage().rss}, totalMem=${os.totalmem()}`,
      })
    }

    if (alerts.length > 0) {
      await this.dispatchAlerts(alerts, snapshot.queue.capturedAt)
    }

    return {
      checkedAt: new Date().toISOString(),
      alertCount: alerts.length,
      alerts,
      snapshot: {
        ...snapshot,
        system: {
          memoryUsageRatio,
        },
      },
    }
  }

  private async dispatchAlerts(alerts: MonitoringAlertItem[], capturedAt: string) {
    const targets = this.resolveWebhookTargets()
    if (targets.length === 0) {
      return
    }

    const bodyText = this.buildAlertText(alerts, capturedAt)
    await Promise.all(targets.map(async (target) => {
      try {
        await axios.post(target.url, target.bodyBuilder(bodyText), {
          timeout: 5000,
          headers: {
            'content-type': 'application/json',
          },
        })
      }
      catch (error) {
        this.logger.warn(
          `Monitoring alert delivery failed for ${target.name}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }))
  }

  private resolveWebhookTargets() {
    const feishu = this.configService.getString(
      [
        'MEDIACLAW_MONITOR_FEISHU_WEBHOOK',
        'MEDIACLAW_ALERT_FEISHU_WEBHOOK',
        'MEDIACLAW_FEISHU_ALERT_WEBHOOK',
      ],
      '',
    )
    const dingtalk = this.configService.getString(
      [
        'MEDIACLAW_MONITOR_DINGTALK_WEBHOOK',
        'MEDIACLAW_ALERT_DINGTALK_WEBHOOK',
        'MEDIACLAW_DINGTALK_ALERT_WEBHOOK',
      ],
      '',
    )

    return [
      feishu
        ? {
            name: 'feishu',
            url: feishu,
            bodyBuilder: (text: string) => ({
              msg_type: 'text',
              content: {
                text,
              },
            }),
          }
        : null,
      dingtalk
        ? {
            name: 'dingtalk',
            url: dingtalk,
            bodyBuilder: (text: string) => ({
              msgtype: 'text',
              text: {
                content: text,
              },
            }),
          }
        : null,
    ].filter(Boolean) as Array<{
      name: string
      url: string
      bodyBuilder: (text: string) => Record<string, unknown>
    }>
  }

  private resolveMemoryUsageRatio() {
    const totalMemory = os.totalmem()
    if (!totalMemory) {
      return 0
    }

    return process.memoryUsage().rss / totalMemory
  }

  private buildAlertText(alerts: MonitoringAlertItem[], capturedAt: string) {
    return [
      'MediaClaw 监控阈值告警',
      `检查时间: ${capturedAt || new Date().toISOString()}`,
      ...alerts.map(alert =>
        `[${alert.severity}] ${alert.code} 当前=${alert.currentValue} 阈值=${alert.threshold} 详情=${alert.detail}`),
    ].join('\n')
  }
}
