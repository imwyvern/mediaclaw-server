import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  Brand,
  BrandSchema,
  Pipeline,
  PipelineSchema,
  ProductionBatch,
  ProductionBatchSchema,
  VideoTask,
  VideoTaskSchema,
} from '@yikart/mongodb'
import { BillingModule } from '../billing/billing.module'
import { EmployeeDispatchModule } from '../employee-dispatch/employee-dispatch.module'
import { UsageModule } from '../usage/usage.module'
import { VideoWorkerQueueModule } from '../worker/video-worker-queue.module'
import { VideoController } from './video.controller'
import { VideoService } from './video.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: VideoTask.name, schema: VideoTaskSchema },
      { name: Brand.name, schema: BrandSchema },
      { name: Pipeline.name, schema: PipelineSchema },
      { name: ProductionBatch.name, schema: ProductionBatchSchema },
    ]),
    BillingModule,
    UsageModule,
    EmployeeDispatchModule,
    VideoWorkerQueueModule,
  ],
  controllers: [VideoController],
  providers: [VideoService],
  exports: [VideoService],
})
export class VideoModule {}
