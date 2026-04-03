import { InjectQueue } from '@nestjs/bullmq'
import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import {
  IterationFailureCategory,
  IterationLog,
  IterationLogStage,
  IterationLogStatus,
  VideoTask,
  VideoTaskStatus,
} from '@yikart/mongodb'
import { Queue } from 'bullmq'
import { Model, Types } from 'mongoose'
import {
  VIDEO_WORKER_QUEUE,
  VideoWorkerJobData,
  VideoWorkerStep,
} from '../worker/worker.constants'

type PromptOptimizerRetryStrategy =
  | 'retry_optimized'
  | 'fallback_strategy'
  | 'needs_manual_review'

interface PromptOptimizerFailureAnalysis {
  failReason: string
  failCategory: IterationFailureCategory
  suggestedFixes: string[]
  confidence: number
}

interface PromptOptimizerQualityScore {
  total: number
  production: number
  virality: number
  dimensions: Record<string, number>
}

interface LogIterationInput {
  iteration?: number
  status: IterationLogStatus
  originalPrompt?: string
  optimizedPrompt?: string
  failureAnalysis?: PromptOptimizerFailureAnalysis | null
  qualityScore?: PromptOptimizerQualityScore | null
  costCredits?: number
  durationMs?: number
  strategyUsed?: string
  metadata?: Record<string, unknown>
}

export interface PromptOptimizerFailureResult {
  videoTaskId: string
  batchId?: string | null
  iteration: number
  stage: IterationLogStage
  originalPrompt: string
  optimizedPrompt: string
  failReason: string
  failCategory: IterationFailureCategory
  suggestedFixes: string[]
  confidence: number
  qualityScore?: PromptOptimizerQualityScore | null
  failureAnalysis: PromptOptimizerFailureAnalysis
}

@Injectable()
export class PromptOptimizerLoopService {
  private readonly logger = new Logger(PromptOptimizerLoopService.name)

  constructor(
    @InjectModel(IterationLog.name)
    private readonly iterationLogModel: Model<IterationLog>,
    @InjectModel(VideoTask.name)
    private readonly videoTaskModel: Model<VideoTask>,
    @InjectQueue(VIDEO_WORKER_QUEUE)
    @Optional()
    private readonly workerQueue?: Queue<VideoWorkerJobData>,
  ) {}

  async analyzeFailure(
    videoTaskId: string,
    stageInput: string,
    originalPromptInput?: string,
    errorOrQualityResult?: unknown,
  ): Promise<PromptOptimizerFailureResult> {
    const task = await this.getTask(videoTaskId)
    const stage = this.toIterationStage(stageInput)
    const originalPrompt =
      originalPromptInput?.trim() || this.readOriginalPrompt(task, stage)
    const qualityScore = this.extractQualityScore(errorOrQualityResult, task)
    const errorMessage = this.readErrorMessage(task, errorOrQualityResult)
    const failCategory = this.resolveFailureCategory(errorMessage, qualityScore)
    const failReason = this.resolveFailureReason(errorMessage, failCategory)
    const suggestedFixes = this.buildSuggestedFixes(stage, failCategory)
    const confidence = this.resolveConfidence(failCategory, qualityScore)
    const optimizedPrompt = await this.optimizePrompt(originalPrompt, {
      stage,
      failCategory,
      failReason,
      suggestedFixes,
    })

    return {
      videoTaskId,
      batchId: task.batchId?.toString() || null,
      iteration: (await this.resolveCurrentIteration(videoTaskId)) + 1,
      stage,
      originalPrompt,
      optimizedPrompt,
      failReason,
      failCategory,
      suggestedFixes,
      confidence,
      qualityScore,
      failureAnalysis: {
        failReason,
        failCategory,
        suggestedFixes,
        confidence,
      },
    }
  }

  async optimizePrompt(
    originalPrompt: string,
    failureAnalysis: {
      stage: IterationLogStage
      failCategory: IterationFailureCategory
      failReason: string
      suggestedFixes: string[]
    },
  ) {
    const basePrompt = originalPrompt.trim()
    const guidance: string[] = []

    switch (failureAnalysis.failCategory) {
      case 'quality':
        guidance.push('Increase output fidelity, readability, and pacing stability.')
        guidance.push('Preserve platform-safe subtitles and stronger visual consistency.')
        break
      case 'content':
        guidance.push('Constrain the output to the requested topic, audience, and intent.')
        guidance.push('Remove irrelevant narrative branches and keep the message single-threaded.')
        break
      case 'brand_mismatch':
        guidance.push('Lock brand colors, slogans, tone, logo placement, and prohibited wording.')
        guidance.push('Reject outputs that drift from approved brand assets or product facts.')
        break
      default:
        guidance.push('Shorten the instruction path and make the output format deterministic.')
        guidance.push('Reduce ambiguity and prefer stable provider-friendly wording.')
        break
    }

    return [
      basePrompt,
      '',
      '[Optimization patch]',
      `Stage: ${failureAnalysis.stage}`,
      `Failure: ${failureAnalysis.failReason}`,
      ...guidance.map((item) => `- ${item}`),
      ...failureAnalysis.suggestedFixes.map((item) => `- ${item}`),
      '- Add negative constraints for low-quality, off-topic, or unstable output patterns.',
      'TODO: replace this heuristic optimizer with an LLM-based prompt refinement flow.',
    ]
      .filter(Boolean)
      .join('\n')
      .trim()
  }

  async shouldRetry(videoTaskId: string) {
    const currentIteration = await this.resolveCurrentIteration(videoTaskId)

    if (currentIteration < 2) {
      return {
        currentIteration,
        shouldRetry: true,
        strategy: 'retry_optimized' as PromptOptimizerRetryStrategy,
      }
    }

    if (currentIteration === 2) {
      return {
        currentIteration,
        shouldRetry: true,
        strategy: 'fallback_strategy' as PromptOptimizerRetryStrategy,
      }
    }

    return {
      currentIteration,
      shouldRetry: false,
      strategy: 'needs_manual_review' as PromptOptimizerRetryStrategy,
    }
  }

  async logIteration(
    videoTaskId: string,
    stageInput: string,
    input: LogIterationInput,
  ) {
    const task = await this.getTask(videoTaskId)
    const stage = this.toIterationStage(stageInput)
    const iteration = input.iteration || (await this.resolveCurrentIteration(videoTaskId)) + 1

    const created = await this.iterationLogModel.create({
      videoTaskId,
      batchId: task.batchId?.toString() || '',
      iteration,
      stage,
      status: input.status,
      originalPrompt: input.originalPrompt || '',
      optimizedPrompt: input.optimizedPrompt || '',
      failureAnalysis: input.failureAnalysis || null,
      qualityScore: input.qualityScore || null,
      costCredits: Number(input.costCredits || 0),
      durationMs: Number(input.durationMs || 0),
      strategyUsed: input.strategyUsed || 'default',
      metadata: input.metadata || {},
    })

    return this.toIterationLogResponse(created.toObject())
  }

  async getIterationHistory(videoTaskId: string) {
    const items = await this.iterationLogModel
      .find({ videoTaskId })
      .sort({ iteration: 1, createdAt: 1 })
      .lean()
      .exec()

    return items.map((item) => this.toIterationLogResponse(item))
  }

  async getBatchIterationSummary(batchId: string) {
    const normalizedBatchId = batchId.trim()
    if (!normalizedBatchId) {
      throw new BadRequestException('batchId is required')
    }

    const batchObjectId = Types.ObjectId.isValid(normalizedBatchId)
      ? new Types.ObjectId(normalizedBatchId)
      : null

    const [logs, tasks] = await Promise.all([
      this.iterationLogModel.find({ batchId: normalizedBatchId }).lean().exec(),
      batchObjectId
        ? this.videoTaskModel.find({ batchId: batchObjectId }).lean().exec()
        : Promise.resolve([]),
    ])

    const taskIds = new Set<string>()
    const successfulTaskIds = new Set<string>()
    const failureCategories = new Map<string, number>()
    const iterationsToSuccess: number[] = []

    for (const log of logs) {
      taskIds.add(log.videoTaskId)
      const category = log.failureAnalysis?.failCategory
      if (category) {
        failureCategories.set(category, (failureCategories.get(category) || 0) + 1)
      }
    }

    for (const task of tasks) {
      const taskId = task._id.toString()
      taskIds.add(taskId)
      if (this.isSuccessfulTaskStatus(task.status)) {
        successfulTaskIds.add(taskId)
      }
    }

    for (const taskId of successfulTaskIds) {
      const taskLogs = logs.filter((item) => item.videoTaskId === taskId)
      if (taskLogs.length === 0) {
        continue
      }

      const maxIteration = Math.max(...taskLogs.map((item) => Number(item.iteration || 0)))
      if (maxIteration > 0) {
        iterationsToSuccess.push(maxIteration)
      }
    }

    const avgIterationsToSuccess = iterationsToSuccess.length > 0
      ? Number(
          (
            iterationsToSuccess.reduce((sum, value) => sum + value, 0) /
            iterationsToSuccess.length
          ).toFixed(2),
        )
      : 0

    return {
      batchId: normalizedBatchId,
      totalIterations: logs.length,
      totalTasks: taskIds.size,
      successfulTasks: successfulTaskIds.size,
      successRate:
        taskIds.size > 0
          ? Number(((successfulTaskIds.size / taskIds.size) * 100).toFixed(2))
          : 0,
      commonFailureCategories: Array.from(failureCategories.entries())
        .sort((left, right) => right[1] - left[1])
        .map(([category, count]) => ({ category, count })),
      avgIterationsToSuccess,
    }
  }

  async queueRetryWithOptimizedPrompt(
    videoTaskId: string,
    stageInput: string,
    optimizedPrompt: string,
    strategy: PromptOptimizerRetryStrategy,
  ) {
    const task = await this.getTask(videoTaskId)

    if (!this.workerQueue) {
      this.logger.warn(`Prompt optimizer queue unavailable for ${videoTaskId}`)
      return {
        queued: false,
        reason: 'worker_queue_unavailable',
      }
    }

    const pipelineContext = this.readPipelineContext(task)
    if (!pipelineContext) {
      this.logger.warn(`Prompt optimizer context unavailable for ${videoTaskId}`)
      return {
        queued: false,
        reason: 'pipeline_context_missing',
      }
    }

    const stage = this.toIterationStage(stageInput)
    const retryStep = this.resolveRetryStep(stage, strategy)
    const nextContext = this.buildRetryContext(
      pipelineContext,
      retryStep,
      optimizedPrompt,
      strategy,
    )

    await this.videoTaskModel
      .findByIdAndUpdate(task._id, {
        $set: {
          status: VideoTaskStatus.PENDING,
          errorMessage: '',
          completedAt: null,
          'metadata.failedStep': null,
          'metadata.pipelineContext': nextContext,
          'metadata.retryStrategy': strategy,
          'metadata.retrySource': 'prompt-optimizer',
          [`metadata.optimizedPrompts.${retryStep}`]: optimizedPrompt,
          'metadata.promptOptimizer.lastRetry': {
            strategy,
            retryStep,
            retriedAt: new Date().toISOString(),
          },
        },
        $push: {
          promptFixes: {
            originalPrompt: this.readOriginalPrompt(task, stage),
            optimizedPrompt,
            failureReason: task.errorMessage || 'quality check failed',
            retriedAt: new Date(),
            result: strategy,
          },
        },
      })
      .exec()

    await this.workerQueue.add(
      retryStep,
      {
        taskId: task._id.toString(),
        context: nextContext,
      },
      {
        jobId: `${task._id.toString()}:${retryStep}:optimizer:${Date.now()}`,
      },
    )

    return {
      queued: true,
      retryStep,
      strategy,
    }
  }

  private async getTask(videoTaskId: string) {
    if (!Types.ObjectId.isValid(videoTaskId)) {
      throw new BadRequestException('videoTaskId is invalid')
    }

    const task = await this.videoTaskModel.findById(new Types.ObjectId(videoTaskId)).exec()
    if (!task) {
      throw new BadRequestException('Video task not found')
    }

    return task
  }

  private async resolveCurrentIteration(videoTaskId: string) {
    const latest = await this.iterationLogModel
      .findOne({ videoTaskId })
      .sort({ iteration: -1, createdAt: -1 })
      .lean()
      .exec()

    return Number(latest?.iteration || 0)
  }

  private readPipelineContext(task: VideoTask) {
    const pipelineContext = task.metadata?.['pipelineContext']
    if (!pipelineContext || typeof pipelineContext !== 'object') {
      return null
    }

    return pipelineContext as VideoWorkerJobData['context']
  }

  private readOriginalPrompt(task: VideoTask, stage: IterationLogStage) {
    const pipelineContext = this.readPipelineContext(task)
    const prompts =
      pipelineContext && typeof pipelineContext.prompts === 'object'
        ? pipelineContext.prompts
        : {}

    const promptKeys = this.resolvePromptKeys(stage)
    for (const key of promptKeys) {
      const value = prompts?.[key]
      if (typeof value === 'string' && value.trim()) {
        return value.trim()
      }
    }

    switch (stage) {
      case 'frame_edit':
        return 'Improve frame editing quality while preserving brand consistency.'
      case 'copy_generate':
        return 'Generate concise, platform-ready copy aligned with the final video output.'
      case 'subtitle':
        return 'Improve subtitle readability, timing, and platform compliance.'
      case 'quality_check':
      case 'i2v_generate':
      default:
        return 'Improve video generation quality, pacing, subtitles, and brand alignment.'
    }
  }

  private readErrorMessage(task: VideoTask, errorOrQualityResult?: unknown) {
    if (typeof errorOrQualityResult === 'string' && errorOrQualityResult.trim()) {
      return errorOrQualityResult.trim()
    }

    if (errorOrQualityResult && typeof errorOrQualityResult === 'object') {
      const record = errorOrQualityResult as Record<string, unknown>
      for (const key of ['errorMessage', 'message']) {
        const value = record[key]
        if (typeof value === 'string' && value.trim()) {
          return value.trim()
        }
      }

      if (Array.isArray(record['errors'])) {
        const errors = record['errors']
          .map((item) => (typeof item === 'string' ? item.trim() : ''))
          .filter(Boolean)
        if (errors.length > 0) {
          return errors.join('; ')
        }
      }
    }

    return task.errorMessage || 'Quality check failed'
  }

  private extractQualityScore(
    errorOrQualityResult?: unknown,
    task?: VideoTask,
  ): PromptOptimizerQualityScore | null {
    const fromInput = this.extractExplicitQualityScore(errorOrQualityResult)
    if (fromInput) {
      return fromInput
    }

    const qualityRecord = this.extractQualityMetrics(errorOrQualityResult) || this.extractTaskQuality(task)
    if (!qualityRecord) {
      return null
    }

    const width = Number(qualityRecord['width'] || 0)
    const height = Number(qualityRecord['height'] || 0)
    const duration = Number(qualityRecord['duration'] || 0)
    const fileSize = Number(qualityRecord['fileSize'] || 0)
    const hasSubtitles = Boolean(qualityRecord['hasSubtitles'])
    const passed = Boolean((qualityRecord as Record<string, unknown>)['passed'])

    const shortEdge = Math.min(width || 0, height || 0)
    const resolution = shortEdge >= 1080 ? 100 : shortEdge >= 720 ? 86 : shortEdge > 0 ? 60 : 0
    const fileSizeScore =
      fileSize >= 2 * 1024 * 1024
        ? 96
        : fileSize >= 500 * 1024
          ? 82
          : fileSize > 0
            ? 55
            : 0
    const subtitles = hasSubtitles ? 92 : 70
    const durationScore = duration >= 10 && duration <= 60 ? 95 : duration > 0 ? 68 : 0
    const clarity = passed ? 90 : hasSubtitles ? 82 : 72
    const composition = resolution >= 86 ? 88 : 70
    const viralityHook = passed ? 84 : 66

    const production = Number(
      ((resolution + fileSizeScore + subtitles + durationScore) / 4).toFixed(2),
    )
    const virality = Number(
      ((clarity + composition + viralityHook) / 3).toFixed(2),
    )

    return {
      total: Number((production * 0.4 + virality * 0.6).toFixed(2)),
      production,
      virality,
      dimensions: {
        resolution,
        fileSize: fileSizeScore,
        subtitles,
        duration: durationScore,
        clarity,
        composition,
        viralityHook,
      },
    }
  }

  private extractExplicitQualityScore(errorOrQualityResult?: unknown) {
    if (!errorOrQualityResult || typeof errorOrQualityResult !== 'object') {
      return null
    }

    const source = errorOrQualityResult as Record<string, unknown>
    const embedded = source['qualityScore']
    const candidate =
      embedded && typeof embedded === 'object'
        ? (embedded as Record<string, unknown>)
        : source

    const total = Number(candidate['total'] || 0)
    const production = Number(candidate['production'] || 0)
    const virality = Number(candidate['virality'] || 0)
    const dimensions = candidate['dimensions']

    if (
      total <= 0 ||
      production <= 0 ||
      virality <= 0 ||
      !dimensions ||
      typeof dimensions !== 'object'
    ) {
      return null
    }

    return {
      total,
      production,
      virality,
      dimensions: dimensions as Record<string, number>,
    }
  }

  private extractQualityMetrics(errorOrQualityResult?: unknown) {
    if (!errorOrQualityResult || typeof errorOrQualityResult !== 'object') {
      return null
    }

    const source = errorOrQualityResult as Record<string, unknown>
    const metrics = source['metrics']
    if (metrics && typeof metrics === 'object') {
      return {
        ...(metrics as Record<string, unknown>),
        passed: Boolean(source['passed']),
      }
    }

    return null
  }

  private extractTaskQuality(task?: VideoTask) {
    const quality = task?.quality
    if (!quality || typeof quality !== 'object') {
      return null
    }

    return quality as Record<string, unknown>
  }

  private resolveFailureCategory(
    errorMessage: string,
    qualityScore?: PromptOptimizerQualityScore | null,
  ): IterationFailureCategory {
    const normalizedMessage = errorMessage.toLowerCase()

    if (qualityScore && qualityScore.total > 0 && qualityScore.total < 75) {
      return 'quality'
    }

    if (
      normalizedMessage.includes('brand') ||
      normalizedMessage.includes('logo') ||
      normalizedMessage.includes('palette') ||
      normalizedMessage.includes('color')
    ) {
      return 'brand_mismatch'
    }

    if (
      normalizedMessage.includes('irrelevant') ||
      normalizedMessage.includes('mismatch') ||
      normalizedMessage.includes('topic') ||
      normalizedMessage.includes('audience') ||
      normalizedMessage.includes('content')
    ) {
      return 'content'
    }

    return 'technical'
  }

  private resolveFailureReason(
    errorMessage: string,
    failCategory: IterationFailureCategory,
  ) {
    const normalizedMessage = errorMessage.toLowerCase()

    if (failCategory === 'quality') {
      return 'Quality score is below the retry threshold'
    }

    if (
      normalizedMessage.includes('timeout') ||
      normalizedMessage.includes('timed out')
    ) {
      return 'Provider timed out during stage execution'
    }

    if (
      normalizedMessage.includes('401') ||
      normalizedMessage.includes('403') ||
      normalizedMessage.includes('unauthorized') ||
      normalizedMessage.includes('forbidden') ||
      normalizedMessage.includes('http 5')
    ) {
      return 'Technical provider error interrupted stage execution'
    }

    if (failCategory === 'brand_mismatch') {
      return 'Generated result drifted away from required brand elements'
    }

    if (failCategory === 'content') {
      return 'Generated content is not aligned with the requested topic or audience intent'
    }

    return 'Prompt robustness is insufficient for the failed stage'
  }

  private buildSuggestedFixes(
    stage: IterationLogStage,
    failCategory: IterationFailureCategory,
  ) {
    const fixes = [
      'Keep the instruction compact and explicit.',
      'Preserve brand, platform, and quality constraints in one place.',
    ]

    if (stage === 'quality_check' || stage === 'i2v_generate') {
      fixes.unshift('Tighten video quality, subtitle readability, and pacing constraints.')
    }

    if (stage === 'frame_edit') {
      fixes.unshift('Strengthen frame composition, brand asset placement, and scene continuity rules.')
    }

    if (stage === 'copy_generate') {
      fixes.unshift('Constrain tone, CTA, and topic to a single content objective.')
    }

    if (failCategory === 'brand_mismatch') {
      fixes.unshift('Explicitly require approved brand colors, slogans, and forbidden-word rules.')
    }

    if (failCategory === 'content') {
      fixes.unshift('Anchor the prompt to the requested topic, audience, and platform context.')
    }

    if (failCategory === 'technical') {
      fixes.unshift('Reduce prompt length and require a deterministic output structure.')
    }

    return Array.from(new Set(fixes))
  }

  private resolveConfidence(
    failCategory: IterationFailureCategory,
    qualityScore?: PromptOptimizerQualityScore | null,
  ) {
    if (failCategory === 'quality' && qualityScore?.total) {
      return 0.88
    }

    if (failCategory === 'technical') {
      return 0.9
    }

    if (failCategory === 'brand_mismatch') {
      return 0.84
    }

    return 0.8
  }

  private resolveRetryStep(
    stage: IterationLogStage,
    strategy: PromptOptimizerRetryStrategy,
  ): VideoWorkerStep {
    if (stage === 'copy_generate') {
      return 'generate-copy'
    }

    if (stage === 'frame_edit') {
      return 'edit-frames'
    }

    if (strategy === 'fallback_strategy') {
      return 'edit-frames'
    }

    return 'render-video'
  }

  private buildRetryContext(
    context: VideoWorkerJobData['context'],
    retryStep: VideoWorkerStep,
    optimizedPrompt: string,
    strategy: PromptOptimizerRetryStrategy,
  ) {
    const nextPrompts = {
      ...(context?.prompts || {}),
      [retryStep]: optimizedPrompt,
      'quality-check': `retry_strategy:${strategy}`,
    }

    if (retryStep === 'edit-frames') {
      nextPrompts['render-video'] = optimizedPrompt
    }

    return {
      ...(context || {}),
      prompts: nextPrompts,
      qualityReport: undefined,
    }
  }

  private resolvePromptKeys(stage: IterationLogStage) {
    switch (stage) {
      case 'frame_edit':
        return ['edit-frames']
      case 'copy_generate':
        return ['generate-copy']
      case 'subtitle':
        return ['generate-copy', 'render-video']
      case 'quality_check':
      case 'i2v_generate':
      default:
        return ['render-video', 'edit-frames']
    }
  }

  private toIterationStage(value?: string): IterationLogStage {
    switch ((value || '').trim().toLowerCase()) {
      case 'frame_edit':
      case 'frame-edit':
      case 'edit-frames':
        return 'frame_edit'
      case 'subtitle':
        return 'subtitle'
      case 'copy_generate':
      case 'copy-generate':
      case 'generate-copy':
        return 'copy_generate'
      case 'quality_check':
      case 'quality-check':
        return 'quality_check'
      case 'i2v_generate':
      case 'i2v-generate':
      case 'render-video':
      default:
        return 'i2v_generate'
    }
  }

  private isSuccessfulTaskStatus(status?: string) {
    return [
      VideoTaskStatus.COMPLETED,
      VideoTaskStatus.PENDING_REVIEW,
      VideoTaskStatus.APPROVED,
      VideoTaskStatus.PUBLISHED,
    ].includes((status || '') as VideoTaskStatus)
  }

  private toIterationLogResponse(item: Record<string, any>) {
    return {
      id: item._id?.toString?.() || null,
      videoTaskId: item.videoTaskId,
      batchId: item.batchId || null,
      iteration: Number(item.iteration || 0),
      stage: item.stage,
      status: item.status,
      originalPrompt: item.originalPrompt || '',
      optimizedPrompt: item.optimizedPrompt || '',
      failureAnalysis: item.failureAnalysis || null,
      qualityScore: item.qualityScore || null,
      costCredits: Number(item.costCredits || 0),
      durationMs: Number(item.durationMs || 0),
      strategyUsed: item.strategyUsed || 'default',
      metadata: item.metadata || {},
      createdAt: item.createdAt || null,
      updatedAt: item.updatedAt || null,
    }
  }
}

export { PromptOptimizerLoopService as PromptOptimizerService }
