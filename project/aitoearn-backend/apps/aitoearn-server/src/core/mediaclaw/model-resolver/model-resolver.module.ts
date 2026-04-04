import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  Organization,
  OrganizationSchema,
  Pipeline,
  PipelineSchema,
} from '@yikart/mongodb'
import { MediaclawConfigModule } from '../mediaclaw-config.module'
import { ModelResolverService } from './model-resolver.service'

@Module({
  imports: [
    MediaclawConfigModule,
    MongooseModule.forFeature([
      { name: Organization.name, schema: OrganizationSchema },
      { name: Pipeline.name, schema: PipelineSchema },
    ]),
  ],
  providers: [ModelResolverService],
  exports: [ModelResolverService],
})
export class ModelResolverModule {}
