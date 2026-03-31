import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  MediaClawUser,
  MediaClawUserSchema,
  Organization,
  OrganizationSchema,
  Subscription,
  SubscriptionSchema,
  VideoTask,
  VideoTaskSchema,
} from '@yikart/mongodb'
import { NotificationModule } from '../notification/notification.module'
import { WebhookModule } from '../webhook/webhook.module'
import { ContentMgmtController } from './content-mgmt.controller'
import { ContentMgmtService } from './content-mgmt.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: VideoTask.name, schema: VideoTaskSchema },
      { name: Organization.name, schema: OrganizationSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: MediaClawUser.name, schema: MediaClawUserSchema },
    ]),
    NotificationModule,
    WebhookModule,
  ],
  controllers: [ContentMgmtController],
  providers: [ContentMgmtService],
  exports: [ContentMgmtService],
})
export class ContentMgmtModule {}
