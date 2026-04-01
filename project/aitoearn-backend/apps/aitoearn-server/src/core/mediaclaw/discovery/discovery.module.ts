import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  Brand,
  BrandSchema,
  Competitor,
  CompetitorSchema,
  Organization,
  OrganizationSchema,
  VideoTask,
  VideoTaskSchema,
  ViralContent,
  ViralContentSchema,
} from '@yikart/mongodb'
import { AcquisitionModule } from '../acquisition/acquisition.module'
import { DiscoveryController } from './discovery.controller'
import { DiscoveryService } from './discovery.service'

@Module({
  imports: [
    AcquisitionModule,
    MongooseModule.forFeature([
      { name: Competitor.name, schema: CompetitorSchema },
      { name: Brand.name, schema: BrandSchema },
      { name: Organization.name, schema: OrganizationSchema },
      { name: ViralContent.name, schema: ViralContentSchema },
      { name: VideoTask.name, schema: VideoTaskSchema },
    ]),
  ],
  controllers: [DiscoveryController],
  providers: [DiscoveryService],
  exports: [DiscoveryService],
})
export class DiscoveryModule {}
