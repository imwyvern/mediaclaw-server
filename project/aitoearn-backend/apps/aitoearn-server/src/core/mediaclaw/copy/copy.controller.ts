import { Body, Get, Post, Query } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { CopyService } from './copy.service'
import { StyleRewriteService } from './style-rewrite.service'
import type {
  GenerateCopyHttpInput,
  RecordCopyPerformanceInput,
  RewriteCopyHttpInput,
} from './copy.service'

@MediaClawApiController('api/v1/copy')
export class CopyController {
  constructor(
    private readonly copyService: CopyService,
    private readonly styleRewriteService: StyleRewriteService,
  ) {}

  @Post('generate')
  async generateCopy(
    @GetToken() user: { orgId?: string, id?: string },
    @Body() body: GenerateCopyHttpInput,
  ) {
    return this.copyService.generateForHttp(user.orgId || user.id || '', user.id || '', body)
  }

  @Post('rewrite')
  async rewriteCopy(
    @GetToken() user: { orgId?: string, id?: string },
    @Body() body: RewriteCopyHttpInput,
  ) {
    return this.copyService.rewriteForHttp(user.orgId || user.id || '', user.id || '', body)
  }

  @Post('rewrite-style')
  async rewriteStyle(
    @GetToken() user: { orgId?: string, id?: string },
    @Body() body: {
      text?: string
      fromPlatform?: string
      toPlatform?: string
      styleGuide?: string
      brandId?: string
      taskId?: string
    },
  ) {
    return this.styleRewriteService.rewriteForPlatform(
      body.text || '',
      body.fromPlatform || '',
      body.toPlatform || '',
      body.styleGuide,
      {
        orgId: user.orgId || user.id || '',
        userId: user.id || '',
        taskId: body.taskId || null,
        brandId: body.brandId || null,
      },
    )
  }

  @Post('blue-words')
  async generateBlueWords(@Body() body: {
    title?: string
    keywords?: string[]
  }) {
    return this.copyService.generateBlueWords(
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
      commentGuide: this.copyService.generateCommentGuide(
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
      variants: this.copyService.generateABVariants(
        body.baseTitle || '',
        body.count,
      ),
    }
  }

  @Post('performance')
  async recordPerformance(
    @GetToken() user: { orgId?: string, id?: string },
    @Body() body: RecordCopyPerformanceInput,
  ) {
    return this.copyService.recordPerformance(user.orgId || user.id || '', body)
  }

  @Get('insights')
  async getInsights(
    @GetToken() user: { orgId?: string, id?: string },
    @Query('period') period = '30d',
  ) {
    return this.copyService.getInsights(user.orgId || user.id || '', period)
  }

  @Get('top-patterns')
  async getTopPatterns(
    @GetToken() user: { orgId?: string, id?: string },
    @Query('platform') platform?: string,
    @Query('limit') limit = '5',
  ) {
    return this.copyService.getTopPatterns(
      user.orgId || user.id || '',
      platform,
      Number(limit || 5),
    )
  }
}
