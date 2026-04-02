import { InjectQueue } from '@nestjs/bullmq'
import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { OrgApiKeyProvider, VideoTask, VideoTaskStatus } from '@yikart/mongodb'
import { Queue } from 'bullmq'
import { Model, Types } from 'mongoose'
import { requestJson } from './pipeline.utils'
import type { PipelineJobContext } from './pipeline.types'
import { ByokService } from '../settings/byok.service'
import { VIDEO_WORKER_QUEUE, VideoWorkerJobData, VideoWorkerStep } from '../worker/worker.constants'

interface DeepSeekResponse {
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string
      }>
    }
  }>
}

export interface FailureAnalysisResult {
  taskId: string
  orgId?: string | null
  failedStep: string
  originalPrompt: string
  errorMessage: string
  failureReason: string
  rootCause: string
  suggestedChanges: string[]
}

export interface OptimizedPromptResult {
  taskId: string
  failedStep: string
  originalPrompt: string
  optimizedPrompt: string
  failureReason: string
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
    @Optional()
    private readonly byokService?: ByokService,
  ) {}

  async analyzeFailure(taskId: string): Promise<FailureAnalysisResult> {
    const task = await this.getTask(taskId)
    const failedStep = this.readFailedStep(task)
    const originalPrompt = this.readOriginalPrompt(task, failedStep)
    const errorMessage = this.readErrorMessage(task)

    const analysis = await this.requestFailureAnalysis({
      taskId,
      orgId: task.orgId?.toString() || null,
      failedStep,
      originalPrompt,
      errorMessage,
    })

    const optimized = await this.generateOptimizedPrompt(taskId, analysis)
    await this.persistAnalysis(task, analysis, optimized)

    return analysis
  }

  async generateOptimizedPrompt(
    taskId: string,
    failureAnalysis: FailureAnalysisResult,
  ): Promise<OptimizedPromptResult> {
    const optimizedPrompt = await this.requestOptimizedPrompt(failureAnalysis)

    return {
      taskId,
      failedStep: failureAnalysis.failedStep,
      originalPrompt: failureAnalysis.originalPrompt,
      optimizedPrompt,
      failureReason: failureAnalysis.failureReason,
    }
  }

  async retryWithOptimizedPrompt(taskId: string) {
    const task = await this.getTask(taskId)
    const failedStep = this.readFailedStep(task)
    const workerStep = this.toWorkerStep(failedStep)

    if (!workerStep) {
      throw new BadRequestException('No retryable failed step found')
    }

    if (!this.workerQueue) {
      throw new BadRequestException('Worker queue is not configured')
    }

    const optimizedPrompt = this.readOptimizedPrompt(task, failedStep)
    if (!optimizedPrompt) {
      throw new BadRequestException('Optimized prompt is not available')
    }

    const pipelineContext = this.readPipelineContext(task)
    if (!pipelineContext) {
      throw new BadRequestException('Pipeline context is not available for retry')
    }

    const nextContext: PipelineJobContext = {
      ...pipelineContext,
      prompts: {
        ...(pipelineContext.prompts || {}),
        [failedStep]: optimizedPrompt,
      },
    }

    await this.workerQueue.add(
      workerStep,
      {
        taskId: task._id.toString(),
        context: nextContext,
      },
      {
        jobId: `${task._id.toString()}:${workerStep}:optimized:${Date.now()}`,
      },
    )

    await this.videoTaskModel.findByIdAndUpdate(task._id, {
      $set: {
        status: this.mapRetryStatus(workerStep),
        errorMessage: '',
        completedAt: null,
        'metadata.failedStep': null,
        'metadata.pipelineContext': nextContext,
      },
      $push: {
        promptFixes: {
          originalPrompt: this.readOriginalPrompt(task, failedStep),
          optimizedPrompt,
          failureReason: this.readFailureReason(task),
          retriedAt: new Date(),
          result: 'retry_queued',
        },
      },
    }).exec()

    return {
      taskId: task._id.toString(),
      failedStep,
      optimizedPrompt,
      retryQueued: true,
    }
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

  private readOriginalPrompt(task: VideoTask, failedStep: string) {
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

    return `Optimize the ${failedStep} stage for task ${task._id.toString()} using source ${task.sourceVideoUrl || 'unknown source'} while preserving brand consistency.`
  }

  private readErrorMessage(task: VideoTask) {
    const latestError = [...(task.errorLog || [])].reverse()[0]
    return task.errorMessage || latestError?.message || 'Unknown pipeline failure'
  }

  private readFailureReason(task: VideoTask) {
    const lastPromptFix = [...(task.promptFixes || [])].reverse()[0]
    return lastPromptFix?.failureReason || this.readErrorMessage(task)
  }

  private readOptimizedPrompt(task: VideoTask, failedStep: string) {
    const optimizedPrompts = task.metadata?.['optimizedPrompts']
    const value = optimizedPrompts && typeof optimizedPrompts === 'object'
      ? optimizedPrompts[failedStep]
      : ''

    return typeof value === 'string' ? value.trim() : ''
  }

  private readPipelineContext(task: VideoTask): PipelineJobContext | null {
    const pipelineContext = task.metadata?.['pipelineContext']
    return pipelineContext && typeof pipelineContext === 'object'
      ? pipelineContext as PipelineJobContext
      : null
  }

  private async requestFailureAnalysis(input: {
    taskId: string
    orgId?: string | null
    failedStep: string
    originalPrompt: string
    errorMessage: string
  }): Promise<FailureAnalysisResult> {
    const provider = await this.resolveProvider(input.orgId)
    if (provider === 'deepseek') {
      const analysis = await this.requestDeepSeekAnalysis(input)
      if (analysis) {
        return analysis
      }
    }

    if (provider === 'gemini') {
      const analysis = await this.requestGeminiAnalysis(input)
      if (analysis) {
        return analysis
      }
    }

    return this.buildHeuristicAnalysis(input)
  }

  private async requestOptimizedPrompt(analysis: FailureAnalysisResult) {
    const provider = await this.resolveProvider(analysis.orgId)
    if (provider === 'deepseek') {
      const optimizedPrompt = await this.requestDeepSeekOptimizedPrompt(analysis)
      if (optimizedPrompt) {
        return optimizedPrompt
      }
    }

    if (provider === 'gemini') {
      const optimizedPrompt = await this.requestGeminiOptimizedPrompt(analysis)
      if (optimizedPrompt) {
        return optimizedPrompt
      }
    }

    return [
      analysis.originalPrompt,
      '',
      'Optimization guidance:',
      `- Focus on fixing: ${analysis.failureReason}`,
      ...analysis.suggestedChanges.map(item => `- ${item}`),
      '- Keep the output deterministic and structurally valid.',
    ].join('\n')
  }

  private async resolveProvider(orgId?: string | null) {
    const deepseekKey = await this.resolveApiKey(orgId, OrgApiKeyProvider.DEEPSEEK, 'MEDIACLAW_DEEPSEEK_API_KEY')
    if (deepseekKey) {
      return 'deepseek'
    }

    const geminiKey = await this.resolveApiKey(orgId, OrgApiKeyProvider.GEMINI, 'MEDIACLAW_GEMINI_API_KEY')
    if (geminiKey) {
      return 'gemini'
    }

    return 'heuristic'
  }
  private async resolveApiKey(
    orgId: string | null | undefined,
    provider: OrgApiKeyProvider,
    fallbackEnvName: string,
  ) {
    if (this.byokService) {
      const key = await this.byokService.getProviderRuntimeKey(orgId, provider, fallbackEnvName)
      if (key) {
        return key
      }
    }

    return process.env[fallbackEnvName]?.trim() || ''
  }
  private async requestDeepSeekAnalysis(input: {
    taskId: string
    orgId?: string | null
    failedStep: string
    originalPrompt: string
    errorMessage: string
  }) {
    const apiKey = await this.resolveApiKey(input.orgId, OrgApiKeyProvider.DEEPSEEK, 'MEDIACLAW_DEEPSEEK_API_KEY')
    if (!apiKey) {
      return null
    }

    try {
      const response = await requestJson<DeepSeekResponse>(
        `${(process.env['MEDIACLAW_DEEPSEEK_BASE_URL']?.trim() || 'https://api.deepseek.com').replace(/\/+$/, '')}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: process.env['MEDIACLAW_DEEPSEEK_MODEL']?.trim() || 'deepseek-chat',
            messages: [
              { role: 'system', content: 'Return valid JSON only.' },
              {
                role: 'user',
                content: [
                  'Analyze a MediaClaw pipeline failure and return JSON with fields:',
                  'failureReason, rootCause, suggestedChanges.',
                  `taskId: ${input.taskId}`,
                  `failedStep: ${input.failedStep}`,
                  `errorMessage: ${input.errorMessage}`,
                  `originalPrompt: ${input.originalPrompt}`,
                ].join('\n'),
              },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.2,
          }),
          timeoutMs: 60_000,
        },
      )

      const content = response.choices?.[0]?.message?.content
      return this.normalizeAnalysisPayload(input, this.safeParseJson(content))
    }
    catch (error) {
      this.logger.warn(`Prompt optimizer deepseek analysis failed: ${error instanceof Error ? error.message : String(error)}`)
      return null
    }
  }

  private async requestGeminiAnalysis(input: {
    taskId: string
    orgId?: string | null
    failedStep: string
    originalPrompt: string
    errorMessage: string
  }) {
    const apiKey = await this.resolveApiKey(input.orgId, OrgApiKeyProvider.GEMINI, 'MEDIACLAW_GEMINI_API_KEY')
    if (!apiKey) {
      return null
    }

    try {
      const model = process.env['MEDIACLAW_GEMINI_MODEL']?.trim() || 'gemini-2.5-flash'
      const response = await requestJson<GeminiResponse>(
        `${(process.env['MEDIACLAW_GEMINI_BASE_URL']?.trim() || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '')}/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text: [
                      'Analyze a MediaClaw pipeline failure and return JSON with fields:',
                      'failureReason, rootCause, suggestedChanges.',
                      `taskId: ${input.taskId}`,
                      `failedStep: ${input.failedStep}`,
                      `errorMessage: ${input.errorMessage}`,
                      `originalPrompt: ${input.originalPrompt}`,
                    ].join('\n'),
                  },
                ],
              },
            ],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.2,
            },
          }),
          timeoutMs: 60_000,
        },
      )

      const content = response.candidates?.[0]?.content?.parts?.[0]?.text
      return this.normalizeAnalysisPayload(input, this.safeParseJson(content))
    }
    catch (error) {
      this.logger.warn(`Prompt optimizer gemini analysis failed: ${error instanceof Error ? error.message : String(error)}`)
      return null
    }
  }

  private async requestDeepSeekOptimizedPrompt(analysis: FailureAnalysisResult) {
    const apiKey = await this.resolveApiKey(analysis.orgId, OrgApiKeyProvider.DEEPSEEK, 'MEDIACLAW_DEEPSEEK_API_KEY')
    if (!apiKey) {
      return null
    }

    try {
      const response = await requestJson<DeepSeekResponse>(
        `${(process.env['MEDIACLAW_DEEPSEEK_BASE_URL']?.trim() || 'https://api.deepseek.com').replace(/\/+$/, '')}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: process.env['MEDIACLAW_DEEPSEEK_MODEL']?.trim() || 'deepseek-chat',
            messages: [
              { role: 'system', content: 'Return plain text only.' },
              {
                role: 'user',
                content: [
                  'Rewrite the following MediaClaw pipeline prompt so the failed step is more robust.',
                  `failedStep: ${analysis.failedStep}`,
                  `failureReason: ${analysis.failureReason}`,
                  `rootCause: ${analysis.rootCause}`,
                  `suggestedChanges: ${analysis.suggestedChanges.join('; ')}`,
                  'originalPrompt:',
                  analysis.originalPrompt,
                ].join('\n'),
              },
            ],
            temperature: 0.4,
          }),
          timeoutMs: 60_000,
        },
      )

      return response.choices?.[0]?.message?.content?.trim() || null
    }
    catch (error) {
      this.logger.warn(`Prompt optimizer deepseek rewrite failed: ${error instanceof Error ? error.message : String(error)}`)
      return null
    }
  }

  private async requestGeminiOptimizedPrompt(analysis: FailureAnalysisResult) {
    const apiKey = await this.resolveApiKey(analysis.orgId, OrgApiKeyProvider.GEMINI, 'MEDIACLAW_GEMINI_API_KEY')
    if (!apiKey) {
      return null
    }

    try {
      const model = process.env['MEDIACLAW_GEMINI_MODEL']?.trim() || 'gemini-2.5-flash'
      const response = await requestJson<GeminiResponse>(
        `${(process.env['MEDIACLAW_GEMINI_BASE_URL']?.trim() || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '')}/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text: [
                      'Rewrite the following MediaClaw pipeline prompt so the failed step is more robust.',
                      `failedStep: ${analysis.failedStep}`,
                      `failureReason: ${analysis.failureReason}`,
                      `rootCause: ${analysis.rootCause}`,
                      `suggestedChanges: ${analysis.suggestedChanges.join('; ')}`,
                      'originalPrompt:',
                      analysis.originalPrompt,
                    ].join('\n'),
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.4,
            },
          }),
          timeoutMs: 60_000,
        },
      )

      return response.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null
    }
    catch (error) {
      this.logger.warn(`Prompt optimizer gemini rewrite failed: ${error instanceof Error ? error.message : String(error)}`)
      return null
    }
  }

  private buildHeuristicAnalysis(input: {
    taskId: string
    orgId?: string | null
    failedStep: string
    originalPrompt: string
    errorMessage: string
  }): FailureAnalysisResult {
    const message = input.errorMessage.toLowerCase()
    let failureReason = 'Prompt is not robust enough for the downstream provider'
    let rootCause = 'Prompt constraints are underspecified'
    const suggestedChanges = [
      'Add stricter structure and output constraints',
      'Reduce ambiguity and remove conflicting instructions',
      'Keep provider-specific requirements explicit',
    ]

    if (message.includes('timeout')) {
      failureReason = 'Provider timed out while processing the request'
      rootCause = 'Prompt or payload is too large or too open-ended'
      suggestedChanges.unshift('Shorten the prompt and reduce unnecessary context')
    }
    else if (message.includes('401') || message.includes('403') || message.includes('unauthorized')) {
      failureReason = 'Provider credentials are invalid or missing'
      rootCause = 'Authentication failed before prompt execution'
      suggestedChanges.unshift('Validate provider credentials before retrying')
    }
    else if (message.includes('json') || message.includes('parse')) {
      failureReason = 'Provider returned an invalid structured response'
      rootCause = 'Prompt does not constrain the response format enough'
      suggestedChanges.unshift('Explicitly require a single deterministic response format')
    }

    return {
      taskId: input.taskId,
      orgId: input.orgId || null,
      failedStep: input.failedStep,
      originalPrompt: input.originalPrompt,
      errorMessage: input.errorMessage,
      failureReason,
      rootCause,
      suggestedChanges,
    }
  }

  private normalizeAnalysisPayload(
    input: {
      taskId: string
      orgId?: string | null
      failedStep: string
      originalPrompt: string
      errorMessage: string
    },
    payload: Record<string, any> | null,
  ) {
    if (!payload) {
      return null
    }

    const suggestedChanges = Array.isArray(payload['suggestedChanges'])
      ? payload['suggestedChanges'].map(item => typeof item === 'string' ? item.trim() : '').filter(Boolean)
      : []

    return {
      taskId: input.taskId,
      orgId: input.orgId || null,
      failedStep: input.failedStep,
      originalPrompt: input.originalPrompt,
      errorMessage: input.errorMessage,
      failureReason: typeof payload['failureReason'] === 'string' && payload['failureReason'].trim()
        ? payload['failureReason'].trim()
        : 'Prompt is not robust enough for the downstream provider',
      rootCause: typeof payload['rootCause'] === 'string' && payload['rootCause'].trim()
        ? payload['rootCause'].trim()
        : 'Prompt constraints are underspecified',
      suggestedChanges: suggestedChanges.length > 0
        ? suggestedChanges
        : ['Add stricter structure and output constraints'],
    }
  }

  private async persistAnalysis(
    task: VideoTask,
    analysis: FailureAnalysisResult,
    optimized: OptimizedPromptResult,
  ) {
    const failedStep = analysis.failedStep
    const optimizedPrompts = {
      ...(task.metadata?.['optimizedPrompts'] || {}),
      [failedStep]: optimized.optimizedPrompt,
    }

    await this.videoTaskModel.findByIdAndUpdate(task._id, {
      $set: {
        'metadata.promptOptimizer.lastAnalysis': analysis,
        'metadata.optimizedPrompts': optimizedPrompts,
      },
      $push: {
        promptFixes: {
          originalPrompt: analysis.originalPrompt,
          optimizedPrompt: optimized.optimizedPrompt,
          failureReason: analysis.failureReason,
          retriedAt: null,
          result: 'analyzed',
        },
      },
    }).exec()
  }

  private safeParseJson(content?: string) {
    if (!content?.trim()) {
      return null
    }

    try {
      return JSON.parse(content) as Record<string, any>
    }
    catch {
      return null
    }
  }

  private toWorkerStep(step: string): VideoWorkerStep | null {
    const candidates: VideoWorkerStep[] = [
      'analyze-source',
      'edit-frames',
      'render-video',
      'quality-check',
      'generate-copy',
    ]

    return candidates.includes(step as VideoWorkerStep)
      ? step as VideoWorkerStep
      : null
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
}
