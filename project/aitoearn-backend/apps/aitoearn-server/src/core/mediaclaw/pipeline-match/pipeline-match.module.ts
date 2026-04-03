import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { PipelineTemplate, PipelineTemplateSchema } from '@yikart/mongodb'

import { PipelineMatchController } from './pipeline-match.controller'
import { PipelineMatchService } from './pipeline-match.service'
import { PipelineTemplateController } from './pipeline-template.controller'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PipelineTemplate.name, schema: PipelineTemplateSchema },
    ]),
  ],
  controllers: [PipelineMatchController, PipelineTemplateController],
  providers: [PipelineMatchService],
  exports: [PipelineMatchService],
})
export class PipelineMatchModule {}
