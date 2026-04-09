import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq'
import { Injectable, Logger } from '@nestjs/common'
import { Job } from 'bullmq'
import {
  DiscoveryIngestionJobData,
  MEDIACLAW_DISCOVERY_JOB,
  MEDIACLAW_DISCOVERY_QUEUE,
} from './discovery.constants'
import { DiscoveryIngestionService } from './ingestion.service'

@Injectable()
@Processor(MEDIACLAW_DISCOVERY_QUEUE)
export class DiscoveryIngestionProcessor extends WorkerHost {
  private readonly logger = new Logger(DiscoveryIngestionProcessor.name)

  constructor(
    private readonly discoveryIngestionService: DiscoveryIngestionService,
  ) {
    super()
  }

  async process(job: Job<DiscoveryIngestionJobData>) {
    if (job.name !== MEDIACLAW_DISCOVERY_JOB) {
      this.logger.warn(`Unexpected discovery ingestion job received: ${job.name}`)
    }

    return this.discoveryIngestionService.processJob(job.data)
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<DiscoveryIngestionJobData>) {
    this.logger.debug(`Discovery ingestion completed: ${job?.id || 'unknown'}`)
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<DiscoveryIngestionJobData> | undefined, error: Error) {
    this.logger.error(`Discovery ingestion failed for ${job?.id || 'unknown'}: ${error.message}`)
  }
}
