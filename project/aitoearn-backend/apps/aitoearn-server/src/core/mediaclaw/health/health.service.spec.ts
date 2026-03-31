import { vi } from 'vitest'
import { describeModuleSpec } from '../testing/module-spec.factory'
import { MediaClawHealthCheckService } from './health-check.service'
import { HealthController } from './health.controller'
import { HealthModule } from './health.module'
import { HealthService } from './health.service'
import { QueueDashboardAuthService } from './queue-dashboard-auth.service'
import { QueueDashboardService } from './queue-dashboard.service'

const { dashboardAuthServiceMock, dashboardServiceMock, healthCheckServiceMock, videoWorkerQueueMock } = vi.hoisted(() => ({
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
      provide: 'BullQueue_mediaclaw_pipeline',
      useValue: videoWorkerQueueMock,
    },
  ],
})
