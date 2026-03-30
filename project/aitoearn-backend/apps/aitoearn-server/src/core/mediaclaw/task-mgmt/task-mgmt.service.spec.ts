import { vi } from 'vitest'
import { BillingService } from '../billing/billing.service'
import { describeModuleSpec } from '../testing/module-spec.factory'
import { TaskMgmtController } from './task-mgmt.controller'
import { TaskMgmtModule } from './task-mgmt.module'
import { TaskMgmtService } from './task-mgmt.service'

const { billingServiceMock, taskMgmtServiceMock, videoWorkerQueueMock } = vi.hoisted(() => ({
  billingServiceMock: {
    deductCredit: vi.fn().mockResolvedValue(true),
    refundCredit: vi.fn().mockResolvedValue(undefined),
  },
  taskMgmtServiceMock: {
    cancelTask: vi.fn(),
    createTask: vi.fn(),
    getTask: vi.fn(),
    getTaskTimeline: vi.fn(),
    listTasks: vi.fn(),
    retryTask: vi.fn(),
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
  const queueToken = 'BullQueue_mediaclaw_video_worker'
  class MockVideoWorkerQueueModule {}
  Module({
    providers: [{ provide: queueToken, useValue: videoWorkerQueueMock }],
    exports: [queueToken],
  })(MockVideoWorkerQueueModule)

  return { VideoWorkerQueueModule: MockVideoWorkerQueueModule }
})

describeModuleSpec<TaskMgmtService>({
  suiteName: 'TaskMgmtModule',
  module: TaskMgmtModule,
  service: TaskMgmtService,
  controller: TaskMgmtController,
  keyMethods: ['createTask', 'listTasks', 'getTaskTimeline'],
  overrides: [
    {
      provide: TaskMgmtService,
      useValue: taskMgmtServiceMock,
    },
    {
      provide: BillingService,
      useValue: billingServiceMock,
    },
    {
      provide: 'BullQueue_mediaclaw_video_worker',
      useValue: videoWorkerQueueMock,
    },
  ],
})
