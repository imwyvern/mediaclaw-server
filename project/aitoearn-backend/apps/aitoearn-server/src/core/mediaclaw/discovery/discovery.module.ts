import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
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
} from "@yikart/mongodb";
import { AcquisitionModule } from "../acquisition/acquisition.module";
import { MediaclawConfigModule } from "../mediaclaw-config.module";
import { ContentRemixService } from "./content-remix.service";
import { DiscoveryController } from "./discovery.controller";
import { DiscoveryNotificationService } from "./discovery-notification.service";
import { DiscoveryService } from "./discovery.service";

@Module({
  imports: [
    AcquisitionModule,
    MediaclawConfigModule,
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
    ContentRemixService,
    DiscoveryNotificationService,
  ],
  exports: [
    DiscoveryService,
    ContentRemixService,
    DiscoveryNotificationService,
  ],
})
export class DiscoveryModule {}
