import { Controller, Get, Param, Query } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { AnalyticsService } from './analytics.service'

@Controller('api/v1/analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('overview')
  async getOverview(@GetToken() user: any) {
    return this.analyticsService.getOverview(user.orgId || user.id)
  }

  @Get('stats/:id')
  async getVideoStats(@Param('id') id: string) {
    return this.analyticsService.getVideoStats(id)
  }

  @Get('trends')
  async getTrends(
    @GetToken() user: any,
    @Query('period') period: 'daily' | 'weekly' | 'monthly' = 'daily',
  ) {
    return this.analyticsService.getTrends(user.orgId || user.id, period)
  }

  @Get('top')
  async getTopContent(
    @GetToken() user: any,
    @Query('limit') limit = '10',
  ) {
    return this.analyticsService.getTopContent(user.orgId || user.id, Number(limit))
  }
}
