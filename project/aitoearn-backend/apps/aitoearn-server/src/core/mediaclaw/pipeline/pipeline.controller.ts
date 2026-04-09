import { Body, Delete, Get, Param, Patch, Post } from '@nestjs/common'
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
} from '@nestjs/swagger'
import { GetToken } from '@yikart/aitoearn-auth'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { MediaClawAuthUser } from '../mediaclaw-auth.types'
import {
  CreatePipelineDto,
  CreatePipelineFeedbackDto,
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
  @ApiOperation({ summary: '创建生产 pipeline' })
  @ApiBody({ type: CreatePipelineDto })
  @ApiCreatedResponse({ description: 'pipeline 已创建' })
  async create(
    @GetToken() user: MediaClawAuthUser,
    @Body() body: CreatePipelineDto,
  ) {
    return this.pipelineService.create(user.orgId || user.id, body.brandId, body)
  }

  @Get()
  @ApiOperation({ summary: '获取当前组织的 pipeline 列表' })
  @ApiOkResponse({ description: '返回当前组织全部 pipeline' })
  async list(@GetToken() user: MediaClawAuthUser) {
    return this.pipelineService.findByOrg(user.orgId || user.id)
  }

  @Get(':id/preferences')
  @ApiOperation({ summary: '获取 pipeline 偏好学习结果' })
  @ApiParam({ name: 'id', description: 'pipeline ID' })
  @ApiOkResponse({ description: '返回 pipeline 偏好画像、反馈日志与学习结果' })
  async getPreferences(@GetToken() user: MediaClawAuthUser, @Param('id') id: string) {
    return this.pipelineService.getPreferenceProfile(user.orgId || user.id, id)
  }

  @Get(':id')
  @ApiOperation({ summary: '获取单个 pipeline 详情' })
  @ApiParam({ name: 'id', description: 'pipeline ID' })
  @ApiOkResponse({ description: '返回 pipeline 详情' })
  async findOne(@GetToken() user: MediaClawAuthUser, @Param('id') id: string) {
    return this.pipelineService.findById(user.orgId || user.id, id)
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新 pipeline 基础信息' })
  @ApiParam({ name: 'id', description: 'pipeline ID' })
  @ApiBody({ type: UpdatePipelineDto })
  @ApiOkResponse({ description: 'pipeline 已更新' })
  async update(
    @GetToken() user: MediaClawAuthUser,
    @Param('id') id: string,
    @Body() body: UpdatePipelineDto,
  ) {
    return this.pipelineService.update(user.orgId || user.id, id, body)
  }

  @Patch(':id/preferences')
  @ApiOperation({ summary: '更新 pipeline 风格偏好' })
  @ApiParam({ name: 'id', description: 'pipeline ID' })
  @ApiBody({ type: PipelinePreferencesDto })
  @ApiOkResponse({ description: 'pipeline 偏好配置已更新' })
  async updatePreferences(
    @GetToken() user: MediaClawAuthUser,
    @Param('id') id: string,
    @Body() body: PipelinePreferencesDto,
  ) {
    return this.pipelineService.updatePreferences(user.orgId || user.id, id, body)
  }

  @Post(':id/feedback')
  @ApiOperation({ summary: '记录 pipeline 偏好反馈并自动学习' })
  @ApiParam({ name: 'id', description: 'pipeline ID' })
  @ApiBody({ type: CreatePipelineFeedbackDto })
  @ApiOkResponse({ description: '反馈已记录并完成偏好学习' })
  async recordFeedback(
    @GetToken() user: MediaClawAuthUser,
    @Param('id') id: string,
    @Body() body: CreatePipelineFeedbackDto,
  ) {
    return this.pipelineService.recordFeedback(user.orgId || user.id, id, body)
  }

  @Patch(':id/model-overrides')
  @ApiOperation({ summary: '更新 pipeline 模型覆盖配置' })
  @ApiParam({ name: 'id', description: 'pipeline ID' })
  @ApiBody({ type: PipelineModelOverridesDto })
  @ApiOkResponse({ description: 'pipeline 模型覆盖配置已更新' })
  async updateModelOverrides(
    @GetToken() user: MediaClawAuthUser,
    @Param('id') id: string,
    @Body() body: PipelineModelOverridesDto,
  ) {
    return this.pipelineService.updateModelOverrides(user.orgId || user.id, id, body)
  }

  @Patch(':id/distribution-rules')
  @ApiOperation({ summary: '更新 pipeline 分发规则' })
  @ApiParam({ name: 'id', description: 'pipeline ID' })
  @ApiBody({ type: PipelineDistributionRulesDto })
  @ApiOkResponse({ description: 'pipeline 分发规则已更新' })
  async updateDistributionRules(
    @GetToken() user: MediaClawAuthUser,
    @Param('id') id: string,
    @Body() body: PipelineDistributionRulesDto,
  ) {
    return this.pipelineService.updateDistributionRules(user.orgId || user.id, id, body)
  }

  @Patch(':id/bind-group')
  @ApiOperation({ summary: '绑定 pipeline 到分发群' })
  @ApiParam({ name: 'id', description: 'pipeline ID' })
  @ApiBody({ type: PipelineGroupBindingDto })
  @ApiOkResponse({ description: 'pipeline 分发群绑定已更新' })
  async bindGroup(
    @GetToken() user: MediaClawAuthUser,
    @Param('id') id: string,
    @Body() body: PipelineGroupBindingDto,
  ) {
    return this.pipelineService.bindGroup(user.orgId || user.id, id, body, user.id)
  }

  @Delete(':id')
  @ApiOperation({ summary: '归档 pipeline' })
  @ApiParam({ name: 'id', description: 'pipeline ID' })
  @ApiOkResponse({ description: 'pipeline 已归档' })
  async archive(@GetToken() user: MediaClawAuthUser, @Param('id') id: string) {
    return this.pipelineService.archive(user.orgId || user.id, id)
  }
}
