import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  DeliveryRecord,
  DeliveryRecordSchema,
  EmployeeAssignment,
  EmployeeAssignmentSchema,
  PlatformAccount,
  PlatformAccountSchema,
  VideoTask,
  VideoTaskSchema,
} from '@yikart/mongodb'

import { EmployeeDispatchController } from './employee-dispatch.controller'
import { EmployeeDispatchService } from './employee-dispatch.service'
import { FeishuPushService } from './feishu-push.service'
import { WecomPushService } from './wecom-push.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: EmployeeAssignment.name, schema: EmployeeAssignmentSchema },
      { name: DeliveryRecord.name, schema: DeliveryRecordSchema },
      { name: PlatformAccount.name, schema: PlatformAccountSchema },
      { name: VideoTask.name, schema: VideoTaskSchema },
    ]),
  ],
  controllers: [EmployeeDispatchController],
  providers: [EmployeeDispatchService, FeishuPushService, WecomPushService],
  exports: [EmployeeDispatchService],
})
export class EmployeeDispatchModule {}
