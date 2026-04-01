import { BullModule } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'
import { AcquisitionModule } from '../acquisition/acquisition.module'
import { DiscoveryModule } from '../discovery/discovery.module'
import { CrawlerController } from './crawler.controller'
import { CrawlerProcessor } from './crawler.processor'
import { CrawlerService, MEDIACLAW_CRAWL_QUEUE } from './crawler.service'

@Module({
  imports: [
    AcquisitionModule,
    DiscoveryModule,
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
  providers: [CrawlerService, CrawlerProcessor],
  exports: [CrawlerService],
})
export class CrawlerModule {}
