import {
  Body,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { IsString } from 'class-validator'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { MediaClawAuthUser } from '../mediaclaw-auth.types'
import { CompetitorService } from './competitor.service'

class AddCompetitorDto {
  @IsString()
  platform: string

  @IsString()
  accountUrl: string
}

@MediaClawApiController('api/v1/competitors')
export class CompetitorController {
  constructor(private readonly competitorService: CompetitorService) {}

  @Post()
  async addCompetitor(
    @GetToken() user: MediaClawAuthUser,
    @Body() body: AddCompetitorDto,
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

  @Get('hot')
  async getCompetitorHot(
    @GetToken() user: MediaClawAuthUser,
    @Query('period') period = '7d',
    @Query('limit') limit = '5',
    @Query('platform') platform?: string,
  ) {
    return this.competitorService.getCompetitorHot(
      user.orgId || user.id,
      period,
      Number(limit),
      platform,
    )
  }

  @Get(['industry-hot', 'trending'])
  async getIndustryHot(
    @Query('industry') industry: string,
    @Query('platform') platform?: string,
    @Query('period') period = '7d',
  ) {
    return this.competitorService.getIndustryHot(industry, platform, period)
  }

  @Post(':id/sync')
  async syncCompetitor(
    @GetToken() user: MediaClawAuthUser,
    @Param('id') id: string,
  ) {
    return this.competitorService.syncCompetitor(user.orgId || user.id, id)
  }

  @Delete(':id')
  async removeCompetitor(@GetToken() user: MediaClawAuthUser, @Param('id') id: string) {
    return this.competitorService.removeCompetitor(user.orgId || user.id, id)
  }
}
