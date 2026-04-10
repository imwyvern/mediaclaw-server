import type { NextFunction, Request, Response } from 'express'
import { InjectQueue } from '@nestjs/bullmq'
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { Cron } from '@nestjs/schedule'
import { Job, Queue } from 'bullmq'
import client, { Counter, Gauge, Histogram } from 'prom-client'
import { VIDEO_WORKER_QUEUE, VideoWorkerJobData } from '../worker/worker.constants'

interface QueueSnapshot {
  depth: number
  latency: number
  capturedAt: string
}

interface MonitoringSnapshot {
  http: {
    totalRequests: number
    serverErrors: number
    errorRate: number
  }
  video: {
    total: number
    failed: number
    failureRate: number
  }
  queue: QueueSnapshot
}

@Injectable()
export class MonitoringMetricsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MonitoringMetricsService.name)
  private middlewareMounted = false
  private readonly requestStats = {
    total: 0,
    serverErrors: 0,
  }

  private readonly videoStats = {
    total: 0,
    failed: 0,
  }

  private lastQueueSnapshot: QueueSnapshot = {
    depth: 0,
    latency: 0,
    capturedAt: new Date(0).toISOString(),
  }

  private readonly httpRequestsTotal = this.getOrCreateCounter(
    'http_requests_total',
    'Total number of HTTP requests handled by MediaClaw API',
    ['method', 'route', 'status_class'],
  )

  private readonly httpRequestDuration = this.getOrCreateHistogram(
    'http_request_duration',
    'HTTP request duration in milliseconds',
    ['method', 'route', 'status_class'],
  )

  private readonly videoProductionTotal = this.getOrCreateCounter(
    'video_production_total',
    'Total number of video production terminal outcomes',
    ['status'],
  )

  private readonly videoProductionErrors = this.getOrCreateCounter(
    'video_production_errors',
    'Total number of video production errors by step',
    ['step'],
  )

  private readonly queueDepth = this.getOrCreateGauge(
    'queue_depth',
    'Current BullMQ queue depth',
    ['queue'],
  )

  private readonly queueLatency = this.getOrCreateGauge(
    'queue_latency',
    'Current BullMQ queue latency in milliseconds',
    ['queue'],
  )

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    @InjectQueue(VIDEO_WORKER_QUEUE)
    private readonly videoWorkerQueue: Queue<VideoWorkerJobData>,
  ) {}

  onApplicationBootstrap() {
    if (this.middlewareMounted) {
      return
    }

    const httpAdapter = this.httpAdapterHost.httpAdapter
    const app = httpAdapter?.getInstance?.()
    if (!app?.use) {
      return
    }

    app.use((request: Request, response: Response, next: NextFunction) => {
      if (request.path === '/metrics') {
        next()
        return
      }

      const startedAt = process.hrtime.bigint()
      response.on('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000
        this.recordHttpRequest(
          request.method,
          this.normalizeRoute(request),
          response.statusCode,
          durationMs,
        )
      })

      next()
    })

    this.middlewareMounted = true
    this.logger.log('MediaClaw monitoring metrics middleware mounted')
  }

  recordVideoProductionCompleted() {
    this.videoStats.total += 1
    this.videoProductionTotal.labels('completed').inc()
  }

  recordVideoProductionFailed(step?: string | null) {
    this.videoStats.total += 1
    this.videoStats.failed += 1
    this.videoProductionTotal.labels('failed').inc()
    this.videoProductionErrors.labels(step?.trim() || 'unknown').inc()
  }

  @Cron('* * * * *')
  async captureQueueMetrics() {
    const counts = await this.videoWorkerQueue.getJobCounts(
      'waiting',
      'active',
      'delayed',
      'prioritized',
    )

    const depth
      = (counts['waiting'] || 0)
        + (counts['active'] || 0)
        + (counts['delayed'] || 0)
        + (counts['prioritized'] || 0)

    const jobs = await this.videoWorkerQueue.getJobs(
      ['waiting', 'delayed', 'prioritized'],
      0,
      99,
      true,
    )
    const oldestTimestamp = jobs.reduce((current, job) => {
      const timestamp = this.resolveQueueTimestamp(job)
      if (!timestamp) {
        return current
      }

      return current === 0 ? timestamp : Math.min(current, timestamp)
    }, 0)
    const latency = oldestTimestamp > 0 ? Math.max(0, Date.now() - oldestTimestamp) : 0

    this.queueDepth.labels(VIDEO_WORKER_QUEUE).set(depth)
    this.queueLatency.labels(VIDEO_WORKER_QUEUE).set(latency)
    this.lastQueueSnapshot = {
      depth,
      latency,
      capturedAt: new Date().toISOString(),
    }

    return this.lastQueueSnapshot
  }

  getOperationalSnapshot(): MonitoringSnapshot {
    const errorRate = this.requestStats.total > 0
      ? this.requestStats.serverErrors / this.requestStats.total
      : 0
    const failureRate = this.videoStats.total > 0
      ? this.videoStats.failed / this.videoStats.total
      : 0

    return {
      http: {
        totalRequests: this.requestStats.total,
        serverErrors: this.requestStats.serverErrors,
        errorRate,
      },
      video: {
        total: this.videoStats.total,
        failed: this.videoStats.failed,
        failureRate,
      },
      queue: this.lastQueueSnapshot,
    }
  }

  async renderPrometheusMetrics() {
    return client.register.metrics()
  }

  private recordHttpRequest(
    method: string,
    route: string,
    statusCode: number,
    durationMs: number,
  ) {
    const statusClass = this.toStatusClass(statusCode)
    this.requestStats.total += 1
    if (statusCode >= 500) {
      this.requestStats.serverErrors += 1
    }

    this.httpRequestsTotal.labels(method, route, statusClass).inc()
    this.httpRequestDuration.labels(method, route, statusClass).observe(durationMs)
  }

  private normalizeRoute(request: Request) {
    const basePath = request.baseUrl || ''
    const path = request.path || request.route?.path || request.originalUrl || '/'
    const rawRoute = `${basePath}${path}` || '/'
    const withoutQuery = rawRoute.split('?')[0] || '/'
    return withoutQuery.replace(/\/+/g, '/') || '/'
  }

  private resolveQueueTimestamp(job: Job<VideoWorkerJobData>) {
    return typeof job.timestamp === 'number' ? job.timestamp : 0
  }

  private toStatusClass(statusCode: number) {
    if (!Number.isFinite(statusCode) || statusCode <= 0) {
      return 'unknown'
    }

    return `${Math.floor(statusCode / 100)}xx`
  }

  private getOrCreateCounter(
    name: string,
    help: string,
    labelNames: string[],
  ) {
    const existing = client.register.getSingleMetric(name)
    if (existing) {
      return existing as Counter<string>
    }

    return new Counter({
      name,
      help,
      labelNames,
    })
  }

  private getOrCreateGauge(
    name: string,
    help: string,
    labelNames: string[],
  ) {
    const existing = client.register.getSingleMetric(name)
    if (existing) {
      return existing as Gauge<string>
    }

    return new Gauge({
      name,
      help,
      labelNames,
    })
  }

  private getOrCreateHistogram(
    name: string,
    help: string,
    labelNames: string[],
  ) {
    const existing = client.register.getSingleMetric(name)
    if (existing) {
      return existing as Histogram<string>
    }

    return new Histogram({
      name,
      help,
      labelNames,
      buckets: [25, 50, 100, 250, 500, 1000, 3000, 5000],
    })
  }
}
