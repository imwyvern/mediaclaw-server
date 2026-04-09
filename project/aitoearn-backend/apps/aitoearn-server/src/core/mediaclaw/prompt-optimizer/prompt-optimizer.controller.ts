import { Body, Get, Param, Post } from '@nestjs/common'
import { Allow, IsOptional, IsString } from 'class-validator'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { PromptOptimizerService } from './prompt-optimizer.service'

class AnalyzeFailureDto {
  @IsString()
  videoTaskId: string

  @IsString()
  stage: string

  @IsOptional()
  @IsString()
  prompt?: string

  @IsOptional()
  @Allow()
  error?: unknown
}

@MediaClawApiController('api/v1/optimizer')
export class PromptOptimizerController {
  constructor(
    private readonly promptOptimizerService: PromptOptimizerService,
  ) {}

  @Post('analyze')
  async analyzeFailure(@Body() body: AnalyzeFailureDto) {
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
