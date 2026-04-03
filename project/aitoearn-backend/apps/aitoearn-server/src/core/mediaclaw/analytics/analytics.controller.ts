import { Body, Get, Param, Post, Query } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'

import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { AnalyticsService } from './analytics.service'

@MediaClawApiController('api/v1/analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('overview')
  async getOverview(
    @GetToken() user: { orgId?: string, id?: string },
    @Query('period') period?: string,
  ) {
    return this.analyticsService.getOverview(
      user.orgId || user.id || '',
      period ? Number.parseInt(period, 10) : 30,
    )
  }

  @Post('collect/:videoTaskId')
  async collectVideo(
    @GetToken() user: { orgId?: string, id?: string },
    @Param('videoTaskId') videoTaskId: string,
  ) {
    return this.analyticsService.collectVideo(user.orgId || user.id || '', videoTaskId)
  }

  @Get('video/:videoTaskId/timeseries')
  async getVideoTimeSeries(
    @GetToken() user: { orgId?: string, id?: string },
    @Param('videoTaskId') videoTaskId: string,
    @Query('period') period?: string,
  ) {
    return this.analyticsService.getVideoTimeSeries(
      user.orgId || user.id || '',
      videoTaskId,
      period ? Number.parseInt(period, 10) : 90,
    )
  }

  @Get('video/:videoTaskId/latest')
  async getVideoLatestMetrics(
    @GetToken() user: { orgId?: string, id?: string },
    @Param('videoTaskId') videoTaskId: string,
  ) {
    return this.analyticsService.getVideoLatestMetrics(user.orgId || user.id || '', videoTaskId)
  }

  @Get('video/:videoId')
  async getVideoHistory(
    @GetToken() user: { orgId?: string, id?: string },
    @Param('videoId') videoId: string,
  ) {
    return this.analyticsService.getVideoHistory(user.orgId || user.id || '', videoId)
  }

  @Get('benchmark')
  async getBenchmark(
    @GetToken() user: { orgId?: string, id?: string },
    @Query('industry') industry?: string,
  ) {
    return this.analyticsService.getBenchmark(user.orgId || user.id || '', industry)
  }

  @Post('refresh')
  async refreshAnalytics(
    @GetToken() user: { orgId?: string, id?: string },
    @Body() body: { limit?: number, period?: number },
  ) {
    return this.analyticsService.refreshAnalytics(
      user.orgId || user.id || '',
      body?.limit,
      body?.period,
    )
  }

  @Get('stats/:id')
  async getVideoStats(
    @GetToken() user: { orgId?: string, id?: string },
    @Param('id') id: string,
  ) {
    return this.analyticsService.getVideoStats(user.orgId || user.id || '', id)
  }

  @Get('trends')
  async getTrends(
    @GetToken() user: { orgId?: string, id?: string },
    @Query('period') period: 'daily' | 'weekly' | 'monthly' = 'daily',
    @Query('metric') metric: 'views' | 'likes' | 'comments' | 'shares' | 'saves' | 'followers' | 'engagementRate' = 'views',
    @Query('windowDays') windowDays?: string,
  ) {
    return this.analyticsService.getTrends(
      user.orgId || user.id || '',
      period,
      metric,
      windowDays ? Number.parseInt(windowDays, 10) : 30,
    )
  }

  @Get('top')
  async getTopContent(
    @GetToken() user: { orgId?: string, id?: string },
    @Query('limit') limit = '10',
    @Query('metric') metric: 'views' | 'likes' | 'comments' | 'shares' | 'saves' | 'followers' | 'engagementRate' = 'views',
    @Query('period') period?: string,
  ) {
    return this.analyticsService.getTopContent(
      user.orgId || user.id || '',
      Number.parseInt(limit, 10),
      metric,
      period ? Number.parseInt(period, 10) : 30,
    )
  }
}
