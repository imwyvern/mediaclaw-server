import { Body, Get, Post, Query } from '@nestjs/common'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { CopyEngineService } from './copy-engine.service'
import { CopyStrategyService } from './copy-strategy.service'

@MediaClawApiController('api/v1/copy')
export class CopyController {
  constructor(
    private readonly copyEngineService: CopyEngineService,
    private readonly copyStrategyService: CopyStrategyService,
  ) {}

  @Post('generate')
  async generateCopy(@Body() body: {
    videoTaskId?: string
    brandId?: string
    theme?: string
    platform?: string
    style?: string
    count?: number
  }) {
    return this.copyEngineService.generateCopySet(body)
  }

  @Post('rewrite')
  async rewriteCopy(@Body() body: {
    copyId: string
    instructions?: string
  }) {
    return this.copyEngineService.rewriteCopy(body.copyId, body.instructions)
  }

  @Post('blue-words')
  async generateBlueWords(@Body() body: {
    title?: string
    keywords?: string[]
  }) {
    return this.copyEngineService.generateBlueWords(
      body.title || '',
      body.keywords || [],
    )
  }

  @Post('comment-guide')
  async generateCommentGuide(@Body() body: {
    brand?: string
    content?: string
  }) {
    return {
      commentGuide: this.copyEngineService.generateCommentGuide(
        body.brand || '',
        body.content || '',
      ),
    }
  }

  @Post('ab-variants')
  async generateABVariants(@Body() body: {
    baseTitle?: string
    count?: number
  }) {
    return {
      variants: this.copyEngineService.generateABVariants(
        body.baseTitle || '',
        body.count,
      ),
    }
  }

  @Post('performance')
  async recordPerformance(@Body() body: {
    copyHistoryId: string
    videoTaskId: string
    metrics?: {
      views?: number
      likes?: number
      comments?: number
      shares?: number
      saves?: number
      ctr?: number
    }
  }) {
    return this.copyStrategyService.recordCopyPerformance(
      body.copyHistoryId,
      body.videoTaskId,
      body.metrics || {},
    )
  }

  @Get('insights')
  async getInsights(
    @Query('orgId') orgId: string,
    @Query('period') period = '30d',
  ) {
    return this.copyStrategyService.getCopyInsights(orgId, period)
  }

  @Get('top-patterns')
  async getTopPatterns(
    @Query('orgId') orgId: string,
    @Query('platform') platform?: string,
    @Query('limit') limit = '5',
  ) {
    return this.copyStrategyService.getTopPerformingPatterns(
      orgId,
      platform,
      Number(limit || 5),
    )
  }
}
