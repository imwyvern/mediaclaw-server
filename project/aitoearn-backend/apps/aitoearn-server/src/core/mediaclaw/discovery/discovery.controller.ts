import { Body, Get, Post, Query } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { DiscoveryService } from './discovery.service'

@MediaClawApiController('api/v1/discovery')
export class DiscoveryController {
  constructor(private readonly discoveryService: DiscoveryService) {}

  @Get('pool')
  async getRecommendationPool(
    @GetToken() user: any,
    @Query('limit') limit = '10',
    @Query('industry') industry?: string,
  ) {
    return this.discoveryService.getRecommendationPool(
      user.orgId || user.id,
      Number(limit),
      industry,
    )
  }

  @Post('score')
  async calculateViralScore(@Body() body: {
    views?: number
    likes?: number
    comments?: number
    shares?: number
  }) {
    return {
      viralScore: this.discoveryService.calculateViralScore({
        views: body.views,
        likes: body.likes,
        comments: body.comments,
        shares: body.shares,
      }),
    }
  }

  @Post('mark-remixed')
  async markRemixed(@Body() body: {
    contentId?: string
    taskId?: string
  }) {
    return this.discoveryService.markRemixed(body.contentId || '', body.taskId || '')
  }
}
