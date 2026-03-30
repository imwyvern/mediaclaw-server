import { Module } from '@nestjs/common'
import { CopyModule } from '../copy/copy.module'
import { DistributionModule } from '../distribution/distribution.module'
import { VideoModule } from '../video/video.module'
import { VideoWorkerQueueModule } from './video-worker-queue.module'
import { VideoWorkerProcessor } from './video-worker.processor'

@Module({
  imports: [
    CopyModule,
    DistributionModule,
    VideoWorkerQueueModule,
    VideoModule,
  ],
  providers: [VideoWorkerProcessor],
})
export class WorkerModule {}
