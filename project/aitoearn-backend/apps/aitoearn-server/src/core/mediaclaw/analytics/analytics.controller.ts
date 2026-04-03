import { Body, Get, Param, Post, Query } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { AnalyticsService } from './analytics.service'

@MediaClawApiController('api/v1/analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('overview')
  async getOverview(@GetToken() user: any) {
    return this.analyticsService.getOverview(user.orgId || user.id)
  }

  @Get('video/:videoId')
  async getVideoHistory(@GetToken() user: any, @Param('videoId') videoId: string) {
    return this.analyticsService.getVideoHistory(user.orgId || user.id, videoId)
  }

  @Get('benchmark')
  async getBenchmark(
    @GetToken() user: any,
    @Query('industry') industry?: string,
  ) {
    return this.analyticsService.getBenchmark(user.orgId || user.id, industry)
  }

  @Post('refresh')
  async refreshAnalytics(
    @GetToken() user: any,
    @Body() body: { limit?: number },
  ) {
    return this.analyticsService.refreshAnalytics(
      user.orgId || user.id,
      body?.limit,
    )
  }

  @Get('stats/:id')
  async getVideoStats(@GetToken() user: any, @Param('id') id: string) {
    return this.analyticsService.getVideoStats(user.orgId || user.id, id)
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
