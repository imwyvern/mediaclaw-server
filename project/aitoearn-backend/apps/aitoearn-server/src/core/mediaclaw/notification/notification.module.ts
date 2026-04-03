import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  DiscoveryNotification,
  DiscoveryNotificationSchema,
  Notification,
  NotificationConfig,
  NotificationConfigSchema,
  NotificationSchema,
} from '@yikart/mongodb'
import { MediaclawConfigModule } from '../mediaclaw-config.module'
import { NotificationController } from './notification.controller'
import { NotificationService } from './notification.service'

@Module({
  imports: [
    MediaclawConfigModule,
    MongooseModule.forFeature([
      { name: NotificationConfig.name, schema: NotificationConfigSchema },
      { name: Notification.name, schema: NotificationSchema },
      { name: DiscoveryNotification.name, schema: DiscoveryNotificationSchema },
    ]),
  ],
  controllers: [NotificationController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
