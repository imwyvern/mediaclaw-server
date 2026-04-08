import {
  Body,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { MediaClawAuthUser } from '../mediaclaw-auth.types'
import {
  ApplyPipelineTemplateDto,
  CreatePipelineTemplateDto,
  LearnPipelinePreferenceDto,
  PipelineTemplateQueryDto,
} from './pipeline-system.dto'
import { PipelineSystemService } from './pipeline-system.service'

@MediaClawApiController('api/v1/pipelines/system')
export class PipelineSystemController {
  constructor(private readonly pipelineSystemService: PipelineSystemService) {}

  @Post('templates')
  async createTemplate(
    @GetToken() user: MediaClawAuthUser,
    @Body() body: CreatePipelineTemplateDto,
  ) {
    return this.pipelineSystemService.createTemplate({
      ...body,
      createdBy: user.id,
    })
  }

  @Get('templates')
  async listTemplates(
    @GetToken() user: MediaClawAuthUser,
    @Query() query: PipelineTemplateQueryDto,
  ) {
    return this.pipelineSystemService.listTemplates({
      type: query.type as any,
      isPublic: query.isPublic,
      keyword: query.keyword,
      presetOnly: query.presetOnly,
      requestedBy: user.id,
    })
  }

  @Get('templates/:id')
  async getTemplate(@GetToken() user: MediaClawAuthUser, @Param('id') id: string) {
    return this.pipelineSystemService.getTemplate(id, user.id)
  }

  @Post('templates/:id/apply')
  async applyTemplate(
    @GetToken() user: MediaClawAuthUser,
    @Param('id') id: string,
    @Body() body: ApplyPipelineTemplateDto,
  ) {
    return this.pipelineSystemService.applyTemplate(
      id,
      user.id,
      user.orgId || user.id,
      body.brandId,
      body.overrides,
    )
  }

  @Post(':id/learn')
  async learnPreference(
    @GetToken() user: MediaClawAuthUser,
    @Param('id') id: string,
    @Body() body: LearnPipelinePreferenceDto,
  ) {
    return this.pipelineSystemService.learnPreference(
      user.orgId || user.id,
      id,
      body,
    )
  }

  @Post(':id/warm-up')
  async warmUp(
    @Param('id') id: string,
    @GetToken() user: MediaClawAuthUser,
  ) {
    return this.pipelineSystemService.warmUp(
      user.orgId || user.id,
      id,
      user.id,
    )
  }
}
