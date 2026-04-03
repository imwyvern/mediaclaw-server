import { Body, Get, Param, Post, Query } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'

import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { ProductionOrchestratorService } from './production-orchestrator.service'

@MediaClawApiController('api/v1/production')
export class ProductionController {
  constructor(private readonly productionOrchestratorService: ProductionOrchestratorService) {}

  @Post('batches')
  async createBatch(
    @GetToken() user: { orgId?: string, id?: string },
    @Body()
    body: {
      templateId?: string
      count?: number
      pipelineId?: string
      brandId?: string
      brandAssets?: string[]
      styleOverrides?: Record<string, unknown>
      referenceVideoUrl?: string
    },
  ) {
    return this.productionOrchestratorService.createBatch(
      user.orgId || user.id || '',
      user.id || user.orgId || '',
      body,
    )
  }

  @Get('batches')
  async listBatches(
    @GetToken() user: { orgId?: string, id?: string },
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.productionOrchestratorService.listBatches(
      user.orgId || user.id || '',
      { status },
      {
        page: page ? Number.parseInt(page, 10) : 1,
        limit: limit ? Number.parseInt(limit, 10) : 20,
      },
    )
  }

  @Get('batches/:batchId')
  async getBatch(
    @GetToken() user: { orgId?: string, id?: string },
    @Param('batchId') batchId: string,
  ) {
    return this.productionOrchestratorService.getBatch(user.orgId || user.id || '', batchId)
  }

  @Post('batches/:batchId/start')
  async startBatch(
    @GetToken() user: { orgId?: string, id?: string },
    @Param('batchId') batchId: string,
  ) {
    return this.productionOrchestratorService.startBatch(user.orgId || user.id || '', batchId)
  }

  @Post('batches/:batchId/pause')
  async pauseBatch(
    @GetToken() user: { orgId?: string, id?: string },
    @Param('batchId') batchId: string,
  ) {
    return this.productionOrchestratorService.pauseBatch(user.orgId || user.id || '', batchId)
  }

  @Post('batches/:batchId/resume')
  async resumeBatch(
    @GetToken() user: { orgId?: string, id?: string },
    @Param('batchId') batchId: string,
  ) {
    return this.productionOrchestratorService.resumeBatch(user.orgId || user.id || '', batchId)
  }

  @Post('batches/:batchId/cancel')
  async cancelBatch(
    @GetToken() user: { orgId?: string, id?: string },
    @Param('batchId') batchId: string,
  ) {
    return this.productionOrchestratorService.cancelBatch(user.orgId || user.id || '', batchId)
  }

  @Get('batches/:batchId/summary')
  async getBatchSummary(
    @GetToken() user: { orgId?: string, id?: string },
    @Param('batchId') batchId: string,
  ) {
    return this.productionOrchestratorService.getBatchSummary(user.orgId || user.id || '', batchId)
  }
}
