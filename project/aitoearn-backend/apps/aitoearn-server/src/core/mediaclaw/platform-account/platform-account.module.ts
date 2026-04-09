import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  PlatformAccount,
  PlatformAccountSchema,
  PublishRecord,
  PublishRecordSchema,
  VideoTask,
  VideoTaskSchema,
} from '@yikart/mongodb'
import { NotificationModule } from '../notification/notification.module'
import { HealthMonitorService } from './health-monitor.service'
import { PlatformAccountController } from './platform-account.controller'
import { PlatformAccountService } from './platform-account.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PlatformAccount.name, schema: PlatformAccountSchema },
      { name: PublishRecord.name, schema: PublishRecordSchema },
      { name: VideoTask.name, schema: VideoTaskSchema },
    ]),
    NotificationModule,
  ],
  controllers: [PlatformAccountController],
  providers: [PlatformAccountService, HealthMonitorService],
  exports: [PlatformAccountService],
})
export class PlatformAccountModule {}
