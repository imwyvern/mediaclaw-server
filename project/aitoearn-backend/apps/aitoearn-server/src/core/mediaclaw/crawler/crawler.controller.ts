import { Body, Get, Param, Post } from '@nestjs/common'
import { Type } from 'class-transformer'
import {
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { CrawlerService } from './crawler.service'
import { CrawlType } from './crawler.types'

class EnqueueCrawlDto {
  @IsOptional()
  @IsIn(['keyword', 'video_comments', 'creator_profile', 'competitor_schedule'])
  crawlType?: CrawlType

  @IsOptional()
  @IsString()
  platform?: string

  @IsOptional()
  @IsString()
  keyword?: string

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  depth?: number

  @IsOptional()
  @IsString()
  industry?: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[]

  @IsOptional()
  @IsString()
  source?: string

  @IsOptional()
  @IsString()
  videoUrl?: string

  @IsOptional()
  @IsString()
  videoId?: string

  @IsOptional()
  @IsString()
  creatorId?: string

  @IsOptional()
  @IsString()
  accountUrl?: string

  @IsOptional()
  @IsString()
  orgId?: string

  @IsOptional()
  @IsString()
  competitorId?: string

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number
}

@MediaClawApiController('api/v1/crawler')
export class CrawlerController {
  constructor(private readonly crawlerService: CrawlerService) {}

  @Post('enqueue')
  async enqueueCrawl(@Body() body: EnqueueCrawlDto) {
    return this.crawlerService.enqueueCrawl(
      body.platform || '',
      body.keyword || '',
      body.depth,
      {
        industry: body.industry,
        keywords: body.keywords,
        source: body.source,
        crawlType: body.crawlType,
        videoUrl: body.videoUrl,
        videoId: body.videoId,
        creatorId: body.creatorId,
        accountUrl: body.accountUrl,
        orgId: body.orgId,
        competitorId: body.competitorId,
        limit: body.limit,
      },
    )
  }

  @Get('status/:id')
  async getCrawlStatus(@Param('id') id: string) {
    return this.crawlerService.getCrawlStatus(id)
  }

  @Get('results/:id')
  async getCrawlResults(@Param('id') id: string) {
    return this.crawlerService.getCrawlResults(id)
  }
}
