import { BullModule } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'
import { AcquisitionModule } from '../acquisition/acquisition.module'
import { CrawlerController } from './crawler.controller'
import { CrawlerService, MEDIACLAW_CRAWL_QUEUE } from './crawler.service'

@Module({
  imports: [
    AcquisitionModule,
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
  providers: [CrawlerService],
  exports: [CrawlerService],
})
export class CrawlerModule {}
