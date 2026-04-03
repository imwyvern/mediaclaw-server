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
import type { PipelineQualityReport } from './pipeline.types'
import { VIDEO_WORKER_QUEUE, VideoWorkerJobData, VideoWorkerStep } from '../worker/worker.constants'

type PromptRetryStrategy = 'retry_optimized' | 'fallback_strategy' | 'needs_manual_review'

interface FailureAnalysisHeuristicInput {
  taskId: string
  orgId?: string | null
  batchId?: string | null
  stage: IterationLogStage
  failedStep: VideoWorkerStep
  retryTargetStep: VideoWorkerStep
  originalPrompt: string
  errorMessage: string
  qualityScore?: FailureQualityScore | null
}

interface LogIterationInput {
  status: IterationLogStatus
  iteration?: number
  batchId?: string | null
  originalPrompt?: string
  optimizedPrompt?: string
  failureAnalysis?: {
    failReason: string
    failCategory: IterationFailureCategory
    suggestedFixes: string[]
    confidence: number
  } | null
  qualityScore?: FailureQualityScore | null
  costCredits?: number
  durationMs?: number
  strategyUsed?: string
  metadata?: Record<string, unknown>
}

export interface FailureQualityScore {
  total: number
  production: number
  virality: number
  dimensions: Record<string, number>
}

export interface FailureAnalysisResult {
  taskId: string
  orgId?: string | null
  batchId?: string | null
  iteration: number
  stage: IterationLogStage
  failedStep: VideoWorkerStep
  retryTargetStep: VideoWorkerStep
  originalPrompt: string
  optimizedPrompt: string
  errorMessage: string
  failReason: string
  failureReason: string
  rootCause: string
  failCategory: IterationFailureCategory
  suggestedFixes: string[]
  suggestedChanges: string[]
  confidence: number
  strategyUsed: string
  qualityScore?: FailureQualityScore | null
}

export interface OptimizedPromptResult {
  taskId: string
  failedStep: VideoWorkerStep
  retryTargetStep: VideoWorkerStep
  originalPrompt: string
  optimizedPrompt: string
  failureReason: string
  strategyUsed: string
}

@Injectable()
export class PromptOptimizerService {
  private readonly logger = new Logger(PromptOptimizerService.name)

  constructor(
    @InjectModel(VideoTask.name)
    private readonly videoTaskModel: Model<VideoTask>,
    @InjectQueue(VIDEO_WORKER_QUEUE)
    @Optional()
    private readonly workerQueue?: Queue<VideoWorkerJobData>,
    @InjectModel(IterationLog.name)
    @Optional()
    private readonly iterationLogModel?: Model<IterationLog>,
  ) {}

  async analyzeFailure(
    taskId: string,
    stageInput?: string,
    originalPromptInput?: string,
    errorOrQualityResult?: unknown,
  ): Promise<FailureAnalysisResult> {
    const task = await this.getTask(taskId)
    const failedStep = this.resolveFailedWorkerStep(task, stageInput)
    const stage = this.toIterationStage(stageInput || failedStep)
    const retryTargetStep = this.resolveRetryTargetStep(stage, failedStep)
    const originalPrompt = originalPromptInput?.trim() || this.readOriginalPrompt(task, retryTargetStep)
    const errorMessage = this.readErrorMessage(task, errorOrQualityResult)
    const qualityScore = this.extractQualityScore(errorOrQualityResult)
    const iteration = await this.resolveNextIteration(taskId)

    const heuristic = this.buildFailureAnalysis({
      taskId,
      orgId: task.orgId?.toString() || null,
      batchId: task.batchId?.toString() || null,
      stage,
      failedStep,
      retryTargetStep,
      originalPrompt,
      errorMessage,
      qualityScore,
    })
    const optimized = await this.generateOptimizedPrompt(taskId, heuristic)

    const analysis: FailureAnalysisResult = {
      ...heuristic,
      iteration,
      optimizedPrompt: optimized.optimizedPrompt,
      strategyUsed: optimized.strategyUsed,
    }

    await this.logIteration(taskId, stage, {
      iteration,
      status: 'failed',
      batchId: task.batchId?.toString() || null,
      originalPrompt,
      optimizedPrompt: optimized.optimizedPrompt,
      failureAnalysis: {
        failReason: analysis.failReason,
        failCategory: analysis.failCategory,
        suggestedFixes: analysis.suggestedFixes,
        confidence: analysis.confidence,
      },
      qualityScore,
      costCredits: Number(task.creditsConsumed || 0),
      strategyUsed: 'default',
      metadata: {
        errorMessage,
        failedStep,
        retryTargetStep,
      },
    })

    await this.persistAnalysis(task, analysis)
    return analysis
  }

  async optimizePrompt(
    originalPrompt: string,
    failureAnalysis: Pick<FailureAnalysisResult, 'failCategory' | 'failReason' | 'suggestedFixes' | 'stage'>,
  ) {
    const normalizedOriginalPrompt = originalPrompt.trim()
    const guidance: string[] = []

    switch (failureAnalysis.failCategory) {
      case 'quality':
        guidance.push('Raise visual quality requirements, tighten output fidelity, and preserve platform-safe clarity.')
        guidance.push('Keep motion stable, frame clean, and brand elements readable.')
        break
      case 'content':
        guidance.push('Align the output closer to the requested topic, audience intent, and platform context.')
        guidance.push('Remove irrelevant narrative branches and keep the message single-threaded.')
        break
      case 'brand_mismatch':
        guidance.push('Explicitly preserve brand colors, slogans, tone, and prohibited-word constraints.')
        guidance.push('Reject outputs that drift away from the brand profile or target product.')
        break
      default:
        guidance.push('Reduce ambiguity, require deterministic structure, and minimize provider-side parsing risk.')
        guidance.push('Keep the response compact, explicit, and execution-safe.')
        break
    }

    const optimizedPrompt = [
      normalizedOriginalPrompt,
      '',
      '[Optimization patch]',
      `Stage: ${failureAnalysis.stage}`,
      `Failure: ${failureAnalysis.failReason}`,
      ...guidance.map(item => `- ${item}`),
      ...failureAnalysis.suggestedFixes.map(item => `- ${item}`),
      '- Use a deterministic output structure and avoid unnecessary filler.',
    ].filter(Boolean).join('\n')

    return optimizedPrompt.trim()
  }

  async shouldRetry(videoTaskId: string) {
    const iteration = await this.resolveCurrentIteration(videoTaskId)

    if (iteration < 2) {
      return {
        currentIteration: iteration,
        shouldRetry: true,
        strategy: 'retry_optimized' as PromptRetryStrategy,
      }
    }

    if (iteration === 2) {
      return {
        currentIteration: iteration,
        shouldRetry: true,
        strategy: 'fallback_strategy' as PromptRetryStrategy,
      }
    }

    return {
      currentIteration: iteration,
      shouldRetry: false,
      strategy: 'needs_manual_review' as PromptRetryStrategy,
    }
  }

  async retryWithOptimizedPrompt(taskId: string, strategyOverride?: PromptRetryStrategy) {
    const task = await this.getTask(taskId)
    const lastAnalysis = this.readLastAnalysis(task)
    const retryTargetStep = this.resolveRetryTargetStep(
      lastAnalysis?.stage || this.toIterationStage(this.readFailedStep(task)),
      lastAnalysis?.failedStep || this.readFailedStep(task),
    )

    if (!this.workerQueue) {
      throw new BadRequestException('Worker queue is not configured')
    }

    const pipelineContext = this.readPipelineContext(task)
    if (!pipelineContext) {
      throw new BadRequestException('Pipeline context is not available for retry')
    }

    const originalOptimizedPrompt = this.readOptimizedPrompt(task, retryTargetStep)
    if (!originalOptimizedPrompt) {
      throw new BadRequestException('Optimized prompt is not available')
    }

    const strategy = strategyOverride || 'retry_optimized'
    const optimizedPrompt = strategy === 'fallback_strategy'
      ? this.applyFallbackStrategy(originalOptimizedPrompt)
      : originalOptimizedPrompt

    const nextContext = {
      ...pipelineContext,
      prompts: {
        ...(pipelineContext.prompts || {}),
        [retryTargetStep]: optimizedPrompt,
      },
    }

    await this.workerQueue.add(
      retryTargetStep,
      {
        taskId: task._id.toString(),
        context: nextContext,
      },
      {
        jobId: `${task._id.toString()}:${retryTargetStep}:optimized:${Date.now()}`,
      },
    )

    const currentIteration = await this.resolveCurrentIteration(taskId)
    await this.logIteration(
      taskId,
      this.toIterationStage(lastAnalysis?.stage || retryTargetStep),
      {
        iteration: currentIteration || 1,
        status: 'retried',
        batchId: task.batchId?.toString() || null,
        originalPrompt: lastAnalysis?.originalPrompt || this.readOriginalPrompt(task, retryTargetStep),
        optimizedPrompt,
        failureAnalysis: lastAnalysis
          ? {
              failReason: lastAnalysis.failReason,
              failCategory: lastAnalysis.failCategory,
              suggestedFixes: lastAnalysis.suggestedFixes,
              confidence: lastAnalysis.confidence,
            }
          : null,
        qualityScore: lastAnalysis?.qualityScore || null,
        costCredits: Number(task.creditsConsumed || 0),
        strategyUsed: strategy,
        metadata: {
          retryTargetStep,
          source: 'prompt_optimizer',
        },
      },
    )

    await this.videoTaskModel.findByIdAndUpdate(task._id, {
      $set: {
        status: this.mapRetryStatus(retryTargetStep),
        errorMessage: '',
        completedAt: null,
        'metadata.failedStep': null,
        'metadata.pipelineContext': nextContext,
        'metadata.promptOptimizer.lastRetry': {
          retryTargetStep,
          strategy,
          retriedAt: new Date().toISOString(),
        },
      },
      $push: {
        promptFixes: {
          originalPrompt: lastAnalysis?.originalPrompt || this.readOriginalPrompt(task, retryTargetStep),
          optimizedPrompt,
          failureReason: lastAnalysis?.failReason || this.readErrorMessage(task),
          retriedAt: new Date(),
          result: 'retry_queued',
          analysis: lastAnalysis || {},
        },
      },
    }).exec()

    return {
      taskId: task._id.toString(),
      failedStep: retryTargetStep,
      optimizedPrompt,
      retryQueued: true,
      strategy,
    }
  }

  async logIteration(videoTaskId: string, stageInput: string, input: LogIterationInput) {
    const iterationLogModel = this.requireIterationLogModel()
    const task = await this.getTask(videoTaskId)
    const stage = this.toIterationStage(stageInput)
    const iteration = input.iteration || await this.resolveNextIteration(videoTaskId)

    const created = await iterationLogModel.create({
      videoTaskId,
      batchId: input.batchId || task.batchId?.toString() || '',
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
    const iterationLogModel = this.requireIterationLogModel()
    const items = await iterationLogModel.find({ videoTaskId })
      .sort({ iteration: 1, createdAt: 1 })
      .lean()
      .exec()

    return items.map(item => this.toIterationLogResponse(item))
  }

  async getBatchIterationSummary(batchId: string) {
    const normalizedBatchId = batchId.trim()
    if (!normalizedBatchId) {
      throw new BadRequestException('batchId is required')
    }

    const iterationLogModel = this.requireIterationLogModel()
    const [logs, tasks] = await Promise.all([
      iterationLogModel.find({ batchId: normalizedBatchId }).lean().exec(),
      this.videoTaskModel.find({ batchId: this.toOptionalObjectId(normalizedBatchId) }).lean().exec(),
    ])

    const uniqueTaskIds = new Set<string>()
    const successfulTaskIds = new Set<string>()
    const failureCategories = new Map<string, number>()
    const successIterations = new Map<string, number>()

    for (const item of logs) {
      uniqueTaskIds.add(item.videoTaskId)
      const category = item.failureAnalysis?.failCategory
      if (category) {
        failureCategories.set(category, (failureCategories.get(category) || 0) + 1)
      }
    }

    for (const task of tasks) {
      const taskId = task._id.toString()
      if (uniqueTaskIds.size === 0 || uniqueTaskIds.has(taskId)) {
        uniqueTaskIds.add(taskId)
      }

      if (this.isSuccessfulTaskStatus(task.status)) {
        successfulTaskIds.add(taskId)
      }
    }

    for (const item of logs) {
      if (!successfulTaskIds.has(item.videoTaskId)) {
        continue
      }

      const current = successIterations.get(item.videoTaskId)
      if (!current || item.iteration < current) {
        successIterations.set(item.videoTaskId, item.iteration)
      }
    }

    const avgIterationsToSuccess = successIterations.size > 0
      ? Number(
          (
            Array.from(successIterations.values()).reduce((sum, value) => sum + value, 0)
            / successIterations.size
          ).toFixed(2),
        )
      : 0

    const commonFailureCategories = Array.from(failureCategories.entries())
      .sort((left, right) => right[1] - left[1])
      .map(([category, count]) => ({ category, count }))

    const successRate = uniqueTaskIds.size > 0
      ? Number(((successfulTaskIds.size / uniqueTaskIds.size) * 100).toFixed(2))
      : 0

    return {
      batchId: normalizedBatchId,
      totalIterations: logs.length,
      totalTasks: uniqueTaskIds.size,
      successfulTasks: successfulTaskIds.size,
      successRate,
      commonFailureCategories,
      avgIterationsToSuccess,
    }
  }

  private async generateOptimizedPrompt(
    taskId: string,
    failureAnalysis: Omit<FailureAnalysisResult, 'iteration' | 'optimizedPrompt' | 'strategyUsed'>,
  ): Promise<OptimizedPromptResult> {
    const optimizedPrompt = await this.optimizePrompt(failureAnalysis.originalPrompt, failureAnalysis)

    return {
      taskId,
      failedStep: failureAnalysis.failedStep,
      retryTargetStep: failureAnalysis.retryTargetStep,
      originalPrompt: failureAnalysis.originalPrompt,
      optimizedPrompt,
      failureReason: failureAnalysis.failReason,
      strategyUsed: 'retry_optimized',
    }
  }

  private buildFailureAnalysis(input: FailureAnalysisHeuristicInput): Omit<FailureAnalysisResult, 'iteration' | 'optimizedPrompt' | 'strategyUsed'> {
    const message = input.errorMessage.toLowerCase()
    const failCategory = this.resolveFailureCategory(message, input.qualityScore)

    let failReason = 'Prompt robustness is insufficient for the failed pipeline stage'
    let rootCause = 'Prompt instructions are not specific enough for the provider and stage constraints'
    let confidence = 0.72
    const suggestedFixes = [
      'Add stricter task constraints and success criteria.',
      'Reduce ambiguous wording and keep output expectations explicit.',
      'Preserve brand, platform, and format requirements in the same prompt.',
    ]

    if (input.qualityScore && input.qualityScore.total < 75) {
      failReason = 'Quality score is below the retry threshold'
      rootCause = 'The generated result did not meet production or virality expectations'
      suggestedFixes.unshift('Raise visual quality, rhythm, and clarity constraints for the generation stage.')
      confidence = 0.88
    }

    if (message.includes('timeout') || message.includes('timed out')) {
      failReason = 'Provider timed out during stage execution'
      rootCause = 'Prompt context is too broad or the provider response path is unstable'
      suggestedFixes.unshift('Shorten the prompt and keep only the minimum actionable context.')
      confidence = 0.92
    }
    else if (
      message.includes('401')
      || message.includes('403')
      || message.includes('unauthorized')
      || message.includes('forbidden')
      || message.includes('http 5')
    ) {
      failReason = 'Technical provider error interrupted prompt execution'
      rootCause = 'Remote provider authentication or infrastructure is unstable'
      suggestedFixes.unshift('Validate provider availability before requeueing the next iteration.')
      confidence = 0.91
    }
    else if (message.includes('brand') || message.includes('logo') || message.includes('color')) {
      failReason = 'Generated result drifted away from required brand elements'
      rootCause = 'Brand constraints are under-specified in the generation prompt'
      suggestedFixes.unshift('Explicitly require brand colors, slogans, tone, and prohibited-word constraints.')
      confidence = 0.86
    }
    else if (
      message.includes('irrelevant')
      || message.includes('mismatch')
      || message.includes('topic')
      || message.includes('content')
    ) {
      failReason = 'Generated content is not aligned with the requested topic or audience intent'
      rootCause = 'The prompt does not anchor the output tightly enough to the source task'
      suggestedFixes.unshift('Re-anchor the prompt to the task theme, platform, and content objective.')
      confidence = 0.83
    }
    else if (message.includes('json') || message.includes('parse') || message.includes('schema')) {
      failReason = 'Provider returned an invalid structured response'
      rootCause = 'Prompt does not constrain the output format enough'
      suggestedFixes.unshift('Explicitly require a single valid response structure.')
      confidence = 0.9
    }

    return {
      taskId: input.taskId,
      orgId: input.orgId || null,
      batchId: input.batchId || null,
      stage: input.stage,
      failedStep: input.failedStep,
      retryTargetStep: input.retryTargetStep,
      originalPrompt: input.originalPrompt,
      errorMessage: input.errorMessage,
      failReason,
      failureReason: failReason,
      rootCause,
      failCategory,
      suggestedFixes: Array.from(new Set(suggestedFixes)),
      suggestedChanges: Array.from(new Set(suggestedFixes)),
      confidence,
      qualityScore: input.qualityScore || null,
    }
  }

  private resolveFailureCategory(
    errorMessage: string,
    qualityScore?: FailureQualityScore | null,
  ): IterationFailureCategory {
    if (qualityScore && qualityScore.total < 75) {
      return 'quality'
    }

    if (
      errorMessage.includes('brand')
      || errorMessage.includes('logo')
      || errorMessage.includes('palette')
      || errorMessage.includes('color')
    ) {
      return 'brand_mismatch'
    }

    if (
      errorMessage.includes('irrelevant')
      || errorMessage.includes('content mismatch')
      || errorMessage.includes('topic')
      || errorMessage.includes('audience')
    ) {
      return 'content'
    }

    return 'technical'
  }

  private async persistAnalysis(task: VideoTask, analysis: FailureAnalysisResult) {
    const optimizedPrompts = {
      ...(task.metadata?.['optimizedPrompts'] || {}),
      [analysis.retryTargetStep]: analysis.optimizedPrompt,
    }

    await this.videoTaskModel.findByIdAndUpdate(task._id, {
      $set: {
        'metadata.promptOptimizer.lastAnalysis': analysis,
        'metadata.promptOptimizer.lastIteration': analysis.iteration,
        'metadata.promptOptimizer.retryTargetStep': analysis.retryTargetStep,
        'metadata.optimizedPrompts': optimizedPrompts,
      },
      $push: {
        promptFixes: {
          originalPrompt: analysis.originalPrompt,
          optimizedPrompt: analysis.optimizedPrompt,
          failureReason: analysis.failReason,
          retriedAt: null,
          result: 'analyzed',
          analysis,
        },
      },
    }).exec()
  }

  private extractQualityScore(errorOrQualityResult?: unknown): FailureQualityScore | null {
    if (!errorOrQualityResult || typeof errorOrQualityResult !== 'object') {
      return null
    }

    const qualityReport = errorOrQualityResult as PipelineQualityReport & {
      total?: number
      production?: number
      virality?: number
    }
    const metrics = qualityReport.metrics
    if (!metrics) {
      return null
    }

    const durationScore = Math.max(0, 100 - Math.abs((metrics.duration || 0) - 15) * 4)
    const resolutionScore = Math.min(100, Math.round((Math.min(metrics.width || 0, metrics.height || 0) / 720) * 100))
    const fileSizeScore = Math.min(100, Math.round(((metrics.fileSize || 0) / (1024 * 1024)) * 20))
    const subtitleScore = metrics.hasSubtitles ? 100 : 60
    const production = this.averageScore([durationScore, resolutionScore, fileSizeScore, subtitleScore])

    const viralityDimensions: Record<string, number> = {
      clarity: subtitleScore,
      retention: durationScore,
      quality: resolutionScore,
      distribution_readiness: fileSizeScore,
      hook_strength: durationScore,
      readability: subtitleScore,
      platform_fit: Math.min(100, Math.round((resolutionScore * 0.6) + (subtitleScore * 0.4))),
    }
    const virality = this.averageScore(Object.values(viralityDimensions))
    const total = Number(((production * 0.4) + (virality * 0.6)).toFixed(2))

    return {
      total,
      production,
      virality,
      dimensions: viralityDimensions,
    }
  }

  private averageScore(values: number[]) {
    if (values.length === 0) {
      return 0
    }

    return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2))
  }

  private applyFallbackStrategy(prompt: string) {
    return [
      prompt,
      '',
      '[Fallback strategy]',
      '- Use a more conservative generation plan and favor stable defaults.',
      '- Prefer lower-variance output over aggressive creativity.',
    ].join('\n')
  }

  private async getTask(taskId: string) {
    if (!Types.ObjectId.isValid(taskId)) {
      throw new BadRequestException('taskId is invalid')
    }

    const task = await this.videoTaskModel.findById(new Types.ObjectId(taskId)).exec()
    if (!task) {
      throw new BadRequestException('Video task not found')
    }

    return task
  }

  private requireIterationLogModel() {
    if (!this.iterationLogModel) {
      throw new BadRequestException('Iteration log model is not configured')
    }

    return this.iterationLogModel
  }

  private async resolveCurrentIteration(taskId: string) {
    const iterationLogModel = this.requireIterationLogModel()
    const latest = await iterationLogModel.findOne({ videoTaskId: taskId })
      .sort({ iteration: -1, createdAt: -1 })
      .lean()
      .exec()

    if (latest?.iteration) {
      return Number(latest.iteration)
    }

    const task = await this.getTask(taskId)
    return Array.isArray(task.promptFixes) ? task.promptFixes.length : 0
  }

  private async resolveNextIteration(taskId: string) {
    return (await this.resolveCurrentIteration(taskId)) + 1
  }

  private resolveFailedWorkerStep(task: VideoTask, stageInput?: string): VideoWorkerStep {
    const fromInput = this.normalizeWorkerStep(stageInput)
    if (fromInput) {
      return fromInput
    }

    const failedStep = this.readFailedStep(task)
    return this.normalizeWorkerStep(failedStep) || 'render-video'
  }

  private readFailedStep(task: VideoTask) {
    const failedStep = task.metadata?.['failedStep']
    if (typeof failedStep === 'string' && failedStep.trim()) {
      return failedStep.trim()
    }

    const latestIteration = [...(task.iterationLog || [])].reverse().find(entry => entry.status === 'failed')
    if (latestIteration?.step) {
      return latestIteration.step
    }

    const latestError = [...(task.errorLog || [])].reverse()[0]
    if (latestError?.step) {
      return latestError.step
    }

    return 'render-video'
  }

  private readOriginalPrompt(task: VideoTask, failedStep: VideoWorkerStep) {
    const prompts = this.readPipelineContext(task)?.['prompts']
    const promptFromContext = prompts && typeof prompts[failedStep] === 'string'
      ? String(prompts[failedStep]).trim()
      : ''

    if (promptFromContext) {
      return promptFromContext
    }

    if (failedStep === 'generate-copy') {
      return `Generate platform-ready copy for ${task.sourceVideoUrl || 'the produced video'} and keep it aligned with the task metadata.`
    }

    if (failedStep === 'edit-frames') {
      return `Edit the frames to preserve brand consistency for source ${task.sourceVideoUrl || 'unknown source'}.`
    }

    return `Optimize the ${failedStep} stage for task ${task._id.toString()} using source ${task.sourceVideoUrl || 'unknown source'} while preserving brand consistency.`
  }

  private readErrorMessage(task: VideoTask, errorOrQualityResult?: unknown) {
    if (typeof errorOrQualityResult === 'string' && errorOrQualityResult.trim()) {
      return errorOrQualityResult.trim()
    }

    if (
      errorOrQualityResult
      && typeof errorOrQualityResult === 'object'
      && 'errors' in errorOrQualityResult
      && Array.isArray((errorOrQualityResult as { errors?: unknown[] }).errors)
    ) {
      const errors = (errorOrQualityResult as { errors: unknown[] }).errors
        .map(item => typeof item === 'string' ? item.trim() : '')
        .filter(Boolean)
      if (errors.length > 0) {
        return errors.join('; ')
      }
    }

    const latestError = [...(task.errorLog || [])].reverse()[0]
    return task.errorMessage || latestError?.message || 'Unknown pipeline failure'
  }

  private readOptimizedPrompt(task: VideoTask, failedStep: VideoWorkerStep) {
    const optimizedPrompts = task.metadata?.['optimizedPrompts']
    const value = optimizedPrompts && typeof optimizedPrompts === 'object'
      ? optimizedPrompts[failedStep]
      : ''

    return typeof value === 'string' ? value.trim() : ''
  }

  private readPipelineContext(task: VideoTask) {
    const pipelineContext = task.metadata?.['pipelineContext']
    return pipelineContext && typeof pipelineContext === 'object'
      ? pipelineContext as VideoWorkerJobData['context']
      : null
  }

  private readLastAnalysis(task: VideoTask) {
    const analysis = task.metadata?.['promptOptimizer']?.['lastAnalysis']
    return analysis && typeof analysis === 'object'
      ? analysis as FailureAnalysisResult
      : null
  }

  private resolveRetryTargetStep(stage: string, failedStep: string): VideoWorkerStep {
    const normalizedFailedStep = this.normalizeWorkerStep(failedStep)
    if (normalizedFailedStep && normalizedFailedStep !== 'quality-check') {
      return normalizedFailedStep
    }

    switch (this.toIterationStage(stage)) {
      case 'frame_edit':
        return 'edit-frames'
      case 'copy_generate':
        return 'generate-copy'
      case 'subtitle':
      case 'quality_check':
      case 'i2v_generate':
      default:
        return 'render-video'
    }
  }

  private toIterationStage(value?: string): IterationLogStage {
    switch ((value || '').trim().toLowerCase()) {
      case 'edit-frames':
      case 'frame_edit':
      case 'frame-edit':
        return 'frame_edit'
      case 'generate-copy':
      case 'copy_generate':
      case 'copy-generate':
        return 'copy_generate'
      case 'subtitle':
        return 'subtitle'
      case 'quality-check':
      case 'quality_check':
      case 'quality-checker':
        return 'quality_check'
      case 'render-video':
      case 'i2v_generate':
      case 'i2v-generate':
      default:
        return 'i2v_generate'
    }
  }

  private normalizeWorkerStep(value?: string): VideoWorkerStep | null {
    switch ((value || '').trim().toLowerCase()) {
      case 'analyze-source':
        return 'analyze-source'
      case 'edit-frames':
      case 'frame_edit':
      case 'frame-edit':
        return 'edit-frames'
      case 'render-video':
      case 'i2v_generate':
      case 'i2v-generate':
        return 'render-video'
      case 'generate-copy':
      case 'copy_generate':
      case 'copy-generate':
      case 'subtitle':
        return 'generate-copy'
      case 'quality-check':
      case 'quality_check':
        return 'quality-check'
      default:
        return null
    }
  }

  private mapRetryStatus(step: VideoWorkerStep) {
    switch (step) {
      case 'analyze-source':
        return VideoTaskStatus.ANALYZING
      case 'edit-frames':
        return VideoTaskStatus.EDITING
      case 'render-video':
        return VideoTaskStatus.RENDERING
      case 'quality-check':
        return VideoTaskStatus.QUALITY_CHECK
      case 'generate-copy':
        return VideoTaskStatus.GENERATING_COPY
      default:
        return VideoTaskStatus.PENDING
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

  private toOptionalObjectId(value?: string | null) {
    if (!value || !Types.ObjectId.isValid(value)) {
      return null
    }

    return new Types.ObjectId(value)
  }

  private toIterationLogResponse(item: Record<string, any>) {
    return {
      id: item['_id']?.toString?.() || null,
      videoTaskId: item['videoTaskId'],
      batchId: item['batchId'] || null,
      iteration: item['iteration'],
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
}
