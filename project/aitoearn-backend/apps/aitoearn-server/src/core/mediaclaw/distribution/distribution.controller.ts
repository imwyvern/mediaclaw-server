import type { DistributionRulePayload, DistributionTargetInput } from './distribution.service'
import { Body, Delete, Get, Param, Patch, Post } from '@nestjs/common'
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
      user.orgId || user.id || '',
      body,
    )
  }

  @Get()
  async listRules(@GetToken() user: { orgId?: string, id?: string }) {
    return this.distributionService.listRules(user.orgId || user.id || '')
  }

  @Patch(':id')
  async updateRule(
    @GetToken() user: { orgId?: string, id?: string },
    @Param('id') id: string,
    @Body() body: Partial<DistributionRulePayload>,
  ) {
    return this.distributionService.updateRule(user.orgId || user.id || '', id, body)
  }

  @Delete(':id')
  async deleteRule(
    @GetToken() user: { orgId?: string, id?: string },
    @Param('id') id: string,
  ) {
    return this.distributionService.deleteRule(user.orgId || user.id || '', id)
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
      user.orgId || user.id || '',
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
      user.orgId || user.id || '',
      body.contentId,
      body.targets,
    )
  }

  @Post('status')
  async trackPublishStatus(
    @GetToken() user: { orgId?: string, id?: string },
    @Body()
    body: {
      contentId: string
      status: DistributionPublishStatus
    },
  ) {
    return this.distributionService.trackPublishStatus(
      user.orgId || user.id || '',
      body.contentId,
      body.status,
    )
  }

  @Post('feedback')
  async collectFeedback(
    @GetToken() user: { orgId?: string, id?: string },
    @Body()
    body: {
      contentId: string
      employeeId: string
      feedback: Record<string, unknown> | string
    },
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
