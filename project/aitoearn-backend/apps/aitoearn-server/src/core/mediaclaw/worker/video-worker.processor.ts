import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq'
import { Injectable, Logger } from '@nestjs/common'
import { Queue, Job } from 'bullmq'
import { VideoTaskStatus } from '@yikart/mongodb'
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
  ) {
    super()
  }

  async process(job: Job<VideoWorkerJobData>): Promise<void> {
    const step = job.name as VideoWorkerStep
    const { taskId } = job.data

    try {
      const task = await this.videoService.getTask(taskId)

      switch (step) {
        case 'analyze-source':
          await this.videoService.updateStatus(taskId, VideoTaskStatus.ANALYZING)
          await this.sleep()
          break
        case 'edit-frames':
          await this.videoService.updateStatus(taskId, VideoTaskStatus.EDITING)
          await this.sleep()
          break
        case 'render-video':
          await this.videoService.updateStatus(taskId, VideoTaskStatus.RENDERING)
          await this.sleep()
          await this.videoService.updateStatus(taskId, VideoTaskStatus.RENDERING, {
            outputVideoUrl: task.outputVideoUrl || `${task.sourceVideoUrl}?processed=${taskId}`,
          })
          break
        case 'quality-check':
          await this.videoService.updateStatus(taskId, VideoTaskStatus.QUALITY_CHECK)
          await this.sleep()
          await this.videoService.updateStatus(taskId, VideoTaskStatus.QUALITY_CHECK, {
            quality: {
              width: 1080,
              height: 1920,
              duration: 15,
              fileSize: 1024 * 1024 * 8,
              hasSubtitles: true,
            },
          })
          break
        case 'generate-copy':
          await this.videoService.updateStatus(taskId, VideoTaskStatus.GENERATING_COPY)
          await this.sleep()
          await this.videoService.updateStatus(taskId, VideoTaskStatus.COMPLETED, {
            outputVideoUrl: task.outputVideoUrl || `${task.sourceVideoUrl}?processed=${taskId}`,
            quality: task.quality,
            copy: {
              title: `MediaClaw 视频任务 ${taskId}`,
              subtitle: '待接入品牌文案引擎',
              hashtags: ['#MediaClaw', '#VideoWorkflow'],
              commentGuide: '占位文案，后续由 Copy Engine 替换。',
            },
          })
          this.logger.log(`Video task completed: ${taskId}`)
          return
        default:
          this.logger.warn(`Unknown worker step received: ${job.name}`)
          return
      }

      const nextStep = NEXT_STEP_MAP[step]
      if (!nextStep) {
        return
      }

      await this.workerQueue.add(nextStep, { taskId }, { jobId: `${taskId}:${nextStep}` })
    } catch (error) {
      const attemptsMade = job.attemptsMade + 1
      const maxAttempts = job.opts.attempts ?? 1
      const message = error instanceof Error ? error.message : 'Unknown worker error'

      await this.videoService.recordRetry(taskId, attemptsMade, message)

      if (attemptsMade >= maxAttempts) {
        await this.videoService.updateStatus(taskId, VideoTaskStatus.FAILED, {
          errorMessage: message,
        })
      }

      throw error
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<VideoWorkerJobData>, error: Error) {
    this.logger.error(`Video worker failed for ${job?.data?.taskId}: ${error.message}`)
  }

  private async sleep() {
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
}
