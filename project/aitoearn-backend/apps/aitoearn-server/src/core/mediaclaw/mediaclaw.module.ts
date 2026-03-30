import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  ApiKey, ApiKeySchema,
  ApiUsage, ApiUsageSchema,
  AuditLog, AuditLogSchema,
  Brand, BrandSchema,
  BrandAssetVersion, BrandAssetVersionSchema,
  Campaign, CampaignSchema,
  ClawHostInstance, ClawHostInstanceSchema,
  Competitor, CompetitorSchema,
  CopyHistory, CopyHistorySchema,
  Organization, OrganizationSchema,
  MediaClawUser, MediaClawUserSchema,
  MarketplaceTemplate, MarketplaceTemplateSchema,
  NotificationConfig, NotificationConfigSchema,
  PlatformAccount, PlatformAccountSchema,
  Report, ReportSchema,
  VideoPack, VideoPackSchema,
  VideoTask, VideoTaskSchema,
  Pipeline, PipelineSchema,
  PipelineTemplate, PipelineTemplateSchema,
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
import { DataDashboardModule } from './data-dashboard/data-dashboard.module'
import { DiscoveryModule } from './discovery/discovery.module'
import { ClientMgmtModule } from './client-mgmt/client-mgmt.module'
import { ContentMgmtModule } from './content-mgmt/content-mgmt.module'
import { TaskMgmtModule } from './task-mgmt/task-mgmt.module'
import { CompetitorModule } from './competitor/competitor.module'
import { MediaClawAssetModule } from './asset/asset.module'
import { PipelineSystemModule } from './pipeline-system/pipeline-system.module'
import { NotificationModule } from './notification/notification.module'
import { ReportModule } from './report/report.module'
import { PlatformAccountModule } from './platform-account/platform-account.module'
import { MarketplaceModule } from './marketplace/marketplace.module'
import { UsageModule } from './usage/usage.module'
import { ClawHostModule } from './clawhost/clawhost.module'

const workerModuleImports = process.env['MEDIACLAW_ENABLE_WORKER'] === 'false'
  ? []
  : [WorkerModule]

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Organization.name, schema: OrganizationSchema },
      { name: Brand.name, schema: BrandSchema },
      { name: BrandAssetVersion.name, schema: BrandAssetVersionSchema },
      { name: ApiKey.name, schema: ApiKeySchema },
      { name: ApiUsage.name, schema: ApiUsageSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
      { name: Campaign.name, schema: CampaignSchema },
      { name: ClawHostInstance.name, schema: ClawHostInstanceSchema },
      { name: Competitor.name, schema: CompetitorSchema },
      { name: CopyHistory.name, schema: CopyHistorySchema },
      { name: MediaClawUser.name, schema: MediaClawUserSchema },
      { name: MarketplaceTemplate.name, schema: MarketplaceTemplateSchema },
      { name: NotificationConfig.name, schema: NotificationConfigSchema },
      { name: PlatformAccount.name, schema: PlatformAccountSchema },
      { name: Report.name, schema: ReportSchema },
      { name: VideoPack.name, schema: VideoPackSchema },
      { name: VideoTask.name, schema: VideoTaskSchema },
      { name: Pipeline.name, schema: PipelineSchema },
      { name: PipelineTemplate.name, schema: PipelineTemplateSchema },
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
    DataDashboardModule,
    DiscoveryModule,
    ClientMgmtModule,
    ContentMgmtModule,
    TaskMgmtModule,
    CompetitorModule,
    MediaClawAssetModule,
    PipelineSystemModule,
    MarketplaceModule,
    NotificationModule,
    PlatformAccountModule,
    ReportModule,
    UsageModule,
    ClawHostModule,
    WebhookModule,
    ...workerModuleImports,
  ],
  exports: [MongooseModule],
})
export class MediaClawModule {}
