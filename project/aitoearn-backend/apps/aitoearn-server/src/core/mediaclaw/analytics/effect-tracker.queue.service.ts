import { InjectQueue } from '@nestjs/bullmq'
import { Injectable, OnModuleInit } from '@nestjs/common'
import { Queue } from 'bullmq'

import {
  EFFECT_TRACKER_COHORT_WINDOWS,
  EFFECT_TRACKER_JOB_COLLECT,
  EffectTrackerJobData,
  MEDIACLAW_EFFECT_TRACKER_QUEUE,
} from './effect-tracker.constants'

@Injectable()
export class EffectTrackerQueueService implements OnModuleInit {
  constructor(
    @InjectQueue(MEDIACLAW_EFFECT_TRACKER_QUEUE)
    private readonly effectTrackerQueue: Queue<EffectTrackerJobData>,
  ) {}

  async onModuleInit() {
    for (const window of EFFECT_TRACKER_COHORT_WINDOWS) {
      await this.effectTrackerQueue.upsertJobScheduler(
        window.schedulerId,
        {
          pattern: window.cron,
        },
        {
          name: EFFECT_TRACKER_JOB_COLLECT,
          data: {
            cohort: window.cohort,
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
  }
}
