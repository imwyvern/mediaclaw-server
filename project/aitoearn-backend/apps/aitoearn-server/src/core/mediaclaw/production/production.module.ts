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
import { DedupModule } from '../dedup/dedup.module'
import { EmployeeDispatchModule } from '../employee-dispatch/employee-dispatch.module'
import { NotificationModule } from '../notification/notification.module'
import { VideoModule } from '../video/video.module'

import { ProductionOrchestratorService } from './production-orchestrator.service'
import { ProductionController } from './production.controller'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ProductionBatch.name, schema: ProductionBatchSchema },
      { name: VideoTask.name, schema: VideoTaskSchema },
      { name: Pipeline.name, schema: PipelineSchema },
      { name: Brand.name, schema: BrandSchema },
    ]),
    EmployeeDispatchModule,
    NotificationModule,
    DedupModule,
    VideoModule,
  ],
  controllers: [ProductionController],
  providers: [ProductionOrchestratorService],
  exports: [ProductionOrchestratorService],
})
export class ProductionModule {}
