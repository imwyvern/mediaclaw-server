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
      byType,
    }
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
    action: () => Promise<Record<string, any>>,
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
}
