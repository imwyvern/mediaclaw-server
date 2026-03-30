import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  NotificationConfig,
  NotificationConfigSchema,
} from '@yikart/mongodb'
import { NotificationController } from './notification.controller'
import { NotificationService } from './notification.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: NotificationConfig.name, schema: NotificationConfigSchema },
    ]),
  ],
  controllers: [NotificationController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
