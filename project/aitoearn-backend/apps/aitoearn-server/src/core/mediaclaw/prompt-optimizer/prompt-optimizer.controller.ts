import { Body, Get, Param, Post } from '@nestjs/common'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { PromptOptimizerService } from './prompt-optimizer.service'

@MediaClawApiController('api/v1/optimizer')
export class PromptOptimizerController {
  constructor(
    private readonly promptOptimizerService: PromptOptimizerService,
  ) {}

  @Post('analyze')
  async analyzeFailure(@Body() body: {
    videoTaskId: string
    stage: string
    prompt?: string
    error?: unknown
  }) {
    const analysis = await this.promptOptimizerService.analyzeFailure(
      body.videoTaskId,
      body.stage,
      body.prompt || '',
      body.error,
    )
    const retry = await this.promptOptimizerService.shouldRetry(body.videoTaskId)

    return {
      videoTaskId: body.videoTaskId,
      stage: body.stage,
      analysis,
      retry,
    }
  }

  @Get('history/:videoTaskId')
  async getIterationHistory(@Param('videoTaskId') videoTaskId: string) {
    return this.promptOptimizerService.getIterationHistory(videoTaskId)
  }

  @Get('batch/:batchId/summary')
  async getBatchIterationSummary(@Param('batchId') batchId: string) {
    return this.promptOptimizerService.getBatchIterationSummary(batchId)
  }
}
