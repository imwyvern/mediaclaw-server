import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  Organization,
  OrganizationSchema,
  Subscription,
  SubscriptionSchema,
  VideoAnalytics,
  VideoAnalyticsSchema,
  VideoTask,
  VideoTaskSchema,
} from '@yikart/mongodb'
import { DataDashboardController } from './data-dashboard.controller'
import { DataDashboardService } from './data-dashboard.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: VideoTask.name, schema: VideoTaskSchema },
      { name: VideoAnalytics.name, schema: VideoAnalyticsSchema },
      { name: Organization.name, schema: OrganizationSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
    ]),
  ],
  controllers: [DataDashboardController],
  providers: [DataDashboardService],
  exports: [DataDashboardService],
})
export class DataDashboardModule {}
