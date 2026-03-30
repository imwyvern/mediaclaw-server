import { Body, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { CampaignStatus } from '@yikart/mongodb'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { CampaignService } from './campaign.service'

@MediaClawApiController('api/v1/campaign')
export class CampaignController {
  constructor(private readonly campaignService: CampaignService) {}

  @Post()
  async create(@GetToken() user: any, @Body() body: any) {
    return this.campaignService.create(user.orgId || user.id, body)
  }

  @Get()
  async list(
    @GetToken() user: any,
    @Query('status') status?: CampaignStatus,
  ) {
    return this.campaignService.findByOrg(user.orgId || user.id, status)
  }

  @Get(':id')
  async findOne(@GetToken() user: any, @Param('id') id: string) {
    return this.campaignService.findById(user.orgId || user.id, id)
  }

  @Patch(':id')
  async update(@GetToken() user: any, @Param('id') id: string, @Body() body: any) {
    return this.campaignService.update(user.orgId || user.id, id, body)
  }

  @Delete(':id')
  async remove(@GetToken() user: any, @Param('id') id: string) {
    return this.campaignService.delete(user.orgId || user.id, id)
  }

  @Post(':id/start')
  async start(@GetToken() user: any, @Param('id') id: string) {
    return this.campaignService.start(user.orgId || user.id, id)
  }

  @Post(':id/pause')
  async pause(@GetToken() user: any, @Param('id') id: string) {
    return this.campaignService.pause(user.orgId || user.id, id)
  }

  @Post(':id/complete')
  async complete(@GetToken() user: any, @Param('id') id: string) {
    return this.campaignService.complete(user.orgId || user.id, id)
  }
}
