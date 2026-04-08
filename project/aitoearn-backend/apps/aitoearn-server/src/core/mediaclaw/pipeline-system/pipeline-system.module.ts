import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  Pipeline,
  PipelineSchema,
  PipelineTemplate,
  PipelineTemplateSchema,
  VideoTask,
  VideoTaskSchema,
} from '@yikart/mongodb'
import { PipelineModule } from '../pipeline/pipeline.module'
import { VideoWorkerQueueModule } from '../worker/video-worker-queue.module'
import { PipelineSystemController } from './pipeline-system.controller'
import { PipelineSystemService } from './pipeline-system.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PipelineTemplate.name, schema: PipelineTemplateSchema },
      { name: Pipeline.name, schema: PipelineSchema },
      { name: VideoTask.name, schema: VideoTaskSchema },
    ]),
    PipelineModule,
    VideoWorkerQueueModule,
  ],
  controllers: [PipelineSystemController],
  providers: [PipelineSystemService],
  exports: [PipelineSystemService],
})
export class PipelineSystemModule {}
