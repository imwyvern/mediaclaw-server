import { Body, Post } from '@nestjs/common'

import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { PipelineMatchService } from './pipeline-match.service'

@MediaClawApiController('api/v1/pipelines')
export class PipelineMatchController {
  constructor(private readonly pipelineMatchService: PipelineMatchService) {}

  @Post('match')
  async matchPipeline(
    @Body()
    body: {
      referenceVideoUrl?: string
      category?: string
      style?: string
      duration?: number
      budget?: number
      description?: string
    },
  ) {
    return this.pipelineMatchService.matchPipeline(body)
  }

  @Post('analyze-reference')
  async analyzeReference(@Body() body: { videoUrl?: string }) {
    return this.pipelineMatchService.analyzeReferenceVideo(body.videoUrl || '')
  }
}
