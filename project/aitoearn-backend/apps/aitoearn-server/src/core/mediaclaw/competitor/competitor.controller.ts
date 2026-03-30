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
import { CompetitorService } from './competitor.service'

@MediaClawApiController('api/v1/competitors')
export class CompetitorController {
  constructor(private readonly competitorService: CompetitorService) {}

  @Post()
  async addCompetitor(
    @GetToken() user: any,
    @Body() body: {
      orgId?: string
      platform: string
      accountUrl: string
    },
  ) {
    return this.competitorService.addCompetitor(
      body.orgId || user.orgId,
      body.platform,
      body.accountUrl,
    )
  }

  @Get()
  async listCompetitors(
    @GetToken() user: any,
    @Query('orgId') orgId?: string,
  ) {
    return this.competitorService.listCompetitors(orgId || user.orgId)
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
  async removeCompetitor(@Param('id') id: string) {
    return this.competitorService.removeCompetitor(id)
  }
}
