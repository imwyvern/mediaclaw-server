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
  async findOne(@Param('id') id: string) {
    return this.campaignService.findById(id)
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: any) {
    return this.campaignService.update(id, body)
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.campaignService.delete(id)
  }

  @Post(':id/start')
  async start(@Param('id') id: string) {
    return this.campaignService.start(id)
  }

  @Post(':id/pause')
  async pause(@Param('id') id: string) {
    return this.campaignService.pause(id)
  }

  @Post(':id/complete')
  async complete(@Param('id') id: string) {
    return this.campaignService.complete(id)
  }
}
