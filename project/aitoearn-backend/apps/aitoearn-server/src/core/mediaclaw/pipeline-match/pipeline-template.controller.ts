import { Body, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'

import { MediaClawApiController } from '../mediaclaw-api.decorator'
import {
  CreatePipelineTemplateDto,
  UpdatePipelineTemplateDto,
} from './pipeline-match.dto'
import { PipelineMatchService } from './pipeline-match.service'

@MediaClawApiController('api/v1/pipelines/templates')
export class PipelineTemplateController {
  constructor(private readonly pipelineMatchService: PipelineMatchService) {}

  @Get()
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

  @Post()
  async createTemplate(
    @GetToken() user: { id?: string } | undefined,
    @Body() body: CreatePipelineTemplateDto,
  ) {
    return this.pipelineMatchService.createTemplate({
      ...body,
      createdBy: user?.id || 'system',
    })
  }

  @Patch(':id')
  async updateTemplate(
    @Param('id') id: string,
    @Body() body: UpdatePipelineTemplateDto,
  ) {
    return this.pipelineMatchService.updateTemplate(id, body)
  }
}
