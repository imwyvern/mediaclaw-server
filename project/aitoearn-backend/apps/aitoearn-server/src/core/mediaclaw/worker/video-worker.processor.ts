import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq'
import { Injectable, Logger, Optional } from '@nestjs/common'
import { VideoTaskStatus } from '@yikart/mongodb'
import { Job, Queue } from 'bullmq'
import { ContentMgmtService } from '../content-mgmt/content-mgmt.service'
import { CopyService } from '../copy/copy.service'
import { DistributionService } from '../distribution/distribution.service'
import { PipelineService } from '../pipeline/pipeline.service'
import { VideoService } from '../video/video.service'
import { VIDEO_WORKER_QUEUE, VideoWorkerJobData, VideoWorkerStep } from './worker.constants'

const NEXT_STEP_MAP: Partial<Record<VideoWorkerStep, VideoWorkerStep>> = {
  'analyze-source': 'edit-frames',
  'edit-frames': 'render-video',
  'render-video': 'quality-check',
  'quality-check': 'generate-copy',
}

@Injectable()
@Processor(VIDEO_WORKER_QUEUE)
export class VideoWorkerProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoWorkerProcessor.name)

  constructor(
    @InjectQueue(VIDEO_WORKER_QUEUE)
    private readonly workerQueue: Queue<VideoWorkerJobData>,
    private readonly videoService: VideoService,
    private readonly copyService: CopyService,
    private readonly distributionService: DistributionService,
    private readonly pipelineService?: PipelineService,
    @Optional()
    private readonly contentMgmtService?: ContentMgmtService,
  ) {
    super()
  }

  async process(job: Job<VideoWorkerJobData>): Promise<void> {
    const step = job.name as VideoWorkerStep
    const { taskId } = job.data
    let context = job.data.context

    try {
      const task = typeof this.videoService.getTaskForWorker === 'function'
        ? await this.videoService.getTaskForWorker(taskId)
        : await (this.videoService as unknown as { getTask: (id: string) => Promise<any> }).getTask(taskId)

      switch (step) {
        case 'analyze-source':
          await this.videoService.updateStatus(taskId, VideoTaskStatus.ANALYZING)
          context = await this.requirePipelineService().analyzeSource(task)
          break
        case 'edit-frames':
          await this.videoService.updateStatus(taskId, VideoTaskStatus.EDITING)
          context = await this.requirePipelineService().editFrames(this.requireContext(context))
          break
        case 'render-video':
          await this.videoService.updateStatus(taskId, VideoTaskStatus.RENDERING)
          context = await this.requirePipelineService().renderVideo(task, this.requireContext(context))
          await this.videoService.updateStatus(taskId, VideoTaskStatus.RENDERING, {
            outputVideoUrl: context.outputVideoUrl,
            deepSynthesis: context.deepSynthesisMarker?.manifest,
          })
          break
        case 'quality-check': {
          await this.videoService.updateStatus(taskId, VideoTaskStatus.QUALITY_CHECK)
          const report = await this.requirePipelineService().runQualityCheck(this.requireContext(context))
          await this.videoService.updateStatus(taskId, VideoTaskStatus.QUALITY_CHECK, {
            quality: report.metrics,
          })
          break
        }
        case 'generate-copy': {
          await this.videoService.updateStatus(taskId, VideoTaskStatus.GENERATING_COPY)
          const outputVideoUrl = context?.outputVideoUrl || task.outputVideoUrl || task.sourceVideoUrl
          const copy = await this.copyService.generateCopy(
            task.brandId?.toString(),
            outputVideoUrl,
            {
              ...task.metadata,
              taskId,
            },
          )
          const completedTask = await this.videoService.updateStatus(taskId, VideoTaskStatus.COMPLETED, {
            outputVideoUrl,
            quality: task.quality,
            copy,
          })
          if (completedTask) {
            const reviewAwareTask = this.contentMgmtService
              ? await this.contentMgmtService.initializeWorkflowForTask(taskId)
              : completedTask
            await this.distributionService.notifyTaskComplete(reviewAwareTask as any)
          }
          await this.pipelineService?.cleanupWorkspace(context)
          this.logger.log(`Video task completed: ${taskId}`)
          return
        }
        default:
          this.logger.warn(`Unknown worker step received: ${job.name}`)
          return
      }

      const nextStep = NEXT_STEP_MAP[step]
      if (!nextStep) {
        return
      }

      await this.workerQueue.add(
        nextStep,
        {
          taskId,
          context,
        },
        { jobId: `${taskId}:${nextStep}:${Date.now()}` },
      )
    }
    catch (error) {
      const attemptsMade = job.attemptsMade + 1
      const maxAttempts = job.opts.attempts ?? 1
      const message = error instanceof Error ? error.message : 'Unknown worker error'

      await this.videoService.recordRetry(taskId, attemptsMade, message)

      if (attemptsMade >= maxAttempts) {
        await this.videoService.updateStatus(taskId, VideoTaskStatus.FAILED, {
          errorMessage: message,
        })
        await this.pipelineService?.cleanupWorkspace(context)
      }

      throw error
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<VideoWorkerJobData>, error: Error) {
    this.logger.error(`Video worker failed for ${job?.data?.taskId}: ${error.message}`)
  }

  private requireContext(context: VideoWorkerJobData['context']) {
    if (!context) {
      throw new Error('Pipeline context is missing')
    }

    return context
  }

  private requirePipelineService() {
    if (!this.pipelineService) {
      throw new Error('Pipeline service is not configured')
    }

    return this.pipelineService
  }

  private async sleep() {
    return undefined
  }
}
