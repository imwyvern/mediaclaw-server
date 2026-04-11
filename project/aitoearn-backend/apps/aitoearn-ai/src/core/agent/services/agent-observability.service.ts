import { Injectable } from '@nestjs/common'
import { AgentInvocationLogRepository } from '@yikart/mongodb'
import {
  ProductAgentInvocationResult,
  ProductAgentStepResult,
  ProductAgentTokenUsage,
} from '../agent-product.types'

@Injectable()
export class AgentObservabilityService {
  constructor(
    private readonly agentInvocationLogRepository: AgentInvocationLogRepository,
  ) {}

  async startLog(params: {
    agentId: string
    version: string
    userId: string
    orgId?: string
    input: Record<string, unknown>
    variantLabel: string
    rolloutStrategy: string
  }) {
    return this.agentInvocationLogRepository.create({
      agentId: params.agentId,
      version: params.version,
      userId: params.userId,
      orgId: params.orgId || '',
      status: 'running',
      input: params.input,
      output: {},
      trace: [],
      metadata: {
        variantLabel: params.variantLabel,
        rolloutStrategy: params.rolloutStrategy,
      },
    })
  }

  async finishSuccess(
    invocationId: string,
    result: ProductAgentInvocationResult,
    trace: ProductAgentStepResult[],
  ) {
    return this.agentInvocationLogRepository.updateByInvocationId(invocationId, {
      status: 'success',
      output: result.output,
      latencyMs: result.latencyMs,
      costUsd: result.costUsd,
      tokenUsage: result.tokenUsage,
      trace: this.toStoredTrace(trace),
    })
  }

  async finishFailure(
    invocationId: string,
    errorMessage: string,
    latencyMs: number,
    trace: ProductAgentStepResult[],
  ) {
    const aggregate = this.aggregateTrace(trace)

    return this.agentInvocationLogRepository.updateByInvocationId(invocationId, {
      status: 'failed',
      errorMessage,
      latencyMs,
      costUsd: aggregate.costUsd,
      tokenUsage: aggregate.tokenUsage,
      trace: this.toStoredTrace(trace),
    })
  }

  async listLogs(
    agentId: string,
    scope: {
      userId: string
      orgId?: string
      page: number
      pageSize: number
      status?: 'running' | 'success' | 'failed'
    },
  ) {
    return this.agentInvocationLogRepository.listVisibleByAgentIdWithPagination(agentId, scope)
  }

  aggregateTrace(trace: ProductAgentStepResult[]) {
    return trace.reduce<{
      costUsd: number
      tokenUsage: ProductAgentStepResult['tokenUsage']
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
        tokenUsage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          totalTokens: 0,
        },
      },
    )
  }

  private toStoredTrace(trace: ProductAgentStepResult[]) {
    return trace.map((item) => {
      const completedAt = new Date()
      const startedAt = new Date(completedAt.getTime() - Math.max(item.latencyMs, 0))

      return {
        stageId: item.stageId,
        stepId: item.stepId,
        role: item.role,
        status: item.status,
        skipped: Boolean(item.skipped),
        conditionMatched: item.conditionMatched,
        latencyMs: item.latencyMs,
        tokenUsage: this.normalizeTokenUsage(item.tokenUsage),
        costUsd: item.costUsd,
        input: item.input,
        output: item.output,
        errorMessage: item.errorMessage || '',
        startedAt,
        completedAt,
      }
    })
  }

  private normalizeTokenUsage(tokenUsage: ProductAgentTokenUsage): ProductAgentTokenUsage {
    return {
      inputTokens: Number(tokenUsage.inputTokens || 0),
      outputTokens: Number(tokenUsage.outputTokens || 0),
      cacheCreationInputTokens: Number(tokenUsage.cacheCreationInputTokens || 0),
      cacheReadInputTokens: Number(tokenUsage.cacheReadInputTokens || 0),
      totalTokens: Number(tokenUsage.totalTokens || 0),
    }
  }
}
