import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { TerminusModule } from '@nestjs/terminus'
import {
  AuditLog,
  AuditLogSchema,
  BrandAssetVersion,
  BrandAssetVersionSchema,
} from '@yikart/mongodb'
import { ClawHostModule } from '../clawhost/clawhost.module'
import { MediaclawConfigModule } from '../mediaclaw-config.module'
import { VideoWorkerQueueModule } from '../worker/video-worker-queue.module'
import { MediaClawHealthCheckService } from './health-check.service'
import { HealthController } from './health.controller'
import { HealthService } from './health.service'
import { MonitoringAlertService } from './monitoring-alert.service'
import { MonitoringMetricsService } from './monitoring-metrics.service'
import { QueueDashboardAuthService } from './queue-dashboard-auth.service'
import { QueueDashboardService } from './queue-dashboard.service'

@Module({
  imports: [
    TerminusModule,
    ClawHostModule,
    MediaclawConfigModule,
    VideoWorkerQueueModule,
    MongooseModule.forFeature([
      { name: AuditLog.name, schema: AuditLogSchema },
      { name: BrandAssetVersion.name, schema: BrandAssetVersionSchema },
    ]),
  ],
  controllers: [HealthController],
  providers: [
    HealthService,
    MediaClawHealthCheckService,
    MonitoringMetricsService,
    MonitoringAlertService,
    QueueDashboardAuthService,
    QueueDashboardService,
  ],
  exports: [MonitoringMetricsService],
})
export class HealthModule {}
