import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import {
  ApiKey,
  ApiKeySchema,
  ApiUsage,
  ApiUsageSchema,
  AuditLog,
  AuditLogSchema,
  Brand,
  BrandAssetVersion,
  BrandAssetVersionSchema,
  BrandSchema,
  Campaign,
  CampaignSchema,
  ClawHostInstance,
  ClawHostInstanceSchema,
  Competitor,
  CompetitorSchema,
  ContentHash,
  ContentHashSchema,
  CopyHistory,
  CopyHistorySchema,
  IterationLog,
  IterationLogSchema,
  Invoice,
  InvoiceSchema,
  MarketplaceTemplate,
  MarketplaceTemplateSchema,
  MediaClawUser,
  MediaClawUserSchema,
  NotificationConfig,
  NotificationConfigSchema,
  Organization,
  OrganizationSchema,
  PaymentOrder,
  PaymentOrderSchema,
  Pipeline,
  PipelineSchema,
  PipelineTemplate,
  PipelineTemplateSchema,
  PlatformAccount,
  PlatformAccountSchema,
  Report,
  ReportSchema,
  Subscription,
  SubscriptionSchema,
  UsageHistory,
  UsageHistorySchema,
  VideoPack,
  VideoPackSchema,
  VideoTask,
  VideoTaskSchema,
  ViralContent,
  ViralContentSchema,
  Webhook,
  WebhookSchema,
} from "@yikart/mongodb";

import { McAccountModule } from "./account/account.module";
import { AcquisitionModule } from "./acquisition/acquisition.module";
import { AnalyticsModule } from "./analytics/analytics.module";
import { MediaClawApiKeyModule } from "./apikey/apikey.module";
import { MediaClawAssetModule } from "./asset/asset.module";
import { AuditModule } from "./audit/audit.module";
import { McAuthModule } from "./auth/auth.module";
import { BillingModule } from "./billing/billing.module";
import { BrandModule } from "./brand/brand.module";
import { CampaignModule } from "./campaign/campaign.module";
import { ClawHostModule } from "./clawhost/clawhost.module";
import { ClientMgmtModule } from "./client-mgmt/client-mgmt.module";
import { CompetitorModule } from "./competitor/competitor.module";
import { ContentMgmtModule } from "./content-mgmt/content-mgmt.module";
import { CopyModule } from "./copy/copy.module";
import { CrawlerModule } from "./crawler/crawler.module";
import { DataDashboardModule } from "./data-dashboard/data-dashboard.module";
import { DedupModule } from "./dedup/dedup.module";
import { DiscoveryModule } from "./discovery/discovery.module";
import { DistributionModule } from "./distribution/distribution.module";
import { EmployeeDispatchModule } from "./employee-dispatch/employee-dispatch.module";
import { HealthModule } from "./health/health.module";
import { MarketplaceModule } from "./marketplace/marketplace.module";
import { ModelResolverModule } from "./model-resolver/model-resolver.module";
import { NotificationModule } from "./notification/notification.module";
import { OrgModule } from "./org/org.module";
import { PaymentModule } from "./payment/payment.module";
import { PipelineMatchModule } from "./pipeline-match/pipeline-match.module";
import { PipelineSystemModule } from "./pipeline-system/pipeline-system.module";
import { PipelineModule } from "./pipeline/pipeline.module";
import { PlatformAccountModule } from "./platform-account/platform-account.module";
import { PromptOptimizerModule } from "./prompt-optimizer/prompt-optimizer.module";
import { ProductionModule } from "./production/production.module";
import { ReportModule } from "./report/report.module";
import { SettingsModule } from "./settings/settings.module";
import { SkillModule } from "./skill/skill.module";
import { TaskMgmtModule } from "./task-mgmt/task-mgmt.module";
import { UsageModule } from "./usage/usage.module";
import { VideoModule } from "./video/video.module";
import { WebhookModule } from "./webhook/webhook.module";
import { WorkerModule } from "./worker/worker.module";

const workerModuleImports =
  process.env["MEDIACLAW_ENABLE_WORKER"] === "false" ? [] : [WorkerModule];

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
      { name: ContentHash.name, schema: ContentHashSchema },
      { name: CopyHistory.name, schema: CopyHistorySchema },
      { name: IterationLog.name, schema: IterationLogSchema },
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
      { name: UsageHistory.name, schema: UsageHistorySchema },
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
    PipelineMatchModule,
    McAccountModule,
    CopyModule,
    DistributionModule,
    EmployeeDispatchModule,
    MediaClawApiKeyModule,
    SettingsModule,
    SkillModule,
    AnalyticsModule,
    AuditModule,
    CampaignModule,
    AcquisitionModule,
    CrawlerModule,
    DataDashboardModule,
    DedupModule,
    DiscoveryModule,
    ClientMgmtModule,
    ContentMgmtModule,
    TaskMgmtModule,
    CompetitorModule,
    MediaClawAssetModule,
    PipelineSystemModule,
    MarketplaceModule,
    ModelResolverModule,
    NotificationModule,
    PlatformAccountModule,
    PromptOptimizerModule,
    ProductionModule,
    ReportModule,
    UsageModule,
    ClawHostModule,
    WebhookModule,
    ...workerModuleImports,
  ],
  exports: [MongooseModule],
})
export class MediaClawModule {}
