import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  Brand,
  BrandSchema,
  Campaign,
  CampaignSchema,
  Organization,
  OrganizationSchema,
  Report,
  ReportSchema,
  VideoTask,
  VideoTaskSchema,
} from '@yikart/mongodb'
import { ReportController } from './report.controller'
import { ReportService } from './report.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Report.name, schema: ReportSchema },
      { name: VideoTask.name, schema: VideoTaskSchema },
      { name: Brand.name, schema: BrandSchema },
      { name: Campaign.name, schema: CampaignSchema },
      { name: Organization.name, schema: OrganizationSchema },
    ]),
  ],
  controllers: [ReportController],
  providers: [ReportService],
  exports: [ReportService],
})
export class ReportModule {}
