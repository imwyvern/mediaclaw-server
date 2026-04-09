import { Body, Post } from '@nestjs/common'
import { Type } from 'class-transformer'
import {
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator'

import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { PipelineMatchService } from './pipeline-match.service'

class MatchPipelineDto {
  @IsOptional()
  @IsString()
  referenceVideoUrl?: string

  @IsOptional()
  @IsString()
  category?: string

  @IsOptional()
  @IsString()
  style?: string

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  duration?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  budget?: number

  @IsOptional()
  @IsString()
  description?: string
}

class AnalyzeReferenceDto {
  @IsString()
  videoUrl: string
}

@MediaClawApiController('api/v1/pipelines')
export class PipelineMatchController {
  constructor(private readonly pipelineMatchService: PipelineMatchService) {}

  @Post('match')
  async matchPipeline(@Body() body: MatchPipelineDto) {
    return this.pipelineMatchService.matchPipeline(body)
  }

  @Post('analyze-reference')
  async analyzeReference(@Body() body: AnalyzeReferenceDto) {
    return this.pipelineMatchService.analyzeReferenceVideo(body.videoUrl)
  }
}
