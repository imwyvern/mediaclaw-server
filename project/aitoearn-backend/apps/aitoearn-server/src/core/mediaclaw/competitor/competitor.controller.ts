import {
  Body,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { MediaClawAuthUser } from '../mediaclaw-auth.types'
import { CompetitorService } from './competitor.service'

@MediaClawApiController('api/v1/competitors')
export class CompetitorController {
  constructor(private readonly competitorService: CompetitorService) {}

  @Post()
  async addCompetitor(
    @GetToken() user: MediaClawAuthUser,
    @Body() body: {
      orgId?: string
      platform: string
      accountUrl: string
    },
  ) {
    return this.competitorService.addCompetitor(
      user.orgId || user.id,
      body.platform,
      body.accountUrl,
    )
  }

  @Get()
  async listCompetitors(@GetToken() user: MediaClawAuthUser) {
    return this.competitorService.listCompetitors(user.orgId || user.id)
  }

  @Get('industry-hot')
  async getIndustryHot(
    @Query('industry') industry: string,
    @Query('platform') platform?: string,
    @Query('period') period = '7d',
  ) {
    return this.competitorService.getIndustryHot(industry, platform, period)
  }

  @Delete(':id')
  async removeCompetitor(@GetToken() user: MediaClawAuthUser, @Param('id') id: string) {
    return this.competitorService.removeCompetitor(user.orgId || user.id, id)
  }
}
