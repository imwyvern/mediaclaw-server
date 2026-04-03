import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  PipelineTemplate,
  PipelineTemplateSchema,
  ViralContent,
  ViralContentSchema,
} from '@yikart/mongodb'

import { DiscoveryModule } from '../discovery/discovery.module'
import { PipelineMatchController } from './pipeline-match.controller'
import { PipelineMatchService } from './pipeline-match.service'
import { PipelineTemplateController } from './pipeline-template.controller'

@Module({
  imports: [
    DiscoveryModule,
    MongooseModule.forFeature([
      { name: PipelineTemplate.name, schema: PipelineTemplateSchema },
      { name: ViralContent.name, schema: ViralContentSchema },
    ]),
  ],
  controllers: [PipelineMatchController, PipelineTemplateController],
  providers: [PipelineMatchService],
  exports: [PipelineMatchService],
})
export class PipelineMatchModule {}
