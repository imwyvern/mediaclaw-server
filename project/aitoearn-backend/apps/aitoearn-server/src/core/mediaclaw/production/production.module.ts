import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  Pipeline,
  PipelineSchema,
  ProductionBatch,
  ProductionBatchSchema,
  VideoTask,
  VideoTaskSchema,
} from '@yikart/mongodb'
import { VideoModule } from '../video/video.module'

import { ProductionController } from './production.controller'
import { ProductionOrchestratorService } from './production-orchestrator.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ProductionBatch.name, schema: ProductionBatchSchema },
      { name: VideoTask.name, schema: VideoTaskSchema },
      { name: Pipeline.name, schema: PipelineSchema },
    ]),
    VideoModule,
  ],
  controllers: [ProductionController],
  providers: [ProductionOrchestratorService],
  exports: [ProductionOrchestratorService],
})
export class ProductionModule {}
