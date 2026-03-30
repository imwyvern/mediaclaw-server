import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  MarketplaceTemplate,
  MarketplaceTemplateSchema,
  PipelineTemplate,
  PipelineTemplateSchema,
} from '@yikart/mongodb'
import { MarketplaceController } from './marketplace.controller'
import { MarketplaceService } from './marketplace.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MarketplaceTemplate.name, schema: MarketplaceTemplateSchema },
      { name: PipelineTemplate.name, schema: PipelineTemplateSchema },
    ]),
  ],
  controllers: [MarketplaceController],
  providers: [MarketplaceService],
  exports: [MarketplaceService],
})
export class MarketplaceModule {}
