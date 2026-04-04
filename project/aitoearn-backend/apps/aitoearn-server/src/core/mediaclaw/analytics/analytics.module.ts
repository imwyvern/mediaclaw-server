import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  VideoAnalytics,
  VideoAnalyticsSchema,
  VideoTask,
  VideoTaskSchema,
} from '@yikart/mongodb'

import { AcquisitionModule } from '../acquisition/acquisition.module'
import { ReportModule } from '../report/report.module'
import { AnalyticsCollectorService } from './analytics-collector.service'
import { AnalyticsController } from './analytics.controller'
import { AnalyticsService } from './analytics.service'

@Module({
  imports: [
    AcquisitionModule,
    ReportModule,
    MongooseModule.forFeature([
      { name: VideoTask.name, schema: VideoTaskSchema },
      { name: VideoAnalytics.name, schema: VideoAnalyticsSchema },
    ]),
  ],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AnalyticsCollectorService],
  exports: [AnalyticsService, AnalyticsCollectorService],
})
export class AnalyticsModule {}
