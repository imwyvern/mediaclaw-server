import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Injectable, Logger } from '@nestjs/common'
import { Job } from 'bullmq'

import {
  DISTRIBUTION_JOB_DISPATCH_COMPLETED,
  DISTRIBUTION_JOB_EXPIRE_STALE,
  DistributionJobData,
  MEDIACLAW_DISTRIBUTION_QUEUE,
} from './distribution.queue.constants'
import { DistributionService } from './distribution.service'

@Injectable()
@Processor(MEDIACLAW_DISTRIBUTION_QUEUE)
export class DistributionWorker extends WorkerHost {
  private readonly logger = new Logger(DistributionWorker.name)

  constructor(private readonly distributionService: DistributionService) {
    super()
  }

  async process(job: Job<DistributionJobData>) {
    switch (job.name) {
      case DISTRIBUTION_JOB_DISPATCH_COMPLETED: {
        const taskId = job.data.taskId?.trim() || ''
        if (!taskId) {
          throw new Error('distribution dispatch job requires taskId')
        }

        return this.distributionService.processCompletedTask(taskId)
      }
      case DISTRIBUTION_JOB_EXPIRE_STALE:
        return this.distributionService.expireStaleDistributions()
      default:
        this.logger.warn(`Unknown distribution job received: ${job.name}`)
        return null
    }
  }
}
