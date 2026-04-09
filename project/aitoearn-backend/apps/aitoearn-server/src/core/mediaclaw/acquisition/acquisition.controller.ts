import { Body, Get, Param, Post, Query } from '@nestjs/common'
import { IsString } from 'class-validator'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { AcquisitionService } from './acquisition.service'

class SourceVideoDto {
  @IsString()
  videoUrl: string
}

@MediaClawApiController('api/v1/acquisition')
export class AcquisitionController {
  constructor(private readonly acquisitionService: AcquisitionService) {}

  @Get('search')
  async searchVideos(
    @Query('platform') platform: string,
    @Query('keyword') keyword: string,
    @Query('limit') limit?: string,
  ) {
    return this.acquisitionService.searchVideos(platform, keyword, limit ? Number(limit) : undefined)
  }

  @Get('detail/:id')
  async getVideoDetail(
    @Param('id') id: string,
    @Query('platform') platform: string,
  ) {
    return this.acquisitionService.getVideoDetail(platform, id)
  }

  @Get('track/:id')
  async trackPerformance(@Param('id') id: string) {
    return this.acquisitionService.trackPerformance(id)
  }

  @Post('source')
  async getSourceVideo(@Body() body: SourceVideoDto) {
    return this.acquisitionService.getSourceVideo(body.videoUrl)
  }
}
