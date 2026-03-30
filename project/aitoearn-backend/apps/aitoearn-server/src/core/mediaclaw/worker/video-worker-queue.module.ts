import { BullModule } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'
import { VIDEO_WORKER_QUEUE } from './worker.constants'

@Module({
  imports: [
    BullModule.registerQueue({
      name: VIDEO_WORKER_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'fixed',
          delay: 1000,
        },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    }),
  ],
  exports: [BullModule],
})
export class VideoWorkerQueueModule {}
