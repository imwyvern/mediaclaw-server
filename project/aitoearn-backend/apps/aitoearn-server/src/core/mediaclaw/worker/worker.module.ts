import { Module } from '@nestjs/common'
import { VideoModule } from '../video/video.module'
import { VideoWorkerQueueModule } from './video-worker-queue.module'
import { VideoWorkerProcessor } from './video-worker.processor'

@Module({
  imports: [
    VideoWorkerQueueModule,
    VideoModule,
  ],
  providers: [VideoWorkerProcessor],
})
export class WorkerModule {}
