import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  DistributionRule,
  DistributionRuleSchema,
  VideoTask,
  VideoTaskSchema,
} from '@yikart/mongodb'
import { EmployeeDispatchModule } from '../employee-dispatch/employee-dispatch.module'
import { WebhookModule } from '../webhook/webhook.module'
import { DistributionController } from './distribution.controller'
import { DistributionService } from './distribution.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DistributionRule.name, schema: DistributionRuleSchema },
      { name: VideoTask.name, schema: VideoTaskSchema },
    ]),
    WebhookModule,
    EmployeeDispatchModule,
  ],
  controllers: [DistributionController],
  providers: [DistributionService],
  exports: [DistributionService],
})
export class DistributionModule {}
