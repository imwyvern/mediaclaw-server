import { Global, Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  ApiUsage,
  ApiUsageSchema,
  Organization,
  OrganizationSchema,
  Subscription,
  SubscriptionSchema,
} from '@yikart/mongodb'
import { UsageTrackingInterceptor } from './usage-tracking.interceptor'
import { UsageController } from './usage.controller'
import { UsageService } from './usage.service'

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ApiUsage.name, schema: ApiUsageSchema },
      { name: Organization.name, schema: OrganizationSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
    ]),
  ],
  controllers: [UsageController],
  providers: [UsageService, UsageTrackingInterceptor],
  exports: [UsageService, UsageTrackingInterceptor],
})
export class UsageModule {}
