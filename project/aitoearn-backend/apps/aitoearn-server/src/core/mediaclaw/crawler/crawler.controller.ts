import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { CrawlerService } from './crawler.service'

@Controller('api/v1/crawler')
export class CrawlerController {
  constructor(private readonly crawlerService: CrawlerService) {}

  @Post('enqueue')
  async enqueueCrawl(@Body() body: {
    platform?: string
    keyword?: string
    depth?: number
  }) {
    return this.crawlerService.enqueueCrawl(
      body.platform || '',
      body.keyword || '',
      body.depth,
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
