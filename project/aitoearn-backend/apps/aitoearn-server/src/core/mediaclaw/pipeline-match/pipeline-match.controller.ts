import { Body, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'

import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { PipelineMatchService } from './pipeline-match.service'

@MediaClawApiController('api/v1/pipelines')
export class PipelineMatchController {
  constructor(private readonly pipelineMatchService: PipelineMatchService) {}

  @Post('match')
  async matchPipeline(@Body() body: Record<string, unknown>) {
    return this.pipelineMatchService.matchPipeline(body)
  }

  @Post('analyze-reference')
  async analyzeReference(@Body() body: { videoUrl?: string }) {
    return this.pipelineMatchService.analyzeReferenceVideo(body.videoUrl || '')
  }

  @Get('templates')
  async listTemplates(
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('style') style?: string,
    @Query('type') type?: string,
    @Query('keyword') keyword?: string,
  ) {
    return this.pipelineMatchService.listTemplates({
      status,
      category,
      style,
      type,
      keyword,
    })
  }

  @Post('templates')
  async createTemplate(
    @GetToken() user: { id?: string } | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    return this.pipelineMatchService.createTemplate({
      ...body,
      createdBy: user?.id || 'system',
    })
  }

  @Patch('templates/:id')
  async updateTemplate(
    @Param('id') id: string,
    @GetToken() user: { id?: string } | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    void user
    return this.pipelineMatchService.updateTemplate(id, body)
  }
}
