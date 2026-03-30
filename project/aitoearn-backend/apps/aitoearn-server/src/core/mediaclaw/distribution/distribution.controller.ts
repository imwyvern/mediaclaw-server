import type { DistributionRulePayload, DistributionTargetInput } from './distribution.service'
import { Body, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { DistributionRuleType } from '@yikart/mongodb'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import {
  DistributionPublishStatus,

  DistributionService,

} from './distribution.service'

@MediaClawApiController('api/v1/distribution')
export class DistributionController {
  constructor(private readonly distributionService: DistributionService) {}

  @Post()
  async createRule(
    @GetToken() user: { orgId?: string, id?: string },
    @Body()
    body: DistributionRulePayload & {
      orgId?: string
    },
  ) {
    return this.distributionService.createRule(
      body.orgId || user.orgId || user.id || '',
      body,
    )
  }

  @Get()
  async listRules(
    @GetToken() user: { orgId?: string, id?: string },
    @Query('orgId') orgId?: string,
  ) {
    return this.distributionService.listRules(orgId || user.orgId || user.id || '')
  }

  @Patch(':id')
  async updateRule(
    @Param('id') id: string,
    @Body() body: Partial<DistributionRulePayload>,
  ) {
    return this.distributionService.updateRule(id, body)
  }

  @Delete(':id')
  async deleteRule(@Param('id') id: string) {
    return this.distributionService.deleteRule(id)
  }

  @Post('evaluate')
  async evaluateRules(
    @GetToken() user: { orgId?: string, id?: string },
    @Body()
    body: {
      orgId?: string
      content: Record<string, unknown>
    },
  ) {
    return this.distributionService.evaluateRules(
      body.orgId || user.orgId || user.id || '',
      body.content,
    )
  }

  @Post('push')
  async distribute(
    @GetToken() user: { orgId?: string, id?: string },
    @Body()
    body: {
      orgId?: string
      contentId: string
      targets: DistributionTargetInput[]
    },
  ) {
    return this.distributionService.distribute(
      body.orgId || user.orgId || user.id || '',
      body.contentId,
      body.targets,
    )
  }

  @Post('status')
  async trackPublishStatus(
    @Body()
    body: {
      contentId: string
      status: DistributionPublishStatus
    },
  ) {
    return this.distributionService.trackPublishStatus(body.contentId, body.status)
  }

  @Post('feedback')
  async collectFeedback(
    @Body()
    body: {
      contentId: string
      employeeId: string
      feedback: Record<string, unknown> | string
    },
  ) {
    return this.distributionService.collectFeedback(
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
