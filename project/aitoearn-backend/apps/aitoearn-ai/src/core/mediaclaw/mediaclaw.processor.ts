import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import { QueueName, type MediaclawPipelineData } from '@yikart/aitoearn-queue'
import type { PipelineEvent } from '@yikart/mediaclaw-agent-runtime'
import type { Job } from 'bullmq'
import { AiLiveDtoSchema, ExplainerDtoSchema, ProductShowcaseDtoSchema } from './mediaclaw.dto'
import { MediaclawService } from './mediaclaw.service'

interface MediaclawJobProgress {
  percentage: number
  status: 'running' | 'completed' | 'failed'
  message: string
  step?: string
  toolId?: string
  toolStatus?: PipelineEvent['status']
}

@Processor(QueueName.MediaclawPipeline)
export class MediaclawProcessor extends WorkerHost {
  private readonly logger = new Logger(MediaclawProcessor.name)

  constructor(private readonly mediaclawService: MediaclawService) {
    super()
  }

  async process(job: Job<MediaclawPipelineData>): Promise<unknown> {
    const { pipelineType, taskId, userId } = job.data
    this.logger.log(`Processing mediaclaw pipeline: ${pipelineType} (task: ${taskId}, user: ${userId})`)

    try {
      await this.updateJobProgress(job, {
        percentage: 0,
        status: 'running',
        message: 'Pipeline started',
      })

      const result = await this.executePipeline(job)

      await this.updateJobProgress(job, {
        percentage: 100,
        status: 'completed',
        message: 'Pipeline completed',
      })

      this.logger.log(`Pipeline ${pipelineType} completed: ${taskId}`)
      return result
    } catch (error: unknown) {
      const currentProgress = this.getExistingProgress(job)
      await this.updateJobProgress(job, {
        percentage: currentProgress.percentage ?? 0,
        status: 'failed',
        message: this.getErrorMessage(error),
        step: currentProgress.step,
        toolId: currentProgress.toolId,
      })

      this.logger.error(
        `Pipeline ${pipelineType} failed: ${taskId} - ${this.getErrorMessage(error)}`,
        error instanceof Error ? error.stack : undefined,
      )

      throw error
    }
  }

  private async executePipeline(job: Job<MediaclawPipelineData>): Promise<unknown> {
    const { pipelineType, input } = job.data

    switch (pipelineType) {
      case 'product-showcase':
        return await this.mediaclawService.runProductShowcase(
          ProductShowcaseDtoSchema.parse(input),
          async (event) => this.reportPipelineEvent(job, event),
        )
      case 'ai-live':
        return await this.mediaclawService.runAiLive(AiLiveDtoSchema.parse(input))
      case 'explainer':
        return await this.mediaclawService.runExplainer(ExplainerDtoSchema.parse(input))
      default: {
        const unreachable: never = pipelineType
        throw new Error(`Unknown pipeline type: ${String(unreachable)}`)
      }
    }
  }

  private async reportPipelineEvent(
    job: Job<MediaclawPipelineData>,
    event: PipelineEvent,
  ): Promise<void> {
    await this.updateJobProgress(job, {
      percentage: this.calculateProgress(event.step),
      status: 'running',
      message: event.message,
      step: event.step,
      toolId: event.toolId,
      toolStatus: event.status,
    })
  }

  private async updateJobProgress(
    job: Job<MediaclawPipelineData>,
    progress: MediaclawJobProgress,
  ): Promise<void> {
    await job.updateProgress(progress)
  }

  private calculateProgress(step: string): number {
    const matched = /^(\d+)\/(\d+)$/.exec(step)
    if (!matched) {
      return 0
    }

    const current = Number(matched[1])
    const total = Number(matched[2])
    if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) {
      return 0
    }

    return Math.min(99, Math.max(0, Math.round((current / total) * 100)))
  }

  private getExistingProgress(job: Job<MediaclawPipelineData>): Partial<MediaclawJobProgress> {
    const progress = job.progress
    if (typeof progress !== 'object' || progress === null) {
      return {}
    }

    const record = progress as Record<string, unknown>
    return {
      percentage: typeof record['percentage'] === 'number' ? record['percentage'] : undefined,
      step: typeof record['step'] === 'string' ? record['step'] : undefined,
      toolId: typeof record['toolId'] === 'string' ? record['toolId'] : undefined,
    }
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }
}
