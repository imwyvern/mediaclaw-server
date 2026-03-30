import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  Brand,
  BrandSchema,
  Pipeline,
  PipelineSchema,
  PipelineTemplate,
  PipelineTemplateSchema,
  VideoTask,
  VideoTaskSchema,
} from '@yikart/mongodb'
import { VideoWorkerQueueModule } from '../worker/video-worker-queue.module'
import { PipelineSystemController } from './pipeline-system.controller'
import { PipelineSystemService } from './pipeline-system.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PipelineTemplate.name, schema: PipelineTemplateSchema },
      { name: Pipeline.name, schema: PipelineSchema },
      { name: Brand.name, schema: BrandSchema },
      { name: VideoTask.name, schema: VideoTaskSchema },
    ]),
    VideoWorkerQueueModule,
  ],
  controllers: [PipelineSystemController],
  providers: [PipelineSystemService],
  exports: [PipelineSystemService],
})
export class PipelineSystemModule {}
