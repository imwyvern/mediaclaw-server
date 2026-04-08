import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  Brand,
  BrandSchema,
  Competitor,
  CompetitorSchema,
  Organization,
  OrganizationSchema,
  ViralContent,
  ViralContentSchema,
} from '@yikart/mongodb'
import { AcquisitionModule } from '../acquisition/acquisition.module'
import { DiscoveryModule } from '../discovery/discovery.module'
import { CompetitorController } from './competitor.controller'
import { CompetitorService } from './competitor.service'

@Module({
  imports: [
    AcquisitionModule,
    DiscoveryModule,
    MongooseModule.forFeature([
      { name: Brand.name, schema: BrandSchema },
      { name: Competitor.name, schema: CompetitorSchema },
      { name: Organization.name, schema: OrganizationSchema },
      { name: ViralContent.name, schema: ViralContentSchema },
    ]),
  ],
  controllers: [CompetitorController],
  providers: [CompetitorService],
  exports: [CompetitorService],
})
export class CompetitorModule {}
