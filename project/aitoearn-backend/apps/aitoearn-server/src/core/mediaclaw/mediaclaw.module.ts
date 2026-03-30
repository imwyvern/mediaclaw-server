import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  ApiKey, ApiKeySchema,
  AuditLog, AuditLogSchema,
  Brand, BrandSchema,
  Campaign, CampaignSchema,
  CopyHistory, CopyHistorySchema,
  Organization, OrganizationSchema,
  MediaClawUser, MediaClawUserSchema,
  VideoPack, VideoPackSchema,
  VideoTask, VideoTaskSchema,
  Pipeline, PipelineSchema,
  PaymentOrder, PaymentOrderSchema,
  Subscription, SubscriptionSchema,
  Invoice, InvoiceSchema,
  Webhook, WebhookSchema,
  ViralContent, ViralContentSchema,
} from '@yikart/mongodb'

import { BrandModule } from './brand/brand.module'
import { OrgModule } from './org/org.module'
import { BillingModule } from './billing/billing.module'
import { HealthModule } from './health/health.module'
import { McAuthModule } from './auth/auth.module'
import { VideoModule } from './video/video.module'
import { PaymentModule } from './payment/payment.module'
import { PipelineModule } from './pipeline/pipeline.module'
import { McAccountModule } from './account/account.module'
import { WorkerModule } from './worker/worker.module'
import { CopyModule } from './copy/copy.module'
import { MediaClawApiKeyModule } from './apikey/apikey.module'
import { DistributionModule } from './distribution/distribution.module'
import { SkillModule } from './skill/skill.module'
import { AnalyticsModule } from './analytics/analytics.module'
import { AuditModule } from './audit/audit.module'
import { CampaignModule } from './campaign/campaign.module'
import { WebhookModule } from './webhook/webhook.module'
import { AcquisitionModule } from './acquisition/acquisition.module'
import { CrawlerModule } from './crawler/crawler.module'
import { DiscoveryModule } from './discovery/discovery.module'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Organization.name, schema: OrganizationSchema },
      { name: Brand.name, schema: BrandSchema },
      { name: ApiKey.name, schema: ApiKeySchema },
      { name: AuditLog.name, schema: AuditLogSchema },
      { name: Campaign.name, schema: CampaignSchema },
      { name: CopyHistory.name, schema: CopyHistorySchema },
      { name: MediaClawUser.name, schema: MediaClawUserSchema },
      { name: VideoPack.name, schema: VideoPackSchema },
      { name: VideoTask.name, schema: VideoTaskSchema },
      { name: Pipeline.name, schema: PipelineSchema },
      { name: PaymentOrder.name, schema: PaymentOrderSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: Invoice.name, schema: InvoiceSchema },
      { name: Webhook.name, schema: WebhookSchema },
      { name: ViralContent.name, schema: ViralContentSchema },
    ]),
    BrandModule,
    OrgModule,
    BillingModule,
    HealthModule,
    McAuthModule,
    VideoModule,
    PaymentModule,
    PipelineModule,
    McAccountModule,
    CopyModule,
    DistributionModule,
    MediaClawApiKeyModule,
    SkillModule,
    AnalyticsModule,
    AuditModule,
    CampaignModule,
    AcquisitionModule,
    CrawlerModule,
    DiscoveryModule,
    WebhookModule,
    WorkerModule,
  ],
  exports: [MongooseModule],
})
export class MediaClawModule {}
