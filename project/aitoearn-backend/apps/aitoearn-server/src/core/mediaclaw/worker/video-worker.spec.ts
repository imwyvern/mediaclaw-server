import { vi } from 'vitest'
import { CopyService } from '../copy/copy.service'
import { DistributionService } from '../distribution/distribution.service'
import { describeModuleSpec } from '../testing/module-spec.factory'
import { VideoService } from '../video/video.service'
import { VideoWorkerProcessor } from './video-worker.processor'
import { WorkerModule } from './worker.module'

const { copyServiceMock, distributionServiceMock, videoServiceMock, workerQueueMock } = vi.hoisted(() => ({
  copyServiceMock: {
    generateCopy: vi.fn().mockResolvedValue({}),
  },
  distributionServiceMock: {
    notifyTaskComplete: vi.fn().mockResolvedValue(undefined),
  },
  videoServiceMock: {
    getTask: vi.fn(),
    getTaskForWorker: vi.fn(),
    recordRetry: vi.fn(),
    updateStatus: vi.fn(),
  },
  workerQueueMock: {
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

vi.mock('../copy/copy.module', async () => {
  const { Module } = await import('@nestjs/common')
  class MockCopyModule {}
  Module({
    providers: [{ provide: CopyService, useValue: copyServiceMock }],
    exports: [CopyService],
  })(MockCopyModule)

  return { CopyModule: MockCopyModule }
})

vi.mock('../distribution/distribution.module', async () => {
  const { Module } = await import('@nestjs/common')
  class MockDistributionModule {}
  Module({
    providers: [{ provide: DistributionService, useValue: distributionServiceMock }],
    exports: [DistributionService],
  })(MockDistributionModule)

  return { DistributionModule: MockDistributionModule }
})

vi.mock('../video/video.module', async () => {
  const { Module } = await import('@nestjs/common')
  class MockVideoModule {}
  Module({
    providers: [{ provide: VideoService, useValue: videoServiceMock }],
    exports: [VideoService],
  })(MockVideoModule)

  return { VideoModule: MockVideoModule }
})

vi.mock('./video-worker-queue.module', async () => {
  const { Module } = await import('@nestjs/common')
  const queueToken = 'BullQueue_mediaclaw_video_worker'
  class MockVideoWorkerQueueModule {}
  Module({
    providers: [{ provide: queueToken, useValue: workerQueueMock }],
    exports: [queueToken],
  })(MockVideoWorkerQueueModule)

  return { VideoWorkerQueueModule: MockVideoWorkerQueueModule }
})

describeModuleSpec<VideoWorkerProcessor>({
  suiteName: 'WorkerModule',
  module: WorkerModule,
  service: VideoWorkerProcessor,
  keyMethods: ['process', 'onFailed'],
  overrides: [
    {
      provide: VideoService,
      useValue: videoServiceMock,
    },
    {
      provide: CopyService,
      useValue: copyServiceMock,
    },
    {
      provide: DistributionService,
      useValue: distributionServiceMock,
    },
    {
      provide: 'BullQueue_mediaclaw_video_worker',
      useValue: workerQueueMock,
    },
  ],
})
