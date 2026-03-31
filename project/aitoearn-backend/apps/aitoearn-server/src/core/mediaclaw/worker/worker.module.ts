import { Module } from '@nestjs/common'
import { ContentMgmtModule } from '../content-mgmt/content-mgmt.module'
import { CopyModule } from '../copy/copy.module'
import { DistributionModule } from '../distribution/distribution.module'
import { PipelineModule } from '../pipeline/pipeline.module'
import { VideoModule } from '../video/video.module'
import { VideoWorkerQueueModule } from './video-worker-queue.module'
import { VideoWorkerProcessor } from './video-worker.processor'

@Module({
  imports: [
    ContentMgmtModule,
    CopyModule,
    DistributionModule,
    PipelineModule,
    VideoWorkerQueueModule,
    VideoModule,
  ],
  providers: [VideoWorkerProcessor],
})
export class WorkerModule {}
