import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  Brand,
  BrandSchema,
  Pipeline,
  PipelineSchema,
  VideoTask,
  VideoTaskSchema,
} from '@yikart/mongodb'
import { BillingModule } from '../billing/billing.module'
import { VideoWorkerQueueModule } from '../worker/video-worker-queue.module'
import { TaskMgmtController } from './task-mgmt.controller'
import { TaskMgmtService } from './task-mgmt.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: VideoTask.name, schema: VideoTaskSchema },
      { name: Brand.name, schema: BrandSchema },
      { name: Pipeline.name, schema: PipelineSchema },
    ]),
    BillingModule,
    VideoWorkerQueueModule,
  ],
  controllers: [TaskMgmtController],
  providers: [TaskMgmtService],
  exports: [TaskMgmtService],
})
export class TaskMgmtModule {}
