import { Body, Controller, Post } from '@nestjs/common'
import { CopyEngineService } from './copy-engine.service'

@Controller('api/v1/copy')
export class CopyController {
  constructor(private readonly copyEngineService: CopyEngineService) {}

  @Post('blue-words')
  async generateBlueWords(@Body() body: {
    title?: string
    keywords?: string[]
  }) {
    return this.copyEngineService.generateBlueWords(
      body.title || '',
      body.keywords || [],
    )
  }

  @Post('comment-guide')
  async generateCommentGuide(@Body() body: {
    brand?: string
    content?: string
  }) {
    return {
      commentGuide: this.copyEngineService.generateCommentGuide(
        body.brand || '',
        body.content || '',
      ),
    }
  }

  @Post('ab-variants')
  async generateABVariants(@Body() body: {
    baseTitle?: string
    count?: number
  }) {
    return {
      variants: this.copyEngineService.generateABVariants(
        body.baseTitle || '',
        body.count,
      ),
    }
  }
}
