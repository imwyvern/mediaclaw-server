import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  DistributionRule,
  DistributionRuleSchema,
  Pipeline,
  PipelineSchema,
  VideoTask,
  VideoTaskSchema,
} from '@yikart/mongodb'

import { EmployeeDispatchModule } from '../employee-dispatch/employee-dispatch.module'
import { NotificationModule } from '../notification/notification.module'
import { WebhookModule } from '../webhook/webhook.module'
import { DistributionController } from './distribution.controller'
import { DistributionService } from './distribution.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DistributionRule.name, schema: DistributionRuleSchema },
      { name: VideoTask.name, schema: VideoTaskSchema },
      { name: Pipeline.name, schema: PipelineSchema },
    ]),
    WebhookModule,
    EmployeeDispatchModule,
    NotificationModule,
  ],
  controllers: [DistributionController],
  providers: [DistributionService],
  exports: [DistributionService],
})
export class DistributionModule {}
