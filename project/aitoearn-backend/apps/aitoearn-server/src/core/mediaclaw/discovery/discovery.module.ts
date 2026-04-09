import { BullModule } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  Brand,
  BrandSchema,
  Competitor,
  CompetitorSchema,
  DiscoveryNotification,
  DiscoveryNotificationSchema,
  Organization,
  OrganizationSchema,
  Pipeline,
  PipelineSchema,
  VideoTask,
  VideoTaskSchema,
  ViralContent,
  ViralContentSchema,
} from '@yikart/mongodb'
import { AcquisitionModule } from '../acquisition/acquisition.module'
import { MediaclawConfigModule } from '../mediaclaw-config.module'
import { NotificationModule } from '../notification/notification.module'
import { ContentRemixService } from './content-remix.service'
import { DiscoveryNotificationService } from './discovery-notification.service'
import { MEDIACLAW_DISCOVERY_QUEUE } from './discovery.constants'
import { DiscoveryController } from './discovery.controller'
import { DiscoveryService } from './discovery.service'
import { DiscoveryIngestionProcessor } from './ingestion.processor'
import { DiscoveryIngestionService } from './ingestion.service'

@Module({
  imports: [
    AcquisitionModule,
    MediaclawConfigModule,
    NotificationModule,
    BullModule.registerQueue({
      name: MEDIACLAW_DISCOVERY_QUEUE,
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
      { name: Competitor.name, schema: CompetitorSchema },
      { name: Brand.name, schema: BrandSchema },
      { name: Organization.name, schema: OrganizationSchema },
      { name: ViralContent.name, schema: ViralContentSchema },
      { name: VideoTask.name, schema: VideoTaskSchema },
      { name: Pipeline.name, schema: PipelineSchema },
      { name: DiscoveryNotification.name, schema: DiscoveryNotificationSchema },
    ]),
  ],
  controllers: [DiscoveryController],
  providers: [
    DiscoveryService,
    DiscoveryIngestionService,
    DiscoveryIngestionProcessor,
    ContentRemixService,
    DiscoveryNotificationService,
  ],
  exports: [
    DiscoveryService,
    DiscoveryIngestionService,
    ContentRemixService,
    DiscoveryNotificationService,
  ],
})
export class DiscoveryModule {}
