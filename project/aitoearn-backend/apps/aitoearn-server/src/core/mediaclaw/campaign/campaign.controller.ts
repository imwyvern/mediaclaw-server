import { Body, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { Campaign, CampaignStatus } from '@yikart/mongodb'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { MediaClawAuthUser } from '../mediaclaw-auth.types'
import { CampaignService } from './campaign.service'

@MediaClawApiController(['api/v1/campaign', 'api/v1/campaigns'])
export class CampaignController {
  constructor(private readonly campaignService: CampaignService) {}

  @Post(['', 'create'])
  async create(@GetToken() user: MediaClawAuthUser, @Body() body: Partial<Campaign>) {
    return this.campaignService.create(user.orgId || user.id, body)
  }

  @Get(['', 'list'])
  async list(
    @GetToken() user: MediaClawAuthUser,
    @Query('status') status?: CampaignStatus,
  ) {
    return this.campaignService.findByOrg(user.orgId || user.id, status)
  }

  @Get(':id')
  async findOne(@GetToken() user: MediaClawAuthUser, @Param('id') id: string) {
    return this.campaignService.findById(user.orgId || user.id, id)
  }

  @Get(':id/videos')
  async listVideos(@GetToken() user: MediaClawAuthUser, @Param('id') id: string) {
    return this.campaignService.listVideos(user.orgId || user.id, id)
  }

  @Patch(':id')
  async update(@GetToken() user: MediaClawAuthUser, @Param('id') id: string, @Body() body: Partial<Campaign>) {
    return this.campaignService.update(user.orgId || user.id, id, body)
  }

  @Post(':id/status')
  async updateStatus(
    @GetToken() user: MediaClawAuthUser,
    @Param('id') id: string,
    @Body('status') status: CampaignStatus,
  ) {
    return this.campaignService.update(user.orgId || user.id, id, { status })
  }

  @Delete(':id')
  async remove(@GetToken() user: MediaClawAuthUser, @Param('id') id: string) {
    return this.campaignService.delete(user.orgId || user.id, id)
  }

  @Post(':id/start')
  async start(@GetToken() user: MediaClawAuthUser, @Param('id') id: string) {
    return this.campaignService.start(user.orgId || user.id, id)
  }

  @Post(':id/pause')
  async pause(@GetToken() user: MediaClawAuthUser, @Param('id') id: string) {
    return this.campaignService.pause(user.orgId || user.id, id)
  }

  @Post(':id/complete')
  async complete(@GetToken() user: MediaClawAuthUser, @Param('id') id: string) {
    return this.campaignService.complete(user.orgId || user.id, id)
  }
}
