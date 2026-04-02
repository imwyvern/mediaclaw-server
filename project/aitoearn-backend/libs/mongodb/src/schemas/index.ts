import { AccountGroup, AccountGroupSchema } from "./account-group.schema";
import { Account, AccountSchema } from "./account.schema";
import { AiLog, AiLogSchema } from "./ai-log.schema";
import { ApiUsage, ApiUsageSchema } from "./api-usage.schema";
import { ApiKey, ApiKeySchema } from "./api-key.schema";
import { AuditLog, AuditLogSchema } from "./audit-log.schema";
import { Asset, AssetSchema } from "./asset.schema";
import { Blog, BlogSchema } from "./blog.schema";
import {
  BrandAssetVersion,
  BrandAssetVersionSchema,
} from "./brand-asset-version.schema";
import {
  PipelineTemplate,
  PipelineTemplateSchema,
} from "./pipeline-template.schema";
import {
  ContentGenerationTask,
  ContentGenerationTaskSchema,
} from "./content-generation-task.schema";
import { Campaign, CampaignSchema } from "./campaign.schema";
import {
  ClawHostInstance,
  ClawHostInstanceSchema,
} from "./clawhost-instance.schema";
import { CopyHistory, CopyHistorySchema } from "./copy-history.schema";
import { Competitor, CompetitorSchema } from "./competitor.schema";
import {
  DiscoveryNotification,
  DiscoveryNotificationSchema,
} from "./discovery-notification.schema";
import {
  DistributionRule,
  DistributionRuleSchema,
} from "./distribution-rule.schema";
import { CreditsBalance, CreditsBalanceSchema } from "./credits-balance.schema";
import { CreditsRecord, CreditsRecordSchema } from "./credits-record.schema";
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
  NotificationConfig,
  NotificationConfigSchema,
} from "./notification-config.schema";
import { Notification, NotificationSchema } from "./notification.schema";
import { PaymentOrder, PaymentOrderSchema } from "./payment-order.schema";
import { PointsRecord, PointsRecordSchema } from "./points-record.schema";
import {
  PlatformAccount,
  PlatformAccountSchema,
} from "./platform-account.schema";
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
import { ViralContent, ViralContentSchema } from "./viral-content.schema";
import {
  UserNotificationControl,
  UserNotificationControlSchema,
} from "./user-notification-control.schema";
import { User, UserSchema } from "./user.schema";
import { Webhook, WebhookSchema } from "./webhook.schema";

export * from "./account-group.schema";
export * from "./account.schema";
export * from "./ai-log.schema";
export * from "./api-usage.schema";
export * from "./api-key.schema";
export * from "./audit-log.schema";
export * from "./asset.schema";
export * from "./blog.schema";
export * from "./brand-asset-version.schema";
export * from "./campaign.schema";
export * from "./clawhost-instance.schema";
export * from "./content-generation-task.schema";
export * from "./competitor.schema";
export * from "./copy-history.schema";
export * from "./credits-balance.schema";
export * from "./credits-record.schema";
export * from "./discovery-notification.schema";
export * from "./distribution-rule.schema";
export * from "./engagement.task.schema";
export * from "./interaction-record.schema";
export * from "./material-adaptation.schema";
export * from "./material-group.schema";
export * from "./material-task.schema";
export * from "./material.schema";
export * from "./marketplace-template.schema";
export * from "./media-group.schema";
export * from "./media.schema";
export * from "./notification-config.schema";
export * from "./notification.schema";
export * from "./oauth2-credential.schema";
export * from "./points-record.schema";
export * from "./platform-account.schema";
export * from "./publish-day-info.schema";
export * from "./publish-info.schema";
export * from "./publish-record.schema";
export * from "./publishing-task-meta.schema";
export * from "./qr-code-art-image.schema";
export * from "./report.schema";
export * from "./reply-comment-record.schema";
export * from "./timestamp.schema";
export * from "./user-notification-control.schema";
export * from "./user.schema";
export * from "./viral-content.schema";
export * from "./webhook.schema";
export * from "./pipeline-template.schema";

export const schemas = [
  { name: User.name, schema: UserSchema },
  { name: CreditsBalance.name, schema: CreditsBalanceSchema },
  { name: CreditsRecord.name, schema: CreditsRecordSchema },
  { name: PointsRecord.name, schema: PointsRecordSchema },
  { name: PlatformAccount.name, schema: PlatformAccountSchema },
  { name: AiLog.name, schema: AiLogSchema },
  { name: ApiUsage.name, schema: ApiUsageSchema },
  { name: Blog.name, schema: BlogSchema },
  { name: BrandAssetVersion.name, schema: BrandAssetVersionSchema },
  { name: Campaign.name, schema: CampaignSchema },
  { name: ClawHostInstance.name, schema: ClawHostInstanceSchema },
  { name: Competitor.name, schema: CompetitorSchema },
  { name: CopyHistory.name, schema: CopyHistorySchema },
  { name: DiscoveryNotification.name, schema: DiscoveryNotificationSchema },
  { name: DistributionRule.name, schema: DistributionRuleSchema },
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
  { name: Material.name, schema: MaterialSchema },
  { name: MaterialAdaptation.name, schema: MaterialAdaptationSchema },
  { name: MaterialGroup.name, schema: MaterialGroupSchema },
  { name: MaterialTask.name, schema: MaterialTaskSchema },
  { name: MarketplaceTemplate.name, schema: MarketplaceTemplateSchema },
  { name: PublishDayInfo.name, schema: PublishDayInfoSchema },
  { name: PublishInfo.name, schema: PublishInfoSchema },
  { name: PublishRecord.name, schema: PublishRecordSchema },
  { name: ContentGenerationTask.name, schema: ContentGenerationTaskSchema },
  { name: UserNotificationControl.name, schema: UserNotificationControlSchema },
  { name: Asset.name, schema: AssetSchema },
  { name: Webhook.name, schema: WebhookSchema },
  { name: QrCodeArtImage.name, schema: QrCodeArtImageSchema },
  { name: Report.name, schema: ReportSchema },
  { name: EngagementTask.name, schema: EngagementTaskSchema },
  { name: EngagementSubTask.name, schema: EngagementSubTaskSchema },
  { name: InteractionRecord.name, schema: InteractionRecordSchema },
  { name: ReplyCommentRecord.name, schema: ReplyCommentRecordSchema },
  { name: ViralContent.name, schema: ViralContentSchema },
] as const;

// MediaClaw-specific schemas
export * from "./brand.schema";
export * from "./organization.schema";
export * from "./mediaclaw-user.schema";
export * from "./video-pack.schema";
export * from "./video-task.schema";
export * from "./pipeline.schema";
export * from "./payment-order.schema";
export * from "./subscription.schema";
export * from "./invoice.schema";
