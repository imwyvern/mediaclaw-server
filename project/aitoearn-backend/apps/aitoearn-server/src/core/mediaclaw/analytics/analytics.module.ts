import { BullModule } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  VideoAnalytics,
  VideoAnalyticsSchema,
  VideoTask,
  VideoTaskSchema,
  ViralContent,
  ViralContentSchema,
} from '@yikart/mongodb'

import { AcquisitionModule } from '../acquisition/acquisition.module'
import { ReportModule } from '../report/report.module'
import { AnalyticsCollectorService } from './analytics-collector.service'
import { AnalyticsController } from './analytics.controller'
import { AnalyticsService } from './analytics.service'
import { MEDIACLAW_EFFECT_TRACKER_QUEUE } from './effect-tracker.constants'
import { EffectTrackerQueueService } from './effect-tracker.queue.service'
import { EffectTrackerService } from './effect-tracker.service'
import { EffectTrackerWorker } from './effect-tracker.worker'
import { TrendPredictionService } from './trend-prediction.service'

@Module({
  imports: [
    AcquisitionModule,
    ReportModule,
    BullModule.registerQueue({
      name: MEDIACLAW_EFFECT_TRACKER_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'fixed',
          delay: 1000,
        },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    }),
    MongooseModule.forFeature([
      { name: VideoTask.name, schema: VideoTaskSchema },
      { name: VideoAnalytics.name, schema: VideoAnalyticsSchema },
      { name: ViralContent.name, schema: ViralContentSchema },
    ]),
  ],
  controllers: [AnalyticsController],
  providers: [
    AnalyticsService,
    AnalyticsCollectorService,
    EffectTrackerService,
    EffectTrackerQueueService,
    EffectTrackerWorker,
    TrendPredictionService,
  ],
  exports: [AnalyticsService, AnalyticsCollectorService, EffectTrackerService, TrendPredictionService],
})
export class AnalyticsModule {}
