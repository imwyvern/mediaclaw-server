import { InjectQueue } from '@nestjs/bullmq'
import axios from 'axios'
import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import {
  IterationFailureCategory,
  IterationLog,
  IterationLogStage,
  IterationLogStatus,
  OrgApiKeyProvider,
  VideoTask,
  VideoTaskStatus,
} from '@yikart/mongodb'
import { Queue } from 'bullmq'
import { Model, Types } from 'mongoose'
import { ModelResolverService } from '../model-resolver/model-resolver.service'
import type { PipelineJobContext } from '../pipeline/pipeline.types'
import { ByokService } from '../settings/byok.service'
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

interface PromptOptimizationResponse {
  optimizedPrompt: string
  strategyUsed: string
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
    @Optional()
    private readonly byokService?: ByokService,
    @Optional()
    private readonly modelResolverService?: ModelResolverService,
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
    const optimization = await this.optimizePrompt(originalPrompt, {
      stage,
      failCategory,
      failReason,
      suggestedFixes,
    }, {
      orgId: task.orgId?.toString() || null,
      qualityScore,
    })

    return {
      videoTaskId,
      batchId: task.batchId?.toString() || null,
      iteration: (await this.resolveCurrentIteration(videoTaskId)) + 1,
      stage,
      originalPrompt,
      optimizedPrompt: optimization.optimizedPrompt,
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
    options: {
      orgId?: string | null
      qualityScore?: PromptOptimizerQualityScore | null
    } = {},
  ): Promise<PromptOptimizationResponse> {
    const heuristicPrompt = this.buildHeuristicOptimizedPrompt(originalPrompt, failureAnalysis)
    const llmOptimizedPrompt = await this.optimizePromptWithLlm(
      originalPrompt,
      failureAnalysis,
      options,
    )

    if (llmOptimizedPrompt) {
      return {
        optimizedPrompt: llmOptimizedPrompt,
        strategyUsed: 'retry_optimized_llm',
      }
    }

    return {
      optimizedPrompt: heuristicPrompt,
      strategyUsed: 'retry_optimized',
    }
  }

  private buildHeuristicOptimizedPrompt(
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
    ]
      .filter(Boolean)
      .join('\n')
      .trim()
  }

  private async optimizePromptWithLlm(
    originalPrompt: string,
    failureAnalysis: {
      stage: IterationLogStage
      failCategory: IterationFailureCategory
      failReason: string
      suggestedFixes: string[]
    },
    options: {
      orgId?: string | null
      qualityScore?: PromptOptimizerQualityScore | null
    },
  ) {
    const provider = await this.resolveOptimizationProvider(options.orgId)
    if (!provider) {
      return ''
    }

    const llmPrompt = this.buildLlmOptimizationPrompt(
      originalPrompt,
      failureAnalysis,
      options.qualityScore || null,
    )

    try {
      if (provider.name === 'deepseek') {
        return await this.requestDeepSeekOptimization(provider.apiKey, llmPrompt, provider.model)
      }

      if (provider.name === 'openai') {
        return await this.requestOpenAiOptimization(provider.apiKey, llmPrompt, provider.model)
      }

      return await this.requestGeminiOptimization(provider.apiKey, llmPrompt, provider.model)
    }
    catch (error) {
      const message = error instanceof Error ? error.message : 'unknown_prompt_optimizer_llm_error'
      this.logger.warn(`Prompt optimizer LLM fallback to heuristic: ${message}`)
      return ''
    }
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

  private readPipelineContext(task: VideoTask): PipelineJobContext | null {
    const pipelineContext = task.metadata?.['pipelineContext']
    if (!pipelineContext || typeof pipelineContext !== 'object') {
      return null
    }

    return pipelineContext as PipelineJobContext
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

    const qualityRecord: Record<string, unknown> | null =
      this.extractQualityMetrics(errorOrQualityResult) || this.extractTaskQuality(task)
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

    return quality as unknown as Record<string, unknown>
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
    context: PipelineJobContext,
    retryStep: VideoWorkerStep,
    optimizedPrompt: string,
    strategy: PromptOptimizerRetryStrategy,
  ): PipelineJobContext {
    const nextPrompts = {
      ...(context.prompts || {}),
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
      id: item['_id']?.toString?.() || null,
      videoTaskId: item['videoTaskId'],
      batchId: item['batchId'] || null,
      iteration: Number(item['iteration'] || 0),
      stage: item['stage'],
      status: item['status'],
      originalPrompt: item['originalPrompt'] || '',
      optimizedPrompt: item['optimizedPrompt'] || '',
      failureAnalysis: item['failureAnalysis'] || null,
      qualityScore: item['qualityScore'] || null,
      costCredits: Number(item['costCredits'] || 0),
      durationMs: Number(item['durationMs'] || 0),
      strategyUsed: item['strategyUsed'] || 'default',
      metadata: item['metadata'] || {},
      createdAt: item['createdAt'] || null,
      updatedAt: item['updatedAt'] || null,
    }
  }

  private async resolveOptimizationProvider(orgId?: string | null) {
    if (this.modelResolverService && orgId) {
      const resolved = await this.modelResolverService.resolveCapability(orgId, 'analysis')
      const name = this.mapProvider(resolved.provider)
      if (name !== 'heuristic') {
        const apiKey = await this.resolveApiKey(
          orgId,
          resolved.provider,
          this.fallbackEnvNames(resolved.provider),
        )
        if (apiKey) {
          return {
            name,
            apiKey,
            model: resolved.runtimeModel,
          }
        }
      }
    }

    const preferredProvider = process.env['MEDIACLAW_PROMPT_OPTIMIZER_PROVIDER']?.trim().toLowerCase()
    const deepseekKey = await this.resolveApiKey(
      orgId,
      OrgApiKeyProvider.DEEPSEEK,
      ['MEDIACLAW_DEEPSEEK_API_KEY', 'DEEPSEEK_API_KEY'],
    )
    const geminiKey = await this.resolveApiKey(
      orgId,
      OrgApiKeyProvider.GEMINI,
      ['MEDIACLAW_GEMINI_API_KEY', 'GEMINI_API_KEY'],
    )
    const openAiKey = await this.resolveApiKey(
      orgId,
      OrgApiKeyProvider.OPENAI,
      ['MEDIACLAW_OPENAI_API_KEY', 'OPENAI_API_KEY'],
    )

    if (preferredProvider === 'deepseek' && deepseekKey) {
      return {
        name: 'deepseek' as const,
        apiKey: deepseekKey,
        model: process.env['MEDIACLAW_DEEPSEEK_MODEL']?.trim() || process.env['DEEPSEEK_MODEL']?.trim() || 'deepseek-chat',
      }
    }
    if (preferredProvider === 'gemini' && geminiKey) {
      return {
        name: 'gemini' as const,
        apiKey: geminiKey,
        model: process.env['MEDIACLAW_GEMINI_MODEL']?.trim() || process.env['GEMINI_MODEL']?.trim() || 'gemini-2.5-flash',
      }
    }
    if (preferredProvider === 'openai' && openAiKey) {
      return {
        name: 'openai' as const,
        apiKey: openAiKey,
        model: process.env['MEDIACLAW_OPENAI_MODEL']?.trim() || process.env['OPENAI_MODEL']?.trim() || 'gpt-4o',
      }
    }
    if (deepseekKey) {
      return {
        name: 'deepseek' as const,
        apiKey: deepseekKey,
        model: process.env['MEDIACLAW_DEEPSEEK_MODEL']?.trim() || process.env['DEEPSEEK_MODEL']?.trim() || 'deepseek-chat',
      }
    }
    if (geminiKey) {
      return {
        name: 'gemini' as const,
        apiKey: geminiKey,
        model: process.env['MEDIACLAW_GEMINI_MODEL']?.trim() || process.env['GEMINI_MODEL']?.trim() || 'gemini-2.5-flash',
      }
    }
    if (openAiKey) {
      return {
        name: 'openai' as const,
        apiKey: openAiKey,
        model: process.env['MEDIACLAW_OPENAI_MODEL']?.trim() || process.env['OPENAI_MODEL']?.trim() || 'gpt-4o',
      }
    }

    return null
  }

  private async resolveApiKey(
    orgId: string | null | undefined,
    provider: OrgApiKeyProvider,
    fallbackEnvNames: readonly string[],
  ) {
    if (this.byokService) {
      const key = await this.byokService.resolveApiKey(orgId, provider, fallbackEnvNames)
      if (key) {
        return key
      }
    }

    for (const envName of fallbackEnvNames) {
      const value = process.env[envName]?.trim()
      if (value) {
        return value
      }
    }

    return ''
  }

  private buildLlmOptimizationPrompt(
    originalPrompt: string,
    failureAnalysis: {
      stage: IterationLogStage
      failCategory: IterationFailureCategory
      failReason: string
      suggestedFixes: string[]
    },
    qualityScore?: PromptOptimizerQualityScore | null,
  ) {
    return [
      '你是 MediaClaw 的视频生成 Prompt 优化器。',
      '请基于失败原因和质量评分，输出一个更稳定、可执行、可重试的优化后 prompt。',
      '只返回 JSON，格式必须为 {"optimizedPrompt":"..."}。',
      '要求：',
      '1. 保留原始任务意图、品牌约束、平台约束。',
      '2. 消除歧义，补足失败环节缺失的执行条件、输出要求、负向约束。',
      '3. 不能只返回修改建议，必须返回完整可直接重试的 prompt。',
      '4. 不要输出 Markdown，不要解释。',
      '',
      `阶段: ${failureAnalysis.stage}`,
      `失败类别: ${failureAnalysis.failCategory}`,
      `失败原因: ${failureAnalysis.failReason}`,
      `建议修复: ${failureAnalysis.suggestedFixes.join('；') || '无'}`,
      qualityScore
        ? `质量评分: ${JSON.stringify(qualityScore)}`
        : '质量评分: 无',
      '',
      '原始 prompt:',
      originalPrompt.trim(),
    ].join('\n')
  }

  private async requestDeepSeekOptimization(apiKey: string, prompt: string, modelOverride?: string) {
    const baseUrl = process.env['MEDIACLAW_DEEPSEEK_BASE_URL']?.trim() || 'https://api.deepseek.com'
    const model = modelOverride?.trim()
      || process.env['MEDIACLAW_DEEPSEEK_MODEL']?.trim()
      || process.env['DEEPSEEK_MODEL']?.trim()
      || 'deepseek-chat'
    const response = await axios.post(
      `${baseUrl.replace(/\/+$/, '')}/chat/completions`,
      {
        model,
        messages: [
          { role: 'system', content: 'Return valid JSON only.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        response_format: { type: 'json_object' },
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 60_000,
      },
    )

    const content = response.data?.choices?.[0]?.message?.content
    return this.extractOptimizedPrompt(content)
  }

  private async requestGeminiOptimization(apiKey: string, prompt: string, modelOverride?: string) {
    const baseUrl = process.env['MEDIACLAW_GEMINI_BASE_URL']?.trim() || 'https://generativelanguage.googleapis.com/v1beta'
    const model = modelOverride?.trim()
      || process.env['MEDIACLAW_GEMINI_MODEL']?.trim()
      || process.env['GEMINI_MODEL']?.trim()
      || 'gemini-2.5-flash'
    const response = await axios.post(
      `${baseUrl.replace(/\/+$/, '')}/models/${model}:generateContent?key=${apiKey}`,
      {
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.2,
        },
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 60_000,
      },
    )

    const content = response.data?.candidates?.[0]?.content?.parts?.[0]?.text
    return this.extractOptimizedPrompt(content)
  }

  private async requestOpenAiOptimization(apiKey: string, prompt: string, modelOverride?: string) {
    const baseUrl = process.env['MEDIACLAW_OPENAI_BASE_URL']?.trim() || process.env['OPENAI_BASE_URL']?.trim() || 'https://api.openai.com/v1'
    const model = modelOverride?.trim()
      || process.env['MEDIACLAW_OPENAI_MODEL']?.trim()
      || process.env['OPENAI_MODEL']?.trim()
      || 'gpt-4o'
    const response = await axios.post(
      `${baseUrl.replace(/\/+$/, '')}/chat/completions`,
      {
        model,
        messages: [
          { role: 'system', content: 'Return valid JSON only.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        response_format: { type: 'json_object' },
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 60_000,
      },
    )

    const content = response.data?.choices?.[0]?.message?.content
    return this.extractOptimizedPrompt(content)
  }

  private fallbackEnvNames(provider: OrgApiKeyProvider) {
    switch (provider) {
      case OrgApiKeyProvider.DEEPSEEK:
        return ['MEDIACLAW_DEEPSEEK_API_KEY', 'DEEPSEEK_API_KEY'] as const
      case OrgApiKeyProvider.GEMINI:
        return ['MEDIACLAW_GEMINI_API_KEY', 'GEMINI_API_KEY'] as const
      case OrgApiKeyProvider.OPENAI:
        return ['MEDIACLAW_OPENAI_API_KEY', 'OPENAI_API_KEY'] as const
      case OrgApiKeyProvider.KLING:
        return ['KLING_API_KEY', 'MEDIACLAW_KLING_API_KEY'] as const
      case OrgApiKeyProvider.TIKHUB:
        return ['TIKHUB_API_KEY', 'MEDIACLAW_TIKHUB_API_KEY'] as const
      case OrgApiKeyProvider.VCE:
        return ['VCE_GEMINI_API_KEY', 'MEDIACLAW_VCE_API_KEY'] as const
      default:
        return [] as const
    }
  }

  private mapProvider(provider: OrgApiKeyProvider) {
    switch (provider) {
      case OrgApiKeyProvider.DEEPSEEK:
        return 'deepseek' as const
      case OrgApiKeyProvider.GEMINI:
        return 'gemini' as const
      case OrgApiKeyProvider.OPENAI:
        return 'openai' as const
      default:
        return 'heuristic' as const
    }
  }

  private extractOptimizedPrompt(value: unknown) {
    if (typeof value !== 'string' || !value.trim()) {
      return ''
    }

    const parsed = this.parseJsonObject(value)
    if (parsed) {
      const optimizedPrompt = parsed['optimizedPrompt']
      return typeof optimizedPrompt === 'string' ? optimizedPrompt.trim() : ''
    }

    return value.trim()
  }

  private parseJsonObject(value: string) {
    try {
      return JSON.parse(value) as Record<string, unknown>
    }
    catch {
      const matched = value.match(/\{[\s\S]*\}/)
      if (!matched) {
        return null
      }

      try {
        return JSON.parse(matched[0]) as Record<string, unknown>
      }
      catch {
        return null
      }
    }
  }
}

export { PromptOptimizerLoopService as PromptOptimizerService }
