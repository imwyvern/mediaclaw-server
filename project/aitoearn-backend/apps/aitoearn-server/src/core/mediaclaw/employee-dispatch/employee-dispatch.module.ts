import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  DeliveryRecord,
  DeliveryRecordSchema,
  EmployeeAssignment,
  EmployeeAssignmentSchema,
  ImSession,
  ImSessionSchema,
  PlatformAccount,
  PlatformAccountSchema,
  VideoTask,
  VideoTaskSchema,
} from '@yikart/mongodb'

import { ClawHostModule } from '../clawhost/clawhost.module'
import { DingtalkPushService } from './dingtalk-push.service'
import { EmployeeDispatchController } from './employee-dispatch.controller'
import { EmployeeDispatchService } from './employee-dispatch.service'
import { FeishuPushService } from './feishu-push.service'
import { ImChannelRegistryService } from './im-channel-registry.service'
import { ImDeliveryService } from './im-delivery.service'
import { ImSessionService } from './im-session.service'
import { TelegramPushService } from './telegram-push.service'
import { WecomPushService } from './wecom-push.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: EmployeeAssignment.name, schema: EmployeeAssignmentSchema },
      { name: DeliveryRecord.name, schema: DeliveryRecordSchema },
      { name: ImSession.name, schema: ImSessionSchema },
      { name: PlatformAccount.name, schema: PlatformAccountSchema },
      { name: VideoTask.name, schema: VideoTaskSchema },
    ]),
    ClawHostModule,
  ],
  controllers: [EmployeeDispatchController],
  providers: [
    EmployeeDispatchService,
    ImDeliveryService,
    ImSessionService,
    FeishuPushService,
    WecomPushService,
    DingtalkPushService,
    TelegramPushService,
    ImChannelRegistryService,
  ],
  exports: [EmployeeDispatchService],
})
export class EmployeeDispatchModule {}
