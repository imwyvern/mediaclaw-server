import { Body, Get, Param, Post } from '@nestjs/common'
import { Type } from 'class-transformer'
import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { CrawlerService } from './crawler.service'

class EnqueueCrawlDto {
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
