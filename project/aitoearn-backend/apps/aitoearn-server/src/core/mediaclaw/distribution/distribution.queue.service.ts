import { InjectQueue } from '@nestjs/bullmq'
import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common'
import { Queue } from 'bullmq'

import {
  DISTRIBUTION_JOB_DISPATCH_COMPLETED,
  DISTRIBUTION_JOB_EXPIRE_STALE,
  DistributionJobData,
  MEDIACLAW_DISTRIBUTION_EXPIRE_CRON,
  MEDIACLAW_DISTRIBUTION_EXPIRE_SCHEDULER,
  MEDIACLAW_DISTRIBUTION_QUEUE,
} from './distribution.queue.constants'

@Injectable()
export class DistributionQueueService implements OnModuleInit {
  private readonly logger = new Logger(DistributionQueueService.name)

  constructor(
    @InjectQueue(MEDIACLAW_DISTRIBUTION_QUEUE)
    private readonly distributionQueue: Queue<DistributionJobData>,
  ) {}

  async onModuleInit() {
    await this.distributionQueue.upsertJobScheduler(
      MEDIACLAW_DISTRIBUTION_EXPIRE_SCHEDULER,
      {
        pattern: MEDIACLAW_DISTRIBUTION_EXPIRE_CRON,
      },
      {
        name: DISTRIBUTION_JOB_EXPIRE_STALE,
        data: {
          trigger: 'scheduled',
          source: 'bullmq-scheduler',
        },
        opts: {
          removeOnComplete: 20,
          removeOnFail: 20,
        },
      },
    )
  }

  async enqueueCompletedTask(taskId: string) {
    const normalizedTaskId = taskId.trim()
    if (!normalizedTaskId) {
      throw new BadRequestException('taskId is required')
    }

    const job = await this.distributionQueue.add(
      DISTRIBUTION_JOB_DISPATCH_COMPLETED,
      {
        taskId: normalizedTaskId,
        trigger: 'task-completed',
        requestedAt: new Date().toISOString(),
        source: 'video-worker',
      },
      {
        jobId: `${DISTRIBUTION_JOB_DISPATCH_COMPLETED}:${normalizedTaskId}`,
      },
    )

    this.logger.log(`Queued distribution dispatch job for task ${normalizedTaskId}`)

    return {
      queued: true,
      jobId: String(job.id || ''),
      queueName: MEDIACLAW_DISTRIBUTION_QUEUE,
      taskId: normalizedTaskId,
    }
  }
}
