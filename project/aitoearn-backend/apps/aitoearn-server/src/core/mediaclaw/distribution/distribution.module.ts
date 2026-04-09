import { BullModule } from '@nestjs/bullmq'
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
import { MEDIACLAW_DISTRIBUTION_QUEUE } from './distribution.queue.constants'
import { DistributionQueueService } from './distribution.queue.service'
import { DistributionService } from './distribution.service'
import { DistributionWorker } from './distribution.worker'

@Module({
  imports: [
    BullModule.registerQueue({
      name: MEDIACLAW_DISTRIBUTION_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'fixed',
          delay: 1000,
        },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    }),
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
  providers: [DistributionService, DistributionQueueService, DistributionWorker],
  exports: [DistributionService],
})
export class DistributionModule {}
