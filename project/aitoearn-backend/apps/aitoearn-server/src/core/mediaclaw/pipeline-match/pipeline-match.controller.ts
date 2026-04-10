import { Body, Post } from '@nestjs/common'
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOperation,
} from '@nestjs/swagger'

import { MediaClawApiController } from '../mediaclaw-api.decorator'
import {
  AnalyzeReferenceDto,
  MatchPipelineDto,
} from './pipeline-match.dto'
import { PipelineMatchService } from './pipeline-match.service'

@MediaClawApiController('api/v1/pipelines')
export class PipelineMatchController {
  constructor(private readonly pipelineMatchService: PipelineMatchService) {}

  @Post('match')
  @ApiOperation({ summary: '根据参考素材匹配推荐 pipeline' })
  @ApiBody({ type: MatchPipelineDto })
  @ApiCreatedResponse({ description: '已返回最合适的 pipeline 匹配结果' })
  async matchPipeline(@Body() body: MatchPipelineDto) {
    return this.pipelineMatchService.matchPipeline(body)
  }

  @Post('analyze-reference')
  @ApiOperation({ summary: '分析参考视频，提取风格标签' })
  @ApiBody({ type: AnalyzeReferenceDto })
  @ApiCreatedResponse({ description: '已返回参考视频结构化分析结果' })
  async analyzeReference(@Body() body: AnalyzeReferenceDto) {
    return this.pipelineMatchService.analyzeReferenceVideo(body.videoUrl)
  }
}
