import { Body, Delete, Get, Param, Patch, Post } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { MediaClawAuthUser } from '../mediaclaw-auth.types'
import {
  CreatePipelineDto,
  PipelineDistributionRulesDto,
  PipelineGroupBindingDto,
  PipelineModelOverridesDto,
  PipelinePreferencesDto,
  UpdatePipelineDto,
} from './pipeline.dto'
import { PipelineService } from './pipeline.service'

@MediaClawApiController(['api/v1/pipeline', 'api/v1/pipelines'])
export class PipelineController {
  constructor(private readonly pipelineService: PipelineService) {}

  @Post()
  async create(
    @GetToken() user: MediaClawAuthUser,
    @Body() body: CreatePipelineDto,
  ) {
    return this.pipelineService.create(user.orgId || user.id, body.brandId, body)
  }

  @Get()
  async list(@GetToken() user: MediaClawAuthUser) {
    return this.pipelineService.findByOrg(user.orgId || user.id)
  }

  @Get(':id')
  async findOne(@GetToken() user: MediaClawAuthUser, @Param('id') id: string) {
    return this.pipelineService.findById(user.orgId || user.id, id)
  }

  @Patch(':id')
  async update(
    @GetToken() user: MediaClawAuthUser,
    @Param('id') id: string,
    @Body() body: UpdatePipelineDto,
  ) {
    return this.pipelineService.update(user.orgId || user.id, id, body)
  }

  @Patch(':id/preferences')
  async updatePreferences(
    @GetToken() user: MediaClawAuthUser,
    @Param('id') id: string,
    @Body() body: PipelinePreferencesDto,
  ) {
    return this.pipelineService.updatePreferences(user.orgId || user.id, id, body)
  }

  @Patch(':id/model-overrides')
  async updateModelOverrides(
    @GetToken() user: MediaClawAuthUser,
    @Param('id') id: string,
    @Body() body: PipelineModelOverridesDto,
  ) {
    return this.pipelineService.updateModelOverrides(user.orgId || user.id, id, body)
  }

  @Patch(':id/distribution-rules')
  async updateDistributionRules(
    @GetToken() user: MediaClawAuthUser,
    @Param('id') id: string,
    @Body() body: PipelineDistributionRulesDto,
  ) {
    return this.pipelineService.updateDistributionRules(user.orgId || user.id, id, body)
  }

  @Patch(':id/bind-group')
  async bindGroup(
    @GetToken() user: MediaClawAuthUser,
    @Param('id') id: string,
    @Body() body: PipelineGroupBindingDto,
  ) {
    return this.pipelineService.bindGroup(user.orgId || user.id, id, body, user.id)
  }

  @Delete(':id')
  async archive(@GetToken() user: MediaClawAuthUser, @Param('id') id: string) {
    return this.pipelineService.archive(user.orgId || user.id, id)
  }
}
