import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { Pipeline, PipelineSchema } from '@yikart/mongodb'
import { PipelineController } from './pipeline.controller'
import { PipelineService } from './pipeline.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Pipeline.name, schema: PipelineSchema },
    ]),
  ],
  controllers: [PipelineController],
  providers: [PipelineService],
  exports: [PipelineService],
})
export class PipelineModule {}
