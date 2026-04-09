import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq'
import { Injectable, Logger } from '@nestjs/common'
import { Job } from 'bullmq'

import {
  EFFECT_TRACKER_JOB_COLLECT,
  EffectTrackerJobData,
  MEDIACLAW_EFFECT_TRACKER_QUEUE,
} from './effect-tracker.constants'
import { EffectTrackerService } from './effect-tracker.service'

@Injectable()
@Processor(MEDIACLAW_EFFECT_TRACKER_QUEUE)
export class EffectTrackerWorker extends WorkerHost {
  private readonly logger = new Logger(EffectTrackerWorker.name)

  constructor(private readonly effectTrackerService: EffectTrackerService) {
    super()
  }

  async process(job: Job<EffectTrackerJobData>) {
    if (job.name !== EFFECT_TRACKER_JOB_COLLECT) {
      this.logger.warn(`Unexpected effect tracker job received: ${job.name}`)
    }

    return this.effectTrackerService.trackWindow(job.data.cohort)
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<EffectTrackerJobData>) {
    this.logger.debug(`Effect tracking completed: ${job?.id || 'unknown'}`)
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<EffectTrackerJobData> | undefined, error: Error) {
    this.logger.error(`Effect tracking failed for ${job?.id || 'unknown'}: ${error.message}`)
  }
}
