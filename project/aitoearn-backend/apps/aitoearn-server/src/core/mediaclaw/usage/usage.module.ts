import { Global, Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  ApiUsage,
  ApiUsageSchema,
  Brand,
  BrandSchema,
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
      { name: UsageHistory.name, schema: UsageHistorySchema },
      { name: VideoPack.name, schema: VideoPackSchema },
      { name: VideoTask.name, schema: VideoTaskSchema },
      { name: Brand.name, schema: BrandSchema },
    ]),
  ],
  controllers: [UsageController, UsageApiController],
  providers: [UsageService, UsageTrackingInterceptor, UsageReconciliationService],
  exports: [UsageService, UsageTrackingInterceptor],
})
export class UsageModule {}
