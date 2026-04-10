import { BullModule } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  Competitor,
  CompetitorSchema,
  CrawlerResult,
  CrawlerResultSchema,
} from '@yikart/mongodb'
import { AcquisitionModule } from '../acquisition/acquisition.module'
import { DiscoveryModule } from '../discovery/discovery.module'
import { MediaclawConfigModule } from '../mediaclaw-config.module'
import { CrawlerResultService } from './crawler-result.service'
import { CrawlerSchedulerService } from './crawler-scheduler.service'
import { MEDIACLAW_CRAWL_QUEUE } from './crawler.constants'
import { CrawlerController } from './crawler.controller'
import { CrawlerProcessor } from './crawler.processor'
import { CrawlerService } from './crawler.service'
import { MediaCrawlerProClient } from './media-crawler-pro.client'

@Module({
  imports: [
    AcquisitionModule,
    DiscoveryModule,
    MediaclawConfigModule,
    MongooseModule.forFeature([
      { name: CrawlerResult.name, schema: CrawlerResultSchema },
      { name: Competitor.name, schema: CompetitorSchema },
    ]),
    BullModule.registerQueue({
      name: MEDIACLAW_CRAWL_QUEUE,
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
  ],
  controllers: [CrawlerController],
  providers: [
    CrawlerService,
    CrawlerResultService,
    CrawlerSchedulerService,
    CrawlerProcessor,
    MediaCrawlerProClient,
  ],
  exports: [CrawlerService],
})
export class CrawlerModule {}
