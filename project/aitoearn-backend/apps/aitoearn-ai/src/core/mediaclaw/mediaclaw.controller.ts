import { Body, Controller, Get, Logger, Param, Post, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Public } from '@yikart/aitoearn-auth'
import { ApiDoc } from '@yikart/common'
import {
  ProductShowcaseDto,
  AiLiveDto,
  ExplainerDto,
  RemixBriefDto,
  TrendingScoutDto,
  ContentPlannerDto,
  PlatformPackagerDto,
} from './mediaclaw.dto'
import { MediaclawService } from './mediaclaw.service'
import {
  PipelineResultVo,
  RemixBriefVo,
  TrendingScoutVo,
  ContentPlannerVo,
  PlatformPackagerVo,
  PerformanceInsightVo,
} from './mediaclaw.vo'

@ApiTags('mediaclaw')
@Controller('mediaclaw')
export class MediaclawController {
  private readonly logger = new Logger(MediaclawController.name)

  constructor(private readonly mediaclawService: MediaclawService) {}

  @Post('pipeline/product-showcase')
  @Public()
  @ApiDoc({
    summary: '启动种草管线',
    response: PipelineResultVo,
  })
  async runProductShowcase(@Body() dto: ProductShowcaseDto) {
    this.logger.log('POST /mediaclaw/pipeline/product-showcase')
    return await this.mediaclawService.runProductShowcase(dto)
  }

  @Post('pipeline/ai-live')
  @Public()
  @ApiDoc({
    summary: '启动 AI 微动管线',
    response: PipelineResultVo,
  })
  async runAiLive(@Body() dto: AiLiveDto) {
    this.logger.log('POST /mediaclaw/pipeline/ai-live')
    return await this.mediaclawService.runAiLive(dto)
  }

  @Post('pipeline/explainer')
  @Public()
  @ApiDoc({
    summary: '启动讲解视频管线',
    response: PipelineResultVo,
  })
  async runExplainer(@Body() dto: ExplainerDto) {
    this.logger.log('POST /mediaclaw/pipeline/explainer')
    return await this.mediaclawService.runExplainer(dto)
  }

  @Post('tools/remix-brief')
  @Public()
  @ApiDoc({
    summary: '复刻拆解',
    response: RemixBriefVo,
  })
  async createRemixBrief(@Body() dto: RemixBriefDto) {
    this.logger.log('POST /mediaclaw/tools/remix-brief')
    return await this.mediaclawService.createRemixBrief(dto)
  }

  @Post('tools/trending-scout')
  @Public()
  @ApiDoc({
    summary: '趋势发现',
    response: TrendingScoutVo,
  })
  async scoutTrending(@Body() dto: TrendingScoutDto) {
    this.logger.log('POST /mediaclaw/tools/trending-scout')
    return await this.mediaclawService.scoutTrending(dto)
  }

  @Post('tools/content-planner')
  @Public()
  @ApiDoc({
    summary: '内容策划',
    response: ContentPlannerVo,
  })
  async planContent(@Body() dto: ContentPlannerDto) {
    this.logger.log('POST /mediaclaw/tools/content-planner')
    return await this.mediaclawService.planContent(dto)
  }

  @Post('tools/platform-packager')
  @Public()
  @ApiDoc({
    summary: '平台包装',
    response: PlatformPackagerVo,
  })
  async packageForPlatform(@Body() dto: PlatformPackagerDto) {
    this.logger.log('POST /mediaclaw/tools/platform-packager')
    return await this.mediaclawService.packageForPlatform(dto)
  }

  @Get('insights/:videoId')
  @Public()
  @ApiDoc({
    summary: '实时效果查询',
    response: PerformanceInsightVo,
  })
  async getInsight(
    @Param('videoId') videoId: string,
    @Query('platform') platform: string = 'douyin',
  ) {
    this.logger.log(`GET /mediaclaw/insights/${videoId}`)
    return await this.mediaclawService.getInsight(videoId, platform)
  }

  @Get('insights/monthly/:orgId')
  @Public()
  @ApiDoc({
    summary: '月度报告',
    response: PerformanceInsightVo,
  })
  async getMonthlyInsight(
    @Param('orgId') orgId: string,
    @Query('period') period: string,
  ) {
    this.logger.log(`GET /mediaclaw/insights/monthly/${orgId}`)
    return await this.mediaclawService.getMonthlyInsight(orgId, period)
  }
}
