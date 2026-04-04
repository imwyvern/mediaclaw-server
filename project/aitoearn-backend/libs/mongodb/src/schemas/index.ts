import { AccountGroup, AccountGroupSchema } from "./account-group.schema";
import { Account, AccountSchema } from "./account.schema";
import { AiLog, AiLogSchema } from "./ai-log.schema";
import { ApiKey, ApiKeySchema } from "./api-key.schema";
import { ApiUsage, ApiUsageSchema } from "./api-usage.schema";
import { Asset, AssetSchema } from "./asset.schema";
import { AuditLog, AuditLogSchema } from "./audit-log.schema";
import { Blog, BlogSchema } from "./blog.schema";
import {
  BrandAssetVersion,
  BrandAssetVersionSchema,
} from "./brand-asset-version.schema";
import { Brand, BrandSchema } from "./brand.schema";
import { Campaign, CampaignSchema } from "./campaign.schema";
import {
  ClawHostInstance,
  ClawHostInstanceSchema,
} from "./clawhost-instance.schema";
import {
  ContentGenerationTask,
  ContentGenerationTaskSchema,
} from "./content-generation-task.schema";
import { Competitor, CompetitorSchema } from "./competitor.schema";
import { ContentHash, ContentHashSchema } from "./content-hash.schema";
import { CopyHistory, CopyHistorySchema } from "./copy-history.schema";
import {
  CopyPerformance,
  CopyPerformanceSchema,
} from "./copy-performance.schema";
import { CreditsBalance, CreditsBalanceSchema } from "./credits-balance.schema";
import { CreditsRecord, CreditsRecordSchema } from "./credits-record.schema";
import { DeliveryRecord, DeliveryRecordSchema } from "./delivery-record.schema";
import {
  EnterpriseInvite,
  EnterpriseInviteSchema,
} from "./enterprise-invite.schema";
import {
  DiscoveryNotification,
  DiscoveryNotificationSchema,
} from "./discovery-notification.schema";
import {
  DistributionRule,
  DistributionRuleSchema,
} from "./distribution-rule.schema";
import {
  EmployeeAssignment,
  EmployeeAssignmentSchema,
} from "./employee-assignment.schema";
import {
  EngagementSubTask,
  EngagementSubTaskSchema,
  EngagementTask,
  EngagementTaskSchema,
} from "./engagement.task.schema";
import {
  InteractionRecord,
  InteractionRecordSchema,
} from "./interaction-record.schema";
import { Invoice, InvoiceSchema } from "./invoice.schema";
import { IterationLog, IterationLogSchema } from "./iteration-log.schema";
import {
  MaterialAdaptation,
  MaterialAdaptationSchema,
} from "./material-adaptation.schema";
import { MaterialGroup, MaterialGroupSchema } from "./material-group.schema";
import { MaterialTask, MaterialTaskSchema } from "./material-task.schema";
import { Material, MaterialSchema } from "./material.schema";
import {
  MarketplaceTemplate,
  MarketplaceTemplateSchema,
} from "./marketplace-template.schema";
import { MediaGroup, MediaGroupSchema } from "./media-group.schema";
import { Media, MediaSchema } from "./media.schema";
import {
  MediaClawUser,
  MediaClawUserSchema,
} from "./mediaclaw-user.schema";
import {
  NotificationConfig,
  NotificationConfigSchema,
} from "./notification-config.schema";
import { Notification, NotificationSchema } from "./notification.schema";
import {
  OAuth2Credential,
  OAuth2CredentialSchema,
} from "./oauth2-credential.schema";
import { Organization, OrganizationSchema } from "./organization.schema";
import { PaymentOrder, PaymentOrderSchema } from "./payment-order.schema";
import { Pipeline, PipelineSchema } from "./pipeline.schema";
import {
  PipelineTemplate,
  PipelineTemplateSchema,
} from "./pipeline-template.schema";
import { PointsRecord, PointsRecordSchema } from "./points-record.schema";
import {
  PlatformAccount,
  PlatformAccountSchema,
} from "./platform-account.schema";
import {
  ProductionBatch,
  ProductionBatchSchema,
} from "./production-batch.schema";
import {
  PublishDayInfo,
  PublishDayInfoSchema,
} from "./publish-day-info.schema";
import { PublishInfo, PublishInfoSchema } from "./publish-info.schema";
import { PublishRecord, PublishRecordSchema } from "./publish-record.schema";
import {
  QrCodeArtImage,
  QrCodeArtImageSchema,
} from "./qr-code-art-image.schema";
import { Report, ReportSchema } from "./report.schema";
import {
  ReplyCommentRecord,
  ReplyCommentRecordSchema,
} from "./reply-comment-record.schema";
import { Subscription, SubscriptionSchema } from "./subscription.schema";
import { UsageHistory, UsageHistorySchema } from "./usage-history.schema";
import {
  UserNotificationControl,
  UserNotificationControlSchema,
} from "./user-notification-control.schema";
import { User, UserSchema } from "./user.schema";
import { ViralContent, ViralContentSchema } from "./viral-content.schema";
import { VideoAnalytics, VideoAnalyticsSchema } from "./video-analytics.schema";
import { VideoPack, VideoPackSchema } from "./video-pack.schema";
import { VideoTask, VideoTaskSchema } from "./video-task.schema";
import { Webhook, WebhookSchema } from "./webhook.schema";

export * from "./account-group.schema";
export * from "./account.schema";
export * from "./ai-log.schema";
export * from "./api-key.schema";
export * from "./api-usage.schema";
export * from "./asset.schema";
export * from "./audit-log.schema";
export * from "./blog.schema";
export * from "./brand-asset-version.schema";
export * from "./brand.schema";
export * from "./campaign.schema";
export * from "./clawhost-instance.schema";
export * from "./competitor.schema";
export * from "./content-hash.schema";
export * from "./content-generation-task.schema";
export * from "./copy-history.schema";
export * from "./copy-performance.schema";
export * from "./credits-balance.schema";
export * from "./credits-record.schema";
export * from "./delivery-record.schema";
export * from "./discovery-notification.schema";
export * from "./distribution-rule.schema";
export * from "./employee-assignment.schema";
export * from "./enterprise-invite.schema";
export * from "./engagement.task.schema";
export * from "./interaction-record.schema";
export * from "./iteration-log.schema";
export * from "./invoice.schema";
export * from "./marketplace-template.schema";
export * from "./material-adaptation.schema";
export * from "./material-group.schema";
export * from "./material-task.schema";
export * from "./material.schema";
export * from "./media-group.schema";
export * from "./media.schema";
export * from "./mediaclaw-user.schema";
export * from "./notification-config.schema";
export * from "./notification.schema";
export * from "./oauth2-credential.schema";
export * from "./organization.schema";
export * from "./payment-order.schema";
export * from "./pipeline-template.schema";
export * from "./pipeline.schema";
export * from "./platform-account.schema";
export * from "./points-record.schema";
export * from "./production-batch.schema";
export * from "./publish-day-info.schema";
export * from "./publish-info.schema";
export * from "./publish-record.schema";
export * from "./publishing-task-meta.schema";
export * from "./qr-code-art-image.schema";
export * from "./report.schema";
export * from "./reply-comment-record.schema";
export * from "./subscription.schema";
export * from "./timestamp.schema";
export * from "./usage-history.schema";
export * from "./user-notification-control.schema";
export * from "./user.schema";
export * from "./video-analytics.schema";
export * from "./video-pack.schema";
export * from "./video-task.schema";
export * from "./viral-content.schema";
export * from "./webhook.schema";

export const schemas = [
  { name: User.name, schema: UserSchema },
  { name: CreditsBalance.name, schema: CreditsBalanceSchema },
  { name: CreditsRecord.name, schema: CreditsRecordSchema },
  { name: DeliveryRecord.name, schema: DeliveryRecordSchema },
  { name: EnterpriseInvite.name, schema: EnterpriseInviteSchema },
  { name: PointsRecord.name, schema: PointsRecordSchema },
  { name: PlatformAccount.name, schema: PlatformAccountSchema },
  { name: AiLog.name, schema: AiLogSchema },
  { name: ApiUsage.name, schema: ApiUsageSchema },
  { name: Blog.name, schema: BlogSchema },
  { name: BrandAssetVersion.name, schema: BrandAssetVersionSchema },
  { name: Brand.name, schema: BrandSchema },
  { name: Campaign.name, schema: CampaignSchema },
  { name: ClawHostInstance.name, schema: ClawHostInstanceSchema },
  { name: Competitor.name, schema: CompetitorSchema },
  { name: ContentHash.name, schema: ContentHashSchema },
  { name: ContentGenerationTask.name, schema: ContentGenerationTaskSchema },
  { name: CopyHistory.name, schema: CopyHistorySchema },
  { name: CopyPerformance.name, schema: CopyPerformanceSchema },
  { name: DiscoveryNotification.name, schema: DiscoveryNotificationSchema },
  { name: DistributionRule.name, schema: DistributionRuleSchema },
  { name: EmployeeAssignment.name, schema: EmployeeAssignmentSchema },
  { name: Invoice.name, schema: InvoiceSchema },
  { name: PipelineTemplate.name, schema: PipelineTemplateSchema },
  { name: NotificationConfig.name, schema: NotificationConfigSchema },
  { name: Notification.name, schema: NotificationSchema },
  { name: PaymentOrder.name, schema: PaymentOrderSchema },
  { name: Account.name, schema: AccountSchema },
  { name: ApiKey.name, schema: ApiKeySchema },
  { name: AuditLog.name, schema: AuditLogSchema },
  { name: AccountGroup.name, schema: AccountGroupSchema },
  { name: MediaGroup.name, schema: MediaGroupSchema },
  { name: Media.name, schema: MediaSchema },
  { name: MediaClawUser.name, schema: MediaClawUserSchema },
  { name: Material.name, schema: MaterialSchema },
  { name: MaterialAdaptation.name, schema: MaterialAdaptationSchema },
  { name: MaterialGroup.name, schema: MaterialGroupSchema },
  { name: MaterialTask.name, schema: MaterialTaskSchema },
  { name: MarketplaceTemplate.name, schema: MarketplaceTemplateSchema },
  { name: PublishDayInfo.name, schema: PublishDayInfoSchema },
  { name: PublishInfo.name, schema: PublishInfoSchema },
  { name: PublishRecord.name, schema: PublishRecordSchema },
  { name: ProductionBatch.name, schema: ProductionBatchSchema },
  { name: OAuth2Credential.name, schema: OAuth2CredentialSchema },
  { name: Organization.name, schema: OrganizationSchema },
  { name: Subscription.name, schema: SubscriptionSchema },
  { name: UserNotificationControl.name, schema: UserNotificationControlSchema },
  { name: UsageHistory.name, schema: UsageHistorySchema },
  { name: Asset.name, schema: AssetSchema },
  { name: VideoAnalytics.name, schema: VideoAnalyticsSchema },
  { name: VideoPack.name, schema: VideoPackSchema },
  { name: VideoTask.name, schema: VideoTaskSchema },
  { name: Webhook.name, schema: WebhookSchema },
  { name: QrCodeArtImage.name, schema: QrCodeArtImageSchema },
  { name: Report.name, schema: ReportSchema },
  { name: EngagementTask.name, schema: EngagementTaskSchema },
  { name: EngagementSubTask.name, schema: EngagementSubTaskSchema },
  { name: InteractionRecord.name, schema: InteractionRecordSchema },
  { name: IterationLog.name, schema: IterationLogSchema },
  { name: ReplyCommentRecord.name, schema: ReplyCommentRecordSchema },
  { name: ViralContent.name, schema: ViralContentSchema },
  { name: Pipeline.name, schema: PipelineSchema },
] as const;
