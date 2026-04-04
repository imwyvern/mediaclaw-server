import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq'
import { Injectable, Logger, Optional } from '@nestjs/common'
import { VideoTask, VideoTaskStatus } from '@yikart/mongodb'
import { Job, Queue } from 'bullmq'
import { ContentMgmtService } from '../content-mgmt/content-mgmt.service'
import { CopyService } from '../copy/copy.service'
import { DistributionService } from '../distribution/distribution.service'
import { PipelineService } from '../pipeline/pipeline.service'
import type { PipelineJobContext } from '../pipeline/pipeline.types'
import { PromptOptimizerLoopService } from '../prompt-optimizer/prompt-optimizer.service'
import { VideoService } from '../video/video.service'
import { VIDEO_WORKER_QUEUE, VideoWorkerJobData, VideoWorkerStep } from './worker.constants'

const NEXT_STEP_MAP: Partial<Record<VideoWorkerStep, VideoWorkerStep>> = {
  'analyze-source': 'edit-frames',
  'edit-frames': 'render-video',
  'render-video': 'generate-copy',
  'generate-copy': 'quality-check',
}

type LegacyVideoTaskReader = {
  getTask: (id: string) => Promise<VideoTask>
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
    @Optional()
    private readonly promptOptimizerService?: PromptOptimizerLoopService,
  ) {
    super()
  }

  async process(job: Job<VideoWorkerJobData>): Promise<void> {
    const step = job.name as VideoWorkerStep
    const { taskId } = job.data
    let context = job.data.context
    let completedTask: Awaited<ReturnType<VideoService['updateStatus']>> | null = null

    await this.videoService.startIterationStep(taskId, step, {
      attempt: job.attemptsMade + 1,
      hasContext: Boolean(context),
    })

    try {
      const task = await this.loadWorkerTask(taskId)

      switch (step) {
        case 'analyze-source':
          await this.videoService.updateStatus(taskId, VideoTaskStatus.ANALYZING, { step })
          context = await this.requirePipelineService().analyzeSource(task)
          break
        case 'edit-frames':
          await this.videoService.updateStatus(taskId, VideoTaskStatus.EDITING, { step })
          context = await this.requirePipelineService().editFrames(this.requireContext(context))
          break
        case 'render-video':
          await this.videoService.updateStatus(taskId, VideoTaskStatus.RENDERING, { step })
          context = await this.requirePipelineService().renderVideo(task, this.requireContext(context))
          await this.videoService.updateStatus(taskId, VideoTaskStatus.RENDERING, {
            step,
            outputVideoUrl: context.outputVideoUrl,
            metadata: {
              pipeline: {
                brandEdit: context.brandEditResult || null,
                videoGeneration: context.videoGenResult || null,
              },
            },
          })
          break
        case 'generate-copy': {
          await this.videoService.updateStatus(taskId, VideoTaskStatus.GENERATING_COPY, { step })
          const outputVideoUrl = context?.outputVideoUrl || task.outputVideoUrl || task.sourceVideoUrl
          const copy = await this.copyService.generateCopy(
            task.brandId?.toString(),
            outputVideoUrl,
            {
              ...task.metadata,
              taskId,
              userId: task.userId,
              orgId: task.orgId?.toString() || null,
              brandId: task.brandId?.toString() || null,
            },
          )
          context = await this.requirePipelineService().finalizeVideo(task, this.requireContext(context), copy)
          await this.videoService.updateStatus(taskId, VideoTaskStatus.GENERATING_COPY, {
            step,
            outputVideoUrl: context.outputVideoUrl,
            copy,
            deepSynthesis: context.deepSynthesisMarker?.manifest,
            metadata: {
              pipeline: {
                brandEdit: context.brandEditResult || null,
                videoGeneration: context.videoGenResult || null,
              },
            },
          })
          break
        }
        case 'quality-check': {
          await this.videoService.updateStatus(taskId, VideoTaskStatus.QUALITY_CHECK, { step })
          const report = await this.requirePipelineService().runQualityCheck(this.requireContext(context))
          context = {
            ...this.requireContext(context),
            qualityReport: report,
          }
          completedTask = await this.videoService.updateStatus(taskId, VideoTaskStatus.COMPLETED, {
            step,
            outputVideoUrl: context.outputVideoUrl,
            quality: report.metrics,
            copy: task.copy,
            deepSynthesis: context.deepSynthesisMarker?.manifest,
          })
          break
        }
        default:
          this.logger.warn(`Unknown worker step received: ${job.name}`)
          return
      }

      await this.videoService.completeIterationStep(taskId, step, this.buildStepOutput(step, context))
      await this.videoService.updateTaskMetadata(taskId, {
        pipelineContext: this.serializeContext(context),
        failedStep: null,
      })

      const nextStep = NEXT_STEP_MAP[step]
      if (!nextStep) {
        if (step === 'quality-check' && completedTask) {
          const reviewAwareTask = this.contentMgmtService
            ? await this.contentMgmtService.initializeWorkflowForTask(taskId)
            : completedTask
          await this.distributionService.notifyTaskComplete(reviewAwareTask as VideoTask)
          this.logger.log(`Video task completed: ${taskId}`)
        }

        await this.pipelineService?.cleanupWorkspace(context)
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
      await this.videoService.failIterationStep(taskId, step, message, this.buildStepOutput(step, context))
      await this.videoService.updateTaskMetadata(taskId, {
        pipelineContext: this.serializeContext(context),
        failedStep: step,
      })

      if (attemptsMade >= maxAttempts) {
        const handledByPromptOptimizer = step === 'quality-check'
          ? await this.handleQualityCheckFailure(taskId, context, message).catch((optimizerError) => {
              this.logger.warn(
                `Prompt optimizer worker handling failed for ${taskId}: ${optimizerError instanceof Error ? optimizerError.message : String(optimizerError)}`,
              )
              return false
            })
          : false

        if (!handledByPromptOptimizer) {
          await this.videoService.updateStatus(taskId, VideoTaskStatus.FAILED, {
            errorMessage: message,
            step,
            metadata: {
              failedStep: step,
            },
          })

          if (context) {
            await this.pipelineService?.cleanupWorkspace(context)
          }
        }
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

  private async loadWorkerTask(taskId: string) {
    if (typeof this.videoService.getTaskForWorker === 'function') {
      return this.videoService.getTaskForWorker(taskId)
    }

    return (this.videoService as unknown as LegacyVideoTaskReader).getTask(taskId)
  }

  private buildStepOutput(step: VideoWorkerStep, context: VideoWorkerJobData['context']) {
    if (!context) {
      return {}
    }

    switch (step) {
      case 'analyze-source':
        return {
          durationSeconds: context.sourceMetadata?.durationSeconds || 0,
          renderWidth: context.renderWidth,
          renderHeight: context.renderHeight,
          frameCount: context.frameArtifacts?.length || 0,
        }
      case 'edit-frames':
        return {
          frameCount: context.frameArtifacts?.length || 0,
          brandName: context.brand?.name || '',
          brandEditStatus: context.brandEditResult?.status || 'completed',
          brandEditReason: context.brandEditResult?.reason || '',
        }
      case 'render-video':
        return {
          outputVideoUrl: context.outputVideoUrl || '',
          segmentCount: context.segmentVideoPaths?.length || 0,
          videoGenStatus: context.videoGenResult?.status || 'completed',
          videoGenReason: context.videoGenResult?.reason || '',
        }
      case 'generate-copy':
        return {
          outputVideoUrl: context.outputVideoUrl || '',
          finalVideoPath: context.finalVideoPath || '',
        }
      case 'quality-check':
        return {
          finalVideoPath: context.finalVideoPath || '',
          qualityPassed: context.qualityReport?.passed ?? false,
          qualityErrors: context.qualityReport?.errors || [],
        }
      default:
        return {}
    }
  }

  private serializeContext(context: VideoWorkerJobData['context']) {
    if (!context) {
      return null
    }

    return JSON.parse(JSON.stringify(context))
  }

  private async handleQualityCheckFailure(
    taskId: string,
    context: VideoWorkerJobData['context'],
    errorMessage: string,
  ) {
    if (!this.promptOptimizerService || !context) {
      return false
    }

    const originalPrompt = this.resolveOriginalPrompt(context)
    const analysis = await this.promptOptimizerService.analyzeFailure(
      taskId,
      'quality_check',
      originalPrompt,
      { message: errorMessage },
    )

    await this.promptOptimizerService.logIteration(taskId, 'quality_check', {
      status: 'failed',
      originalPrompt,
      optimizedPrompt: analysis.optimizedPrompt,
      failureAnalysis: analysis.failureAnalysis,
      qualityScore: analysis.qualityScore,
      strategyUsed: 'default',
      metadata: {
        source: 'video-worker',
        workerStep: 'quality-check',
        errorMessage,
      },
    })

    const retryDecision = await this.promptOptimizerService.shouldRetry(taskId)
    if (!retryDecision.shouldRetry) {
      await this.videoService.updateStatus(taskId, VideoTaskStatus.FAILED, {
        errorMessage,
        step: 'quality-check',
        metadata: {
          failedStep: 'quality-check',
          promptOptimizerHandled: true,
          retryStrategy: retryDecision.strategy,
        },
      })
      return true
    }

    const retryStep: VideoWorkerStep = retryDecision.strategy === 'fallback_strategy'
      ? 'edit-frames'
      : 'render-video'
    const retryContext = this.buildRetryContext(
      context,
      retryStep,
      analysis.optimizedPrompt,
      retryDecision.strategy,
    )

    await this.videoService.appendPromptFix(taskId, {
      originalPrompt,
      optimizedPrompt: analysis.optimizedPrompt,
      failureReason: analysis.failReason,
      retriedAt: new Date(),
      result: retryDecision.strategy,
    })
    await this.videoService.updateTaskMetadata(taskId, {
      pipelineContext: this.serializeContext(retryContext),
      failedStep: null,
      retryStrategy: retryDecision.strategy,
      retrySource: 'prompt-optimizer-worker',
    })
    await this.videoService.updateStatus(taskId, VideoTaskStatus.PENDING, {
      step: retryStep,
      errorMessage: '',
      metadata: {
        failedStep: null,
        retryStrategy: retryDecision.strategy,
        promptOptimizerHandled: true,
      },
    })
    await this.workerQueue.add(
      retryStep,
      {
        taskId,
        context: retryContext,
      },
      {
        jobId: `${taskId}:${retryStep}:prompt-optimizer:${Date.now()}`,
      },
    )

    return true
  }

  private resolveOriginalPrompt(context: VideoWorkerJobData['context']) {
    if (!context) {
      return 'Improve visual quality, pacing, subtitle alignment, and brand consistency while preserving the source intent.'
    }

    return context.prompts['render-video']
      || context.prompts['edit-frames']
      || context.prompts['generate-copy']
      || 'Improve visual quality, pacing, subtitle alignment, and brand consistency while preserving the source intent.'
  }

  private buildRetryContext(
    context: PipelineJobContext,
    retryStep: VideoWorkerStep,
    optimizedPrompt: string,
    strategy: 'retry_optimized' | 'fallback_strategy' | 'needs_manual_review',
  ): PipelineJobContext {
    const nextPrompts = {
      ...(context?.prompts || {}),
      [retryStep]: optimizedPrompt,
      'quality-check': `retry_strategy:${strategy}`,
    }

    if (retryStep === 'edit-frames') {
      nextPrompts['render-video'] = optimizedPrompt
    }

    return {
      ...context,
      prompts: nextPrompts,
      qualityReport: undefined,
    }
  }
}
