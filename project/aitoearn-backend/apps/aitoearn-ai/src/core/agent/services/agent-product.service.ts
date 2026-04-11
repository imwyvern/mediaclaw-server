import { Injectable } from '@nestjs/common'
import { UserType } from '@yikart/common'
import { Request } from 'express'
import {
  ProductAgentDefinition,
  ProductAgentInvocationInput,
  ProductAgentInvocationResult,
} from '../agent-product.types'
import { AgentObservabilityService } from './agent-observability.service'
import { AgentProductOrchestratorService } from './agent-product-orchestrator.service'
import { AgentRegistryService } from './agent-registry.service'
import { AgentRuntimeService } from './agent-runtime.service'
import { AgentVersioningService } from './agent-versioning.service'

@Injectable()
export class AgentProductService {
  constructor(
    private readonly agentRegistryService: AgentRegistryService,
    private readonly agentVersioningService: AgentVersioningService,
    private readonly agentRuntimeService: AgentRuntimeService,
    private readonly agentProductOrchestratorService: AgentProductOrchestratorService,
    private readonly agentObservabilityService: AgentObservabilityService,
  ) {}

  async listAgents() {
    const definitions = await this.agentRegistryService.listAgents()
    return Promise.all(definitions.map(async (definition) => {
      const versions = await this.agentRegistryService.listAgentVersions(definition.agentId)
      return this.toListItem(definition, versions)
    }))
  }

  async invokeAgent(
    agentId: string,
    userId: string,
    orgId: string | undefined,
    dto: ProductAgentInvocationInput,
    req?: Request,
  ): Promise<ProductAgentInvocationResult> {
    const resolved = await this.agentVersioningService.resolveVersion(agentId, userId, dto.targetVersion)
    const invocationLog = await this.agentObservabilityService.startLog({
      agentId,
      version: resolved.definition.version,
      userId,
      orgId,
      input: {
        prompt: dto.prompt,
        payload: dto.payload,
      },
      variantLabel: resolved.variantLabel,
      rolloutStrategy: resolved.definition.rolloutStrategy,
    })
    const startedAt = Date.now()
    const trace: ProductAgentInvocationResult['trace'] = []

    try {
      const runtimeResources = await this.agentRuntimeService.buildRuntimeResources({
        userId,
        userType: UserType.User,
        headers: req?.headers,
      })
      const result = await this.agentProductOrchestratorService.execute({
        definition: resolved.definition,
        variantLabel: resolved.variantLabel,
        userId,
        orgId,
        prompt: dto.prompt,
        payload: dto.payload,
        runtimeResources,
      })

      result.invocationId = invocationLog.invocationId
      trace.push(...result.trace)
      await this.agentObservabilityService.finishSuccess(invocationLog.invocationId, result, result.trace)
      return result
    }
    catch (error) {
      const errorTrace = error && typeof error === 'object' && 'agentTrace' in error
        ? ((error as { agentTrace?: ProductAgentInvocationResult['trace'] }).agentTrace || [])
        : []

      await this.agentObservabilityService.finishFailure(
        invocationLog.invocationId,
        error instanceof Error ? error.message : 'Agent invocation failed',
        Date.now() - startedAt,
        errorTrace.length > 0 ? errorTrace : trace,
      )
      throw error
    }
  }

  async getAgentLogs(
    agentId: string,
    scope: {
      userId: string
      orgId?: string
      page: number
      pageSize: number
      status?: 'running' | 'success' | 'failed'
    },
  ) {
    return this.agentObservabilityService.listLogs(agentId, scope)
  }

  private toListItem(definition: ProductAgentDefinition, versions: ProductAgentDefinition[]) {
    return {
      agentId: definition.agentId,
      name: definition.name,
      description: definition.description,
      category: definition.category,
      capabilities: definition.capabilities,
      tags: definition.tags,
      defaultVersion: definition.version,
      availableVersions: versions.map(version => version.version),
      rolloutStrategy: definition.rolloutStrategy,
      rolloutTargets: definition.rolloutTargets,
      schema: definition.schema,
      execution: definition.execution,
      stages: definition.stages,
      metadata: definition.metadata,
    }
  }
}
