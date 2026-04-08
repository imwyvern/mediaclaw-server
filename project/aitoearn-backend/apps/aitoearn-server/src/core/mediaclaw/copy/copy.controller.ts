import { Body, Get, Param, Post, Query } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { MediaClawAuthUser } from '../mediaclaw-auth.types'
import {
  CopyHistoryQueryDto,
  CopyInsightsQueryDto,
  CopyTopPatternsQueryDto,
  GenerateAbVariantsDto,
  GenerateBlueWordsDto,
  GenerateCommentGuideDto,
  GenerateCopyDto,
  RecordCopyPerformanceDto,
  RewriteCopyDto,
  RewriteStyleDto,
} from './copy.dto'
import { CopyService } from './copy.service'
import { StyleRewriteService } from './style-rewrite.service'

@MediaClawApiController('api/v1/copy')
export class CopyController {
  constructor(
    private readonly copyService: CopyService,
    private readonly styleRewriteService: StyleRewriteService,
  ) {}

  @Post('generate')
  async generateCopy(
    @GetToken() user: MediaClawAuthUser,
    @Body() body: GenerateCopyDto,
  ) {
    return this.copyService.generateForHttp(user.orgId || user.id || '', user.id || '', body)
  }

  @Post('rewrite')
  async rewriteCopy(
    @GetToken() user: MediaClawAuthUser,
    @Body() body: RewriteCopyDto,
  ) {
    return this.copyService.rewriteForHttp(user.orgId || user.id || '', user.id || '', body)
  }

  @Post('rewrite-style')
  async rewriteStyle(
    @GetToken() user: MediaClawAuthUser,
    @Body() body: RewriteStyleDto,
  ) {
    return this.styleRewriteService.rewriteForPlatform(
      body.text,
      body.fromPlatform,
      body.toPlatform,
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
  async generateBlueWords(@Body() body: GenerateBlueWordsDto) {
    return this.copyService.generateBlueWords(
      body.title,
      body.keywords || [],
    )
  }

  @Post('comment-guide')
  async generateCommentGuide(@Body() body: GenerateCommentGuideDto) {
    return {
      commentGuide: this.copyService.generateCommentGuide(
        body.brand || '',
        body.content || '',
      ),
    }
  }

  @Post('ab-variants')
  async generateABVariants(@Body() body: GenerateAbVariantsDto) {
    return {
      variants: this.copyService.generateABVariants(
        body.baseTitle,
        body.count,
      ),
    }
  }

  @Post('performance')
  async recordPerformance(
    @GetToken() user: MediaClawAuthUser,
    @Body() body: RecordCopyPerformanceDto,
  ) {
    return this.copyService.recordPerformance(user.orgId || user.id || '', body)
  }

  @Get('history')
  async listHistory(
    @GetToken() user: MediaClawAuthUser,
    @Query() query: CopyHistoryQueryDto,
  ) {
    return this.copyService.listHistory(user.orgId || user.id || '', query)
  }

  @Get('history/:id')
  async getHistory(
    @GetToken() user: MediaClawAuthUser,
    @Param('id') id: string,
  ) {
    return this.copyService.getHistory(user.orgId || user.id || '', id)
  }

  @Get('insights')
  async getInsights(
    @GetToken() user: MediaClawAuthUser,
    @Query() query: CopyInsightsQueryDto,
  ) {
    return this.copyService.getInsights(user.orgId || user.id || '', query.period || '30d')
  }

  @Get('top-patterns')
  async getTopPatterns(
    @GetToken() user: MediaClawAuthUser,
    @Query() query: CopyTopPatternsQueryDto,
  ) {
    return this.copyService.getTopPatterns(
      user.orgId || user.id || '',
      query.platform,
      query.limit || 5,
    )
  }
}
