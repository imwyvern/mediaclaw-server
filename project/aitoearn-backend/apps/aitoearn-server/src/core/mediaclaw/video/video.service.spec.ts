import { vi } from 'vitest'
import { BillingService } from '../billing/billing.service'
import { describeModuleSpec } from '../testing/module-spec.factory'
import { VideoController } from './video.controller'
import { VideoModule } from './video.module'
import { VideoService } from './video.service'

const { billingServiceMock, videoServiceMock, videoWorkerQueueMock } = vi.hoisted(() => ({
  billingServiceMock: {
    deductCredit: vi.fn().mockResolvedValue(true),
    refundCredit: vi.fn().mockResolvedValue(undefined),
  },
  videoServiceMock: {
    createTask: vi.fn(),
    getTask: vi.fn(),
    getTaskForWorker: vi.fn(),
    listTasks: vi.fn(),
    markPublished: vi.fn(),
    recordRetry: vi.fn(),
    updateStatus: vi.fn(),
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

vi.mock('../billing/billing.module', async () => {
  const { Module } = await import('@nestjs/common')
  class MockBillingModule {}
  Module({
    providers: [{ provide: BillingService, useValue: billingServiceMock }],
    exports: [BillingService],
  })(MockBillingModule)

  return { BillingModule: MockBillingModule }
})

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

describeModuleSpec<VideoService>({
  suiteName: 'VideoModule',
  module: VideoModule,
  service: VideoService,
  controller: VideoController,
  keyMethods: ['createTask', 'listTasks', 'updateStatus'],
  overrides: [
    {
      provide: VideoService,
      useValue: videoServiceMock,
    },
    {
      provide: BillingService,
      useValue: billingServiceMock,
    },
    {
      provide: 'BullQueue_mediaclaw_pipeline',
      useValue: videoWorkerQueueMock,
    },
  ],
})
