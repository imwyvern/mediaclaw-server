import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { VideoTask, VideoTaskSchema } from '@yikart/mongodb'
import { BillingModule } from '../billing/billing.module'
import { VideoWorkerQueueModule } from '../worker/video-worker-queue.module'
import { VideoController } from './video.controller'
import { VideoService } from './video.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: VideoTask.name, schema: VideoTaskSchema },
    ]),
    BillingModule,
    VideoWorkerQueueModule,
  ],
  controllers: [VideoController],
  providers: [VideoService],
  exports: [VideoService],
})
export class VideoModule {}
