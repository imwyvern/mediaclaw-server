import { Body, Controller, Get, Logger, Param, Post, Query } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { Public } from '@yikart/aitoearn-auth'
import { ApiDoc } from '@yikart/common'
import { QueueService } from '@yikart/aitoearn-queue'
import { randomUUID } from 'node:crypto'
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

  constructor(
    private readonly mediaclawService: MediaclawService,
    private readonly queueService: QueueService,
  ) {}

  // === 管线端点（异步，走队列） ===

  @Post('pipeline/product-showcase')
  @Public()
  @ApiDoc({ summary: '启动种草管线（异步）' })
  async runProductShowcase(@Body() dto: ProductShowcaseDto) {
    this.logger.log('POST /mediaclaw/pipeline/product-showcase')
    const taskId = randomUUID()
    await this.queueService.addMediaclawPipelineJob({
      pipelineType: 'product-showcase',
      input: dto as any,
      userId: 'system', // TODO: 从 token 获取
      orgId: 'default',
      taskId,
      createdAt: new Date().toISOString(),
    })
    return { taskId, status: 'queued', pipelineType: 'product-showcase' }
  }

  @Post('pipeline/ai-live')
  @Public()
  @ApiDoc({ summary: '启动 AI 微动管线（异步）' })
  async runAiLive(@Body() dto: AiLiveDto) {
    this.logger.log('POST /mediaclaw/pipeline/ai-live')
    const taskId = randomUUID()
    await this.queueService.addMediaclawPipelineJob({
      pipelineType: 'ai-live',
      input: dto as any,
      userId: 'system',
      orgId: 'default',
      taskId,
      createdAt: new Date().toISOString(),
    })
    return { taskId, status: 'queued', pipelineType: 'ai-live' }
  }

  @Post('pipeline/explainer')
  @Public()
  @ApiDoc({ summary: '启动讲解视频管线（异步）' })
  async runExplainer(@Body() dto: ExplainerDto) {
    this.logger.log('POST /mediaclaw/pipeline/explainer')
    const taskId = randomUUID()
    await this.queueService.addMediaclawPipelineJob({
      pipelineType: 'explainer',
      input: dto as any,
      userId: 'system',
      orgId: 'default',
      taskId,
      createdAt: new Date().toISOString(),
    })
    return { taskId, status: 'queued', pipelineType: 'explainer' }
  }

  // === 任务状态查询 ===

  @Get('tasks/:taskId')
  @Public()
  @ApiDoc({ summary: '查询管线任务状态' })
  async getTaskStatus(@Param('taskId') taskId: string) {
    this.logger.log(`GET /mediaclaw/tasks/${taskId}`)
    const job = await this.queueService.getMediaclawPipelineJob(taskId)
    if (!job) {
      return { taskId, status: 'not_found' }
    }
    const state = await job.getState()
    const progress = job.progress
    const result = job.returnvalue
    const failedReason = job.failedReason
    return { taskId, status: state, progress, result, failedReason }
  }

  // === Tool 端点（同步） ===

  @Post('tools/remix-brief')
  @Public()
  @ApiDoc({ summary: '复刻拆解', response: RemixBriefVo })
  async createRemixBrief(@Body() dto: RemixBriefDto) {
    return await this.mediaclawService.createRemixBrief(dto)
  }

  @Post('tools/trending-scout')
  @Public()
  @ApiDoc({ summary: '趋势发现', response: TrendingScoutVo })
  async scoutTrending(@Body() dto: TrendingScoutDto) {
    return await this.mediaclawService.scoutTrending(dto)
  }

  @Post('tools/content-planner')
  @Public()
  @ApiDoc({ summary: '内容策划', response: ContentPlannerVo })
  async planContent(@Body() dto: ContentPlannerDto) {
    return await this.mediaclawService.planContent(dto)
  }

  @Post('tools/platform-packager')
  @Public()
  @ApiDoc({ summary: '平台包装', response: PlatformPackagerVo })
  async packageForPlatform(@Body() dto: PlatformPackagerDto) {
    return await this.mediaclawService.packageForPlatform(dto)
  }

  @Get('insights/:videoId')
  @Public()
  @ApiDoc({ summary: '实时效果查询', response: PerformanceInsightVo })
  async getInsight(
    @Param('videoId') videoId: string,
    @Query('platform') platform: string = 'douyin',
  ) {
    return await this.mediaclawService.getInsight(videoId, platform)
  }

  @Get('insights/monthly/:orgId')
  @Public()
  @ApiDoc({ summary: '月度报告', response: PerformanceInsightVo })
  async getMonthlyInsight(
    @Param('orgId') orgId: string,
    @Query('period') period: string,
  ) {
    return await this.mediaclawService.getMonthlyInsight(orgId, period)
  }
}
