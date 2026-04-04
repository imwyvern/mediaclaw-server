import { Global, Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  ApiUsage,
  ApiUsageSchema,
  Brand,
  BrandSchema,
  ConversationUsage,
  ConversationUsageSchema,
  Organization,
  OrganizationSchema,
  Subscription,
  SubscriptionSchema,
  UsageHistory,
  UsageHistorySchema,
  VideoPack,
  VideoPackSchema,
  VideoTask,
  VideoTaskSchema,
} from '@yikart/mongodb'
import { NotificationModule } from '../notification/notification.module'
import { ConversationUsageService } from './conversation-usage.service'
import { UsageApiController } from './usage-api.controller'
import { UsageController } from './usage.controller'
import { UsageReconciliationService } from './reconciliation.service'
import { UsageTrackingInterceptor } from './usage-tracking.interceptor'
import { UsageService } from './usage.service'

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ApiUsage.name, schema: ApiUsageSchema },
      { name: Organization.name, schema: OrganizationSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: ConversationUsage.name, schema: ConversationUsageSchema },
      { name: UsageHistory.name, schema: UsageHistorySchema },
      { name: VideoPack.name, schema: VideoPackSchema },
      { name: VideoTask.name, schema: VideoTaskSchema },
      { name: Brand.name, schema: BrandSchema },
    ]),
    NotificationModule,
  ],
  controllers: [UsageController, UsageApiController],
  providers: [
    UsageService,
    ConversationUsageService,
    UsageTrackingInterceptor,
    UsageReconciliationService,
  ],
  exports: [UsageService, ConversationUsageService, UsageTrackingInterceptor],
})
export class UsageModule {}
