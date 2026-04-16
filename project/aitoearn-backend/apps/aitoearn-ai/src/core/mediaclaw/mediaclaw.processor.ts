import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import { QueueName, type MediaclawPipelineData } from '@yikart/aitoearn-queue'
import type { Job } from 'bullmq'
import { MediaclawService } from './mediaclaw.service'

@Processor(QueueName.MediaclawPipeline)
export class MediaclawProcessor extends WorkerHost {
  private readonly logger = new Logger(MediaclawProcessor.name)

  constructor(private readonly mediaclawService: MediaclawService) {
    super()
  }

  async process(job: Job<MediaclawPipelineData>): Promise<unknown> {
    const { pipelineType, input, taskId, userId } = job.data
    this.logger.log(`Processing mediaclaw pipeline: ${pipelineType} (task: ${taskId}, user: ${userId})`)

    try {
      await job.updateProgress(0)

      let result: unknown

      switch (pipelineType) {
        case 'product-showcase':
          result = await this.mediaclawService.runProductShowcase(input)
          break
        case 'ai-live':
          result = await this.mediaclawService.runAiLive(input)
          break
        case 'explainer':
          result = await this.mediaclawService.runExplainer(input)
          break
        default:
          throw new Error(`Unknown pipeline type: ${pipelineType}`)
      }

      await job.updateProgress(100)
      this.logger.log(`Pipeline ${pipelineType} completed: ${taskId}`)
      return result
    } catch (error) {
      this.logger.error(`Pipeline ${pipelineType} failed: ${taskId}`, error)
      throw error
    }
  }
}
