import { vi } from 'vitest'
import { ClawHostService } from '../clawhost/clawhost.service'
import { describeModuleSpec } from '../testing/module-spec.factory'
import { MediaClawHealthCheckService } from './health-check.service'
import { HealthController } from './health.controller'
import { HealthModule } from './health.module'
import { HealthService } from './health.service'
import { MonitoringAlertService } from './monitoring-alert.service'
import { MonitoringMetricsService } from './monitoring-metrics.service'
import { QueueDashboardAuthService } from './queue-dashboard-auth.service'
import { QueueDashboardService } from './queue-dashboard.service'

const { clawHostServiceMock, dashboardAuthServiceMock, dashboardServiceMock, healthCheckServiceMock, monitoringAlertServiceMock, monitoringMetricsServiceMock, videoWorkerQueueMock } = vi.hoisted(() => ({
  clawHostServiceMock: {
    recordHeartbeat: vi.fn().mockResolvedValue(undefined),
  },
  dashboardAuthServiceMock: {
    authorize: vi.fn(),
  },
  dashboardServiceMock: {
    onApplicationBootstrap: vi.fn(),
  },
  healthCheckServiceMock: {
    getApiMetrics: vi.fn(),
    getStorageUsage: vi.fn(),
    getSystemHealth: vi.fn(),
    getWorkerStatus: vi.fn(),
  },
  monitoringAlertServiceMock: {
    checkThresholds: vi.fn(),
  },
  monitoringMetricsServiceMock: {
    captureQueueMetrics: vi.fn(),
    getOperationalSnapshot: vi.fn(),
    onApplicationBootstrap: vi.fn(),
    recordVideoProductionCompleted: vi.fn(),
    recordVideoProductionFailed: vi.fn(),
  },
  videoWorkerQueueMock: {
    add: vi.fn().mockResolvedValue(undefined),
    client: Promise.resolve({
      ping: vi.fn().mockResolvedValue('PONG'),
    }),
    getJobCounts: vi.fn().mockResolvedValue({
      active: 0,
      completed: 0,
      delayed: 0,
      failed: 0,
      prioritized: 0,
      waiting: 0,
    }),
    getJobs: vi.fn().mockResolvedValue([]),
  },
}))

vi.mock('../worker/video-worker-queue.module', async () => {
  const { Module } = await import('@nestjs/common')
  const queueToken = 'BullQueue_mediaclaw_pipeline'
  class MockVideoWorkerQueueModule {}
  Module({
    providers: [{ provide: queueToken, useValue: videoWorkerQueueMock }],
    exports: [queueToken],
  })(MockVideoWorkerQueueModule)

  return { VideoWorkerQueueModule: MockVideoWorkerQueueModule }
})

vi.mock('../clawhost/clawhost.module', async () => {
  const { Module } = await import('@nestjs/common')

  class MockClawHostModule {}
  Module({
    providers: [{ provide: ClawHostService, useValue: clawHostServiceMock }],
    exports: [ClawHostService],
  })(MockClawHostModule)

  return { ClawHostModule: MockClawHostModule }
})

describeModuleSpec<HealthService>({
  suiteName: 'HealthModule',
  module: HealthModule,
  service: HealthService,
  controller: HealthController,
  keyMethods: ['heartbeat', 'listAgentHeartbeats'],
  overrides: [
    {
      provide: MediaClawHealthCheckService,
      useValue: healthCheckServiceMock,
    },
    {
      provide: QueueDashboardAuthService,
      useValue: dashboardAuthServiceMock,
    },
    {
      provide: QueueDashboardService,
      useValue: dashboardServiceMock,
    },
    {
      provide: MonitoringMetricsService,
      useValue: monitoringMetricsServiceMock,
    },
    {
      provide: MonitoringAlertService,
      useValue: monitoringAlertServiceMock,
    },
    {
      provide: ClawHostService,
      useValue: clawHostServiceMock,
    },
    {
      provide: 'BullQueue_mediaclaw_pipeline',
      useValue: videoWorkerQueueMock,
    },
  ],
})
