import { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { ContentBlockParam } from '@anthropic-ai/sdk/resources'
import { Injectable } from '@nestjs/common'
import {
  ProductAgentExecutionInput,
  ProductAgentInvocationResult,
  ProductAgentStepResult,
  ProductAgentStepRunContext,
  ProductAgentStepRunResponse,
  ProductAgentTokenUsage,
} from '../agent-product.types'
import { SYSTEM_PROMPT } from '../agent.constants'
import { enhancePrompt, normalizePrompt } from '../agent.utils'
import { AgentRoleRegistryService } from './agent-role-registry.service'
import { AgentRuntimeService } from './agent-runtime.service'

@Injectable()
export class AgentProductOrchestratorService {
  constructor(
    private readonly agentRuntimeService: AgentRuntimeService,
    private readonly agentRoleRegistryService: AgentRoleRegistryService,
  ) {}

  async execute(input: ProductAgentExecutionInput): Promise<ProductAgentInvocationResult> {
    const startedAt = Date.now()
    const trace: ProductAgentStepResult[] = []
    const priorOutputs: Record<string, unknown> = {}

    for (const stage of input.definition.stages) {
      const conditionMatched = this.evaluateCondition(stage.condition || null, input.payload, priorOutputs)

      if (stage.mode === 'conditional' && !conditionMatched) {
        for (const step of stage.steps) {
          trace.push(this.createSkippedTrace(stage.id, step.id, step.role, {
            prompt: input.prompt,
            payload: input.payload,
            priorOutputs,
          }))
        }
        continue
      }

      if (stage.mode === 'parallel') {
        const stageResults = await Promise.all(stage.steps.map(async (step) => {
          try {
            const result = await this.runStep({
              prompt: input.prompt,
              payload: input.payload,
              priorOutputs,
              definition: input.definition,
              step,
              runtimeResources: input.runtimeResources,
            }, stage.id, conditionMatched)
            return { ok: true as const, result }
          }
          catch (error) {
            return { ok: false as const, error, step }
          }
        }))

        const failedResult = stageResults.find(item => !item.ok)
        if (failedResult && !failedResult.ok) {
          trace.push(this.buildFailedTrace(stage.id, failedResult.step.id, failedResult.step.role, {
            prompt: input.prompt,
            payload: input.payload,
            priorOutputs,
          }, failedResult.error, conditionMatched))
          throw this.attachTraceToError(failedResult.error, trace)
        }

        for (let index = 0; index < stage.steps.length; index++) {
          const step = stage.steps[index]!
          const result = stageResults[index]!
          if (!result.ok) {
            continue
          }
          const traceEntry = this.buildTraceEntry(stage.id, step.id, step.role, {
            prompt: input.prompt,
            payload: input.payload,
            priorOutputs,
          }, result.result, conditionMatched)
          trace.push(traceEntry)
          this.assignOutput(priorOutputs, step.outputKey || step.id, result.result.output)
        }

        continue
      }

      for (const step of stage.steps) {
        let result: ProductAgentStepRunResponse
        try {
          result = await this.runStep({
            prompt: input.prompt,
            payload: input.payload,
            priorOutputs,
            definition: input.definition,
            step,
            runtimeResources: input.runtimeResources,
          }, stage.id, conditionMatched)
        }
        catch (error) {
          trace.push(this.buildFailedTrace(stage.id, step.id, step.role, {
            prompt: input.prompt,
            payload: input.payload,
            priorOutputs,
          }, error, conditionMatched))
          throw this.attachTraceToError(error, trace)
        }

        trace.push(this.buildTraceEntry(stage.id, step.id, step.role, {
          prompt: input.prompt,
          payload: input.payload,
          priorOutputs,
        }, result, conditionMatched))
        this.assignOutput(priorOutputs, step.outputKey || step.id, result.output)
      }
    }

    const aggregate = this.aggregateTrace(trace)
    const finalOutput = this.buildFinalOutput(priorOutputs, trace)

    return {
      invocationId: '',
      agentId: input.definition.agentId,
      version: input.definition.version,
      variantLabel: input.variantLabel,
      latencyMs: Date.now() - startedAt,
      costUsd: aggregate.costUsd,
      tokenUsage: aggregate.tokenUsage,
      output: finalOutput,
      trace,
    }
  }

  private async runStep(
    context: ProductAgentStepRunContext,
    stageId: string,
    _conditionMatched: boolean,
  ): Promise<ProductAgentStepRunResponse> {
    const roleDefinition = this.agentRoleRegistryService.getRole(context.step.role as never)
    const stepPrompt = this.buildStepPrompt(context, stageId)
    const enhancedContent = enhancePrompt(normalizePrompt(stepPrompt))
    const systemPromptContent: ContentBlockParam[] = [
      { type: 'text', text: SYSTEM_PROMPT },
      { type: 'text', text: roleDefinition.prompt },
      {
        type: 'text',
        text: `You are executing productized agent ${context.definition.name}@${context.definition.version}. Return structured, decision-ready output for downstream stages.`,
      },
    ]
    const scopedServers = this.pickScopedServers(
      context.runtimeResources.mcpServers,
      context.step.serverNames.length ? context.step.serverNames : roleDefinition.defaultServers,
    )
    const abortController = new AbortController()
    const timeoutHandle = setTimeout(() => abortController.abort(), context.definition.execution.timeoutMs)
    const startedAt = Date.now()
    let assistantText = ''
    let finalText = ''
    let finalUsage: ProductAgentTokenUsage = this.createEmptyUsage()
    let finalCostUsd = 0

    try {
      for await (const chunk of this.agentRuntimeService.claudeQuery(
        systemPromptContent,
        enhancedContent,
        abortController,
        {
          includePartialMessages: false,
          model: context.definition.execution.model,
          maxBudgetUsd: this.resolveBudget(context.definition.execution.maxBudgetUsd, context.runtimeResources.maxBudgetUsd),
          persistSession: false,
        },
        scopedServers,
      )) {
        assistantText += this.extractAssistantText(chunk)

        if (chunk.type === 'result') {
          const resultRecord = chunk as unknown as Record<string, unknown>
          finalText = this.extractResultText(chunk, assistantText)
          finalUsage = this.normalizeUsage(this.asRecord(resultRecord['usage']) || this.asRecord(resultRecord['modelUsage']))
          finalCostUsd = Number(resultRecord['total_cost_usd'] || 0)
        }
      }
    }
    finally {
      clearTimeout(timeoutHandle)
    }

    return {
      output: {
        summary: finalText || assistantText.trim(),
        stageId,
        role: context.step.role,
      },
      tokenUsage: finalUsage,
      costUsd: finalCostUsd,
      latencyMs: Date.now() - startedAt,
      transcript: enhancedContent,
    }
  }

  private buildStepPrompt(context: ProductAgentStepRunContext, stageId: string) {
    return [
      `Agent: ${context.definition.name}`,
      `Version: ${context.definition.version}`,
      `Stage: ${stageId}`,
      `Step: ${context.step.name}`,
      `User prompt: ${context.prompt}`,
      `Structured payload: ${JSON.stringify(context.payload, null, 2)}`,
      `Previous outputs: ${JSON.stringify(context.priorOutputs, null, 2)}`,
      `Step instructions: ${context.step.promptTemplate}`,
      'Return a concise JSON-like response with summary, keyActions, risks, and deliverables fields when applicable.',
    ].join('\n\n')
  }

  private buildTraceEntry(
    stageId: string,
    stepId: string,
    role: string,
    input: {
      prompt: string
      payload: Record<string, unknown>
      priorOutputs: Record<string, unknown>
    },
    result: ProductAgentStepRunResponse,
    conditionMatched: boolean,
  ): ProductAgentStepResult {
    return {
      stageId,
      stepId,
      role,
      status: 'success',
      latencyMs: result.latencyMs,
      conditionMatched,
      input: {
        prompt: input.prompt,
        payload: this.cloneRecord(input.payload),
        priorOutputs: this.cloneRecord(input.priorOutputs),
      },
      output: result.output,
      tokenUsage: result.tokenUsage,
      costUsd: result.costUsd,
    }
  }

  private createSkippedTrace(
    stageId: string,
    stepId: string,
    role: string,
    input: {
      prompt: string
      payload: Record<string, unknown>
      priorOutputs: Record<string, unknown>
    },
  ): ProductAgentStepResult {
    return {
      stageId,
      stepId,
      role,
      status: 'skipped',
      latencyMs: 0,
      conditionMatched: false,
      input: {
        prompt: input.prompt,
        payload: this.cloneRecord(input.payload),
        priorOutputs: this.cloneRecord(input.priorOutputs),
      },
      output: {},
      tokenUsage: this.createEmptyUsage(),
      costUsd: 0,
      skipped: true,
    }
  }

  private buildFailedTrace(
    stageId: string,
    stepId: string,
    role: string,
    input: {
      prompt: string
      payload: Record<string, unknown>
      priorOutputs: Record<string, unknown>
    },
    error: unknown,
    conditionMatched: boolean,
  ): ProductAgentStepResult {
    return {
      stageId,
      stepId,
      role,
      status: 'failed',
      latencyMs: 0,
      conditionMatched,
      input: {
        prompt: input.prompt,
        payload: this.cloneRecord(input.payload),
        priorOutputs: this.cloneRecord(input.priorOutputs),
      },
      output: {},
      errorMessage: error instanceof Error ? error.message : 'Agent step failed',
      tokenUsage: this.createEmptyUsage(),
      costUsd: 0,
    }
  }

  private buildFinalOutput(priorOutputs: Record<string, unknown>, trace: ProductAgentStepResult[]) {
    if (Object.keys(priorOutputs).length > 0) {
      return priorOutputs
    }

    const lastSuccessful = [...trace].reverse().find(item => item.status === 'success')
    return lastSuccessful?.output || {}
  }

  private evaluateCondition(
    condition: {
      source: 'input' | 'context'
      path: string
      operator: 'exists' | 'equals' | 'includes'
      value?: unknown
    } | null,
    payload: Record<string, unknown>,
    priorOutputs: Record<string, unknown>,
  ) {
    if (!condition) {
      return true
    }

    const source = condition.source === 'context' ? priorOutputs : payload
    const value = this.readPath(source, condition.path)

    switch (condition.operator) {
      case 'equals':
        return value === condition.value
      case 'includes':
        return Array.isArray(value) ? value.includes(condition.value) : false
      case 'exists':
      default:
        if (Array.isArray(value)) {
          return value.length > 0
        }
        return value !== undefined && value !== null && value !== ''
    }
  }

  private readPath(source: Record<string, unknown>, path: string) {
    return path.split('.').reduce<unknown>((current, segment) => {
      if (current && typeof current === 'object' && segment in current) {
        return (current as Record<string, unknown>)[segment]
      }
      return undefined
    }, source)
  }

  private assignOutput(target: Record<string, unknown>, key: string, value: Record<string, unknown>) {
    if (!key) {
      return
    }

    target[key] = value
  }

  private cloneRecord(record: Record<string, unknown>) {
    return JSON.parse(JSON.stringify(record))
  }

  private attachTraceToError(error: unknown, trace: ProductAgentStepResult[]) {
    const resolvedError = error instanceof Error ? error : new Error('Agent execution failed')
    return Object.assign(resolvedError, {
      agentTrace: [...trace],
    })
  }

  private pickScopedServers(
    allServers: ProductAgentStepRunContext['runtimeResources']['mcpServers'],
    requestedServers: string[],
  ) {
    return requestedServers.reduce<Record<string, ProductAgentStepRunContext['runtimeResources']['mcpServers'][string]>>((accumulator, serverName) => {
      if (allServers[serverName]) {
        accumulator[serverName] = allServers[serverName]
      }
      return accumulator
    }, {})
  }

  private resolveBudget(agentBudget: number, runtimeBudget?: number) {
    if (agentBudget > 0 && runtimeBudget && runtimeBudget > 0) {
      return Math.min(agentBudget, runtimeBudget)
    }

    return agentBudget > 0 ? agentBudget : runtimeBudget
  }

  private extractAssistantText(chunk: SDKMessage) {
    if (chunk.type !== 'assistant' || !chunk.message?.content) {
      return ''
    }

    return chunk.message.content
      .map((block) => {
        if (block.type === 'text') {
          return block.text || ''
        }
        return ''
      })
      .join('')
  }

  private extractResultText(chunk: SDKMessage, assistantText: string) {
    if (chunk.type !== 'result') {
      return assistantText.trim()
    }

    const record = chunk as unknown as Record<string, unknown>
    const message = record['message']
    if (typeof message === 'string' && message.trim()) {
      return message.trim()
    }

    const result = record['result']
    if (typeof result === 'string' && result.trim()) {
      return result.trim()
    }

    const structuredOutput = record['structured_output']
    if (structuredOutput && typeof structuredOutput === 'object') {
      return JSON.stringify(structuredOutput)
    }

    return assistantText.trim()
  }

  private normalizeUsage(rawUsage: Record<string, unknown> | undefined): ProductAgentTokenUsage {
    if (!rawUsage) {
      return this.createEmptyUsage()
    }

    const inputTokens = Number(rawUsage['input_tokens'] || rawUsage['inputTokens'] || 0)
    const outputTokens = Number(rawUsage['output_tokens'] || rawUsage['outputTokens'] || 0)
    const cacheCreationInputTokens = Number(rawUsage['cache_creation_input_tokens'] || rawUsage['cacheCreationInputTokens'] || 0)
    const cacheReadInputTokens = Number(rawUsage['cache_read_input_tokens'] || rawUsage['cacheReadInputTokens'] || 0)

    return {
      inputTokens,
      outputTokens,
      cacheCreationInputTokens,
      cacheReadInputTokens,
      totalTokens: inputTokens + outputTokens + cacheCreationInputTokens + cacheReadInputTokens,
    }
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' ? value as Record<string, unknown> : undefined
  }

  private createEmptyUsage(): ProductAgentTokenUsage {
    return {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      totalTokens: 0,
    }
  }

  private aggregateTrace(trace: ProductAgentStepResult[]) {
    return trace.reduce<{
      costUsd: number
      tokenUsage: ProductAgentTokenUsage
    }>(
      (accumulator, item) => {
        accumulator.costUsd += item.costUsd
        accumulator.tokenUsage.inputTokens += item.tokenUsage.inputTokens
        accumulator.tokenUsage.outputTokens += item.tokenUsage.outputTokens
        accumulator.tokenUsage.cacheCreationInputTokens += item.tokenUsage.cacheCreationInputTokens
        accumulator.tokenUsage.cacheReadInputTokens += item.tokenUsage.cacheReadInputTokens
        accumulator.tokenUsage.totalTokens += item.tokenUsage.totalTokens
        return accumulator
      },
      {
        costUsd: 0,
        tokenUsage: this.createEmptyUsage(),
      },
    )
  }
}
