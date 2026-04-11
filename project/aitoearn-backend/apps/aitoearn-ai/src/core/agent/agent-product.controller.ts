import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { GetToken, TokenInfo } from '@yikart/aitoearn-auth'
import { ApiDoc } from '@yikart/common'
import { Request } from 'express'
import { z } from 'zod'
import { InvokeAgentDto, InvokeAgentDtoSchema, ListAgentLogsDto, ListAgentLogsDtoSchema } from './agent-product.dto'
import {
  ProductAgentInvokeVo,
  ProductAgentInvokeVoSchema,
  ProductAgentListVo,
  ProductAgentListVoSchema,
  ProductAgentLogItemVo,
  ProductAgentLogItemVoSchema,
  ProductAgentLogListVo,
  ProductAgentStepTraceVoSchema,
} from './agent-product.vo'
import { AgentProductService } from './services/agent-product.service'

type ProductAgentLogStatus = z.infer<typeof ProductAgentLogItemVoSchema>['status']
type ProductAgentTraceItem = z.infer<typeof ProductAgentStepTraceVoSchema>

@ApiTags('Me/Agents')
@Controller()
export class AgentProductController {
  constructor(
    private readonly agentProductService: AgentProductService,
  ) {}

  @ApiDoc({
    summary: 'List registered productized agents',
    response: ProductAgentListVoSchema,
  })
  @Get('agents')
  async listAgents() {
    const items = await this.agentProductService.listAgents()
    return ProductAgentListVo.from(items)
  }

  @ApiDoc({
    summary: 'Invoke a productized agent',
    body: InvokeAgentDtoSchema,
    response: ProductAgentInvokeVoSchema,
  })
  @Post('agents/:id/invoke')
  async invokeAgent(
    @GetToken() token: TokenInfo,
    @Param('id') agentId: string,
    @Body() body: InvokeAgentDto,
    @Req() req: Request,
  ) {
    const tokenRecord = token as TokenInfo & { orgId?: unknown }
    const tokenOrgId = typeof tokenRecord.orgId === 'string' ? tokenRecord.orgId : undefined
    const result = await this.agentProductService.invokeAgent(
      agentId,
      token.id,
      tokenOrgId,
      body,
      req,
    )
    return ProductAgentInvokeVo.create(result)
  }

  @ApiDoc({
    summary: 'List agent invocation logs',
    query: ListAgentLogsDtoSchema,
    response: ProductAgentLogListVo,
  })
  @Get('agents/:id/logs')
  async getAgentLogs(
    @GetToken() token: TokenInfo,
    @Param('id') agentId: string,
    @Query() query: ListAgentLogsDto,
  ) {
    const tokenRecord = token as TokenInfo & { orgId?: unknown }
    const tokenOrgId = typeof tokenRecord.orgId === 'string' ? tokenRecord.orgId : undefined
    const [items, total] = await this.agentProductService.getAgentLogs(agentId, {
      userId: token.id,
      orgId: tokenOrgId,
      page: query.page,
      pageSize: query.pageSize,
      status: query.status,
    })

    return new ProductAgentLogListVo(
      items.map(item => ProductAgentLogItemVo.create({
        invocationId: item.invocationId,
        agentId: item.agentId,
        version: item.version,
        status: this.normalizeInvocationStatus(item.status),
        latencyMs: Number(item.latencyMs || 0),
        costUsd: Number(item.costUsd || 0),
        tokenUsage: {
          inputTokens: Number(item.tokenUsage?.inputTokens || 0),
          outputTokens: Number(item.tokenUsage?.outputTokens || 0),
          cacheCreationInputTokens: Number(item.tokenUsage?.cacheCreationInputTokens || 0),
          cacheReadInputTokens: Number(item.tokenUsage?.cacheReadInputTokens || 0),
          totalTokens: Number(item.tokenUsage?.totalTokens || 0),
        },
        input: item.input || {},
        output: item.output || {},
        trace: this.normalizeTrace(item.trace),
        errorMessage: item.errorMessage || '',
        metadata: item.metadata || {},
        createdAt: item.createdAt,
      })),
      total,
      {
        page: query.page,
        pageSize: query.pageSize,
      },
    )
  }

  private normalizeInvocationStatus(status: unknown): ProductAgentLogStatus {
    if (status === 'running' || status === 'success' || status === 'failed') {
      return status
    }
    return 'failed'
  }

  private normalizeTrace(trace: unknown): ProductAgentTraceItem[] {
    if (!Array.isArray(trace)) {
      return []
    }

    return trace.map((item) => {
      const record = item && typeof item === 'object' ? item as Record<string, unknown> : {}
      const tokenUsage = record['tokenUsage']
      const tokenUsageRecord = tokenUsage && typeof tokenUsage === 'object'
        ? tokenUsage as Record<string, unknown>
        : {}

      return {
        stageId: String(record['stageId'] || ''),
        stepId: String(record['stepId'] || ''),
        role: String(record['role'] || ''),
        status: this.normalizeTraceStatus(record['status']),
        latencyMs: Number(record['latencyMs'] || 0),
        conditionMatched: Boolean(record['conditionMatched'] ?? true),
        input: this.normalizeRecord(record['input']),
        output: this.normalizeRecord(record['output']),
        errorMessage: record['errorMessage'] ? String(record['errorMessage']) : undefined,
        tokenUsage: {
          inputTokens: Number(tokenUsageRecord['inputTokens'] || 0),
          outputTokens: Number(tokenUsageRecord['outputTokens'] || 0),
          cacheCreationInputTokens: Number(tokenUsageRecord['cacheCreationInputTokens'] || 0),
          cacheReadInputTokens: Number(tokenUsageRecord['cacheReadInputTokens'] || 0),
          totalTokens: Number(tokenUsageRecord['totalTokens'] || 0),
        },
        costUsd: Number(record['costUsd'] || 0),
      }
    })
  }

  private normalizeTraceStatus(status: unknown): ProductAgentTraceItem['status'] {
    if (status === 'success' || status === 'failed' || status === 'skipped') {
      return status
    }
    return 'failed'
  }

  private normalizeRecord(value: unknown) {
    return value && typeof value === 'object' ? value as Record<string, unknown> : {}
  }
}
