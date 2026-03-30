import { Body, Get, Param, Post, Query } from '@nestjs/common'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { TikHubService } from './tikhub.service'

@MediaClawApiController('api/v1/acquisition')
export class AcquisitionController {
  constructor(private readonly tikHubService: TikHubService) {}

  @Get('search')
  async searchVideos(
    @Query('platform') platform: string,
    @Query('keyword') keyword: string,
    @Query('limit') limit?: string,
  ) {
    return this.tikHubService.searchVideos(platform, keyword, limit ? Number(limit) : undefined)
  }

  @Get('detail/:id')
  async getVideoDetail(
    @Param('id') id: string,
    @Query('platform') platform: string,
  ) {
    return this.tikHubService.getVideoDetail(platform, id)
  }

  @Get('track/:id')
  async trackPerformance(@Param('id') id: string) {
    return this.tikHubService.trackPerformance(id)
  }

  @Post('source')
  async getSourceVideo(@Body() body: { videoUrl?: string }) {
    return this.tikHubService.getSourceVideo(body.videoUrl || '')
  }
}
