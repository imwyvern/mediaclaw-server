import { Body, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { DistributionRuleType } from '@yikart/mongodb'

import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { MediaClawAuthUser } from '../mediaclaw-auth.types'
import {
  AssignDistributionDto,
  CollectDistributionFeedbackDto,
  CreateDistributionRuleDto,
  DistributionStatusQueryDto,
  EvaluateDistributionRulesDto,
  PublishConfirmDto,
  PushDistributionDto,
  TrackDistributionStatusDto,
  UpdateDistributionRuleDto,
} from './distribution.dto'
import { DistributionService } from './distribution.service'

@MediaClawApiController('api/v1/distribution')
export class DistributionController {
  constructor(private readonly distributionService: DistributionService) {}

  @Post('assign')
  async assignByRule(
    @GetToken() user: MediaClawAuthUser,
    @Body() body: AssignDistributionDto,
  ) {
    return this.distributionService.assignByRule(user.orgId || user.id || '', body.contentId)
  }

  @Post('publish-confirm')
  async publishConfirm(
    @GetToken() user: MediaClawAuthUser,
    @Body() body: PublishConfirmDto,
  ) {
    return this.distributionService.confirmPublish(
      user.orgId || user.id || '',
      body.contentId,
      body.publishUrl,
      body.platform,
      body.publishPostId,
    )
  }

  @Get('status')
  async getStatus(
    @GetToken() user: MediaClawAuthUser,
    @Query() query: DistributionStatusQueryDto,
  ) {
    return this.distributionService.getDistributionStatus(user.orgId || user.id || '', query)
  }

  @Post()
  async createRule(
    @GetToken() user: MediaClawAuthUser,
    @Body() body: CreateDistributionRuleDto,
  ) {
    return this.distributionService.createRule(user.orgId || user.id || '', body)
  }

  @Get()
  async listRules(@GetToken() user: MediaClawAuthUser) {
    return this.distributionService.listRules(user.orgId || user.id || '')
  }

  @Patch(':id')
  async updateRule(
    @GetToken() user: MediaClawAuthUser,
    @Param('id') id: string,
    @Body() body: UpdateDistributionRuleDto,
  ) {
    return this.distributionService.updateRule(user.orgId || user.id || '', id, body)
  }

  @Delete(':id')
  async deleteRule(
    @GetToken() user: MediaClawAuthUser,
    @Param('id') id: string,
  ) {
    return this.distributionService.deleteRule(user.orgId || user.id || '', id)
  }

  @Post('evaluate')
  async evaluateRules(
    @GetToken() user: MediaClawAuthUser,
    @Body() body: EvaluateDistributionRulesDto,
  ) {
    return this.distributionService.evaluateRules(user.orgId || user.id || '', body.content)
  }

  @Post('push')
  async distribute(
    @GetToken() user: MediaClawAuthUser,
    @Body() body: PushDistributionDto,
  ) {
    return this.distributionService.distribute(
      user.orgId || user.id || '',
      body.contentId,
      body.targets,
    )
  }

  @Post('status')
  async trackPublishStatus(
    @GetToken() user: MediaClawAuthUser,
    @Body() body: TrackDistributionStatusDto,
  ) {
    return this.distributionService.trackPublishStatus(
      user.orgId || user.id || '',
      body.contentId,
      body.status,
    )
  }

  @Post('feedback')
  async collectFeedback(
    @GetToken() user: MediaClawAuthUser,
    @Body() body: CollectDistributionFeedbackDto,
  ) {
    return this.distributionService.collectFeedback(
      user.orgId || user.id || '',
      body.contentId,
      body.employeeId,
      body.feedback,
    )
  }

  @Get('types')
  async getRuleTypes() {
    return Object.values(DistributionRuleType)
  }
}
