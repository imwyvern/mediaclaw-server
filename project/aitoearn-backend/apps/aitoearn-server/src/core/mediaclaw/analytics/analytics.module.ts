import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  VideoAnalytics,
  VideoAnalyticsSchema,
  VideoTask,
  VideoTaskSchema,
} from '@yikart/mongodb'

import { AnalyticsCollectorService } from './analytics-collector.service'
import { AnalyticsController } from './analytics.controller'
import { AnalyticsService } from './analytics.service'

@Module({
  imports: [
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
