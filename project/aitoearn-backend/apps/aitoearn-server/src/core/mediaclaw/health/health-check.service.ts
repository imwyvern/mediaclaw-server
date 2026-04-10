import { InjectQueue } from '@nestjs/bullmq'
import { Injectable } from '@nestjs/common'
import { InjectConnection, InjectModel } from '@nestjs/mongoose'
import {
  DiskHealthIndicator,
  HealthCheckError,
  HealthCheckResult,
  HealthCheckService,
  HealthIndicatorResult,
  MemoryHealthIndicator,
} from '@nestjs/terminus'
import { AuditLog, BrandAssetVersion } from '@yikart/mongodb'
import { Queue } from 'bullmq'
import { Connection, Model } from 'mongoose'
import { VIDEO_WORKER_QUEUE, VideoWorkerJobData } from '../worker/worker.constants'
import { HealthService } from './health.service'
import { StorageLifecycleService } from './storage-lifecycle.service'

interface DashboardServiceStatus {
  id: string
  name: string
  status: 'up' | 'down'
  message?: string
  latencyMs?: number
  queueDepth?: number
  meta?: Record<string, unknown>
}

@Injectable()
export class MediaClawHealthCheckService {
  constructor(
    private readonly healthCheckService: HealthCheckService,
    private readonly healthService: HealthService,
    private readonly diskHealthIndicator: DiskHealthIndicator,
    private readonly memoryHealthIndicator: MemoryHealthIndicator,
    @InjectConnection()
    private readonly mongooseConnection: Connection,
    @InjectModel(AuditLog.name)
    private readonly auditLogModel: Model<AuditLog>,
    @InjectModel(BrandAssetVersion.name)
    private readonly brandAssetVersionModel: Model<BrandAssetVersion>,
    @InjectQueue(VIDEO_WORKER_QUEUE)
    private readonly videoWorkerQueue: Queue<VideoWorkerJobData>,
    private readonly storageLifecycleService: StorageLifecycleService,
  ) {}

  async getSystemHealth(): Promise<HealthCheckResult> {
    return this.healthCheckService.check([
      async () => this.runIndicator('mongodb', async () => {
        const startedAt = Date.now()
        const db = this.mongooseConnection.db
        if (!db) {
          throw new Error('MongoDB connection is not ready')
        }
        await db.admin().command({ ping: 1 })
        return {
          latencyMs: Date.now() - startedAt,
        }
      }),
      async () => this.runIndicator('redis', async () => {
        const client = await this.videoWorkerQueue.client
        const startedAt = Date.now()
        const pong = await client.ping()
        return {
          latencyMs: Date.now() - startedAt,
          response: pong,
        }
      }),
      async () => this.runIndicator('bullmq', async () => {
        const counts = await this.videoWorkerQueue.getJobCounts(
          'waiting',
          'active',
          'completed',
          'failed',
          'delayed',
          'prioritized',
        )

        return {
          queueDepth:
            (counts['waiting'] || 0)
            + (counts['active'] || 0)
            + (counts['delayed'] || 0)
            + (counts['prioritized'] || 0),
          queueName: VIDEO_WORKER_QUEUE,
          counts,
        }
      }),
      async () => this.diskHealthIndicator.checkStorage('disk_storage', {
        path: process.cwd(),
        thresholdPercent: 0.9,
      }),
      async () => this.memoryHealthIndicator.checkHeap(
        'memory_heap',
        this.getHeapThreshold(),
      ),
    ])
  }

  async getDashboardStatus() {
    const checkedAt = new Date().toISOString()
    const [services, apiMetrics] = await Promise.all([
      this.collectDashboardServices(),
      this.getApiMetrics(),
    ])

    const healthyServices = services.filter(service => service.status === 'up').length
    const availability = services.length === 0
      ? 100
      : Number(((healthyServices / services.length) * 100).toFixed(1))
    const queueDepth = services.find(service => service.id === 'bullmq')?.queueDepth || 0
    const storageUsage = this.resolveStorageUsagePercent(
      services.find(service => service.id === 'disk_storage'),
    )

    return {
      status: healthyServices === services.length
        ? 'healthy'
        : healthyServices === 0
          ? 'down'
          : 'degraded',
      availability,
      queueDepth,
      storageUsage,
      checkedAt,
      metrics: apiMetrics,
      services: services.map(service => ({
        id: service.id,
        name: service.name,
        status: service.status,
        message: service.message,
        latencyMs: service.latencyMs,
      })),
    }
  }

  async getWorkerStatus() {
    const counts = await this.videoWorkerQueue.getJobCounts(
      'active',
      'waiting',
      'completed',
      'failed',
      'delayed',
      'prioritized',
    )

    return {
      queue: VIDEO_WORKER_QUEUE,
      counts: {
        active: counts['active'] || 0,
        waiting: counts['waiting'] || 0,
        completed: counts['completed'] || 0,
        failed: counts['failed'] || 0,
        delayed: counts['delayed'] || 0,
        prioritized: counts['prioritized'] || 0,
      },
      agents: this.healthService.listAgentHeartbeats(),
    }
  }

  async getStorageUsage() {
    const [summary] = await this.brandAssetVersionModel.aggregate<{
      totalFiles: number
      totalSize: number
      activeFiles: number
    }>([
      {
        $match: {
          deletedAt: null,
        },
      },
      {
        $group: {
          _id: null,
          totalFiles: { $sum: 1 },
          totalSize: { $sum: { $ifNull: ['$fileSize', 0] } },
          activeFiles: {
            $sum: {
              $cond: [{ $eq: ['$isActive', true] }, 1, 0],
            },
          },
        },
      },
    ])

    const byType = await this.brandAssetVersionModel.aggregate<{
      assetType: string
      files: number
      totalSize: number
    }>([
      {
        $match: {
          deletedAt: null,
        },
      },
      {
        $group: {
          _id: '$assetType',
          files: { $sum: 1 },
          totalSize: { $sum: { $ifNull: ['$fileSize', 0] } },
        },
      },
      {
        $project: {
          _id: 0,
          assetType: '$_id',
          files: 1,
          totalSize: 1,
        },
      },
      {
        $sort: {
          files: -1,
          assetType: 1,
        },
      },
    ])

    return {
      totalFiles: summary?.totalFiles || 0,
      totalSize: summary?.totalSize || 0,
      activeFiles: summary?.activeFiles || 0,
      lifecyclePolicy: this.storageLifecycleService.getStatus(),
      byType,
    }
  }

  getStorageLifecyclePolicy() {
    return this.storageLifecycleService.getStatus()
  }

  async getApiMetrics() {
    const [summary] = await this.auditLogModel.aggregate<{
      requestCount: number
      avgResponseTimeMs: number
      last24hRequestCount: number
    }>([
      {
        $group: {
          _id: null,
          requestCount: { $sum: 1 },
          avgResponseTimeMs: {
            $avg: { $ifNull: ['$details.durationMs', 0] },
          },
          last24hRequestCount: {
            $sum: {
              $cond: [
                {
                  $gte: [
                    '$createdAt',
                    new Date(Date.now() - (24 * 60 * 60 * 1000)),
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ])

    const topResources = await this.auditLogModel.aggregate<{
      resource: string
      requestCount: number
      avgResponseTimeMs: number
    }>([
      {
        $group: {
          _id: '$resource',
          requestCount: { $sum: 1 },
          avgResponseTimeMs: {
            $avg: { $ifNull: ['$details.durationMs', 0] },
          },
        },
      },
      {
        $project: {
          _id: 0,
          resource: '$_id',
          requestCount: 1,
          avgResponseTimeMs: {
            $round: ['$avgResponseTimeMs', 2],
          },
        },
      },
      {
        $sort: {
          requestCount: -1,
          resource: 1,
        },
      },
      {
        $limit: 10,
      },
    ])

    return {
      requestCount: summary?.requestCount || 0,
      avgResponseTimeMs: Number((summary?.avgResponseTimeMs || 0).toFixed(2)),
      last24hRequestCount: summary?.last24hRequestCount || 0,
      topResources,
    }
  }

  private async runIndicator(
    name: string,
    action: () => Promise<Record<string, unknown>>,
  ): Promise<HealthIndicatorResult> {
    try {
      return {
        [name]: {
          status: 'up' as const,
          ...(await action()),
        },
      }
    }
    catch (error) {
      throw new HealthCheckError(`${name} check failed`, {
        [name]: {
          status: 'down' as const,
          message: error instanceof Error ? error.message : String(error),
        },
      })
    }
  }

  private getHeapThreshold() {
    const value = Number(process.env['MEDIACLAW_HEAP_HEALTH_LIMIT_MB'] || 768)
    return Math.max(value, 128) * 1024 * 1024
  }

  private async collectDashboardServices(): Promise<DashboardServiceStatus[]> {
    return Promise.all([
      this.runDashboardCheck('mongodb', 'MongoDB', async () => {
        const startedAt = Date.now()
        const db = this.mongooseConnection.db
        if (!db) {
          throw new Error('MongoDB connection is not ready')
        }

        await db.admin().command({ ping: 1 })
        return {
          latencyMs: Date.now() - startedAt,
        }
      }),
      this.runDashboardCheck('redis', 'Redis', async () => {
        const client = await this.videoWorkerQueue.client
        const startedAt = Date.now()
        const pong = await client.ping()

        return {
          latencyMs: Date.now() - startedAt,
          response: pong,
        }
      }),
      this.runDashboardCheck('bullmq', 'BullMQ Queue', async () => {
        const counts = await this.videoWorkerQueue.getJobCounts(
          'waiting',
          'active',
          'completed',
          'failed',
          'delayed',
          'prioritized',
        )

        return {
          queueDepth:
            (counts['waiting'] || 0)
            + (counts['active'] || 0)
            + (counts['delayed'] || 0)
            + (counts['prioritized'] || 0),
          counts,
        }
      }),
      this.runDashboardCheck('disk_storage', 'Disk Storage', async () => {
        const result = await this.diskHealthIndicator.checkStorage('disk_storage', {
          path: process.cwd(),
          thresholdPercent: 0.9,
        })
        return (result['disk_storage'] || {}) as Record<string, unknown>
      }),
      this.runDashboardCheck('memory_heap', 'Memory Heap', async () => {
        const result = await this.memoryHealthIndicator.checkHeap(
          'memory_heap',
          this.getHeapThreshold(),
        )
        return (result['memory_heap'] || {}) as Record<string, unknown>
      }),
    ])
  }

  private async runDashboardCheck(
    id: string,
    name: string,
    action: () => Promise<Record<string, unknown>>,
  ): Promise<DashboardServiceStatus> {
    try {
      const meta = await action()
      return {
        id,
        name,
        status: 'up',
        message: typeof meta['message'] === 'string' ? meta['message'] : undefined,
        latencyMs: typeof meta['latencyMs'] === 'number' ? meta['latencyMs'] : undefined,
        queueDepth: typeof meta['queueDepth'] === 'number' ? meta['queueDepth'] : undefined,
        meta,
      }
    }
    catch (error) {
      return {
        id,
        name,
        status: 'down',
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private resolveStorageUsagePercent(service?: DashboardServiceStatus) {
    if (!service?.meta) {
      return 0
    }

    const usedPercent = Number(service.meta['usedPercent'])
    if (Number.isFinite(usedPercent)) {
      return Number(usedPercent.toFixed(1))
    }

    const size = Number(service.meta['size'])
    const free = Number(service.meta['free'])
    if (Number.isFinite(size) && size > 0 && Number.isFinite(free)) {
      return Number((((size - free) / size) * 100).toFixed(1))
    }

    return 0
  }
}
