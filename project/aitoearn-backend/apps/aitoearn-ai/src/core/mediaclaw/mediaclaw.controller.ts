import { Body, Controller, Get, Logger, Param, Post, Query } from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
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
  @ApiOperation({
    summary: '启动种草视频管线',
    description: '提交种草视频生产任务到异步队列。包含视频下载、场景拆解、品牌替换、AI视频生成、文案配音、合成、质检全流程。',
  })
  @ApiResponse({ status: 201, description: '任务已入队', schema: { properties: { taskId: { type: 'string' }, status: { type: 'string', enum: ['queued'] }, pipelineType: { type: 'string' } } } })
  async runProductShowcase(@Body() dto: ProductShowcaseDto) {
    this.logger.log('POST /mediaclaw/pipeline/product-showcase')
    const taskId = randomUUID()
    await this.queueService.addMediaclawPipelineJob({
      pipelineType: 'product-showcase',
      input: { ...dto } as Record<string, unknown>,
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
  @ApiOperation({
    summary: '启动 AI 微动视频管线',
    description: '将静态产品图通过 Seedance/Kling 生成微动视频，加配音合成。',
  })
  @ApiResponse({ status: 201, description: '任务已入队' })
  async runAiLive(@Body() dto: AiLiveDto) {
    this.logger.log('POST /mediaclaw/pipeline/ai-live')
    const taskId = randomUUID()
    await this.queueService.addMediaclawPipelineJob({
      pipelineType: 'ai-live',
      input: { ...dto } as Record<string, unknown>,
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
  @ApiOperation({
    summary: '启动讲解视频管线',
    description: '基于 Remotion/HyperFrames 模板生成产品讲解视频，包含文案撰写、TTS配音、合成。',
  })
  @ApiResponse({ status: 201, description: '任务已入队' })
  async runExplainer(@Body() dto: ExplainerDto) {
    this.logger.log('POST /mediaclaw/pipeline/explainer')
    const taskId = randomUUID()
    await this.queueService.addMediaclawPipelineJob({
      pipelineType: 'explainer',
      input: { ...dto } as Record<string, unknown>,
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
  @ApiOperation({
    summary: '查询管线任务状态',
    description: '通过 taskId 查询异步管线任务的执行状态、进度和结果。',
  })
  @ApiResponse({ status: 200, description: '任务状态', schema: { properties: { taskId: { type: 'string' }, status: { type: 'string', enum: ['waiting', 'active', 'completed', 'failed', 'not_found'] }, progress: { type: 'object' }, result: { type: 'object' }, failedReason: { type: 'string', nullable: true } } } })
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
  @ApiOperation({
    summary: '复刻拆解',
    description: '分析参考视频URL，自动拆解为场景切割、文案、模型分配的完整 Brief。',
  })
  async createRemixBrief(@Body() dto: RemixBriefDto) {
    return await this.mediaclawService.createRemixBrief(dto)
  }

  @Post('tools/trending-scout')
  @Public()
  @ApiDoc({ summary: '趋势发现', response: TrendingScoutVo })
  @ApiOperation({
    summary: '趋势发现 / 竞品监控',
    description: '发现热门视频趋势或监控竞品账号动态。支持 discover（按品类发现）和 competitor（按账号监控）两种模式。',
  })
  async scoutTrending(@Body() dto: TrendingScoutDto) {
    return await this.mediaclawService.scoutTrending(dto)
  }

  @Post('tools/content-planner')
  @Public()
  @ApiDoc({ summary: '内容策划', response: ContentPlannerVo })
  @ApiOperation({
    summary: '内容策划',
    description: '基于品牌、产品、历史表现和预算，AI 生成周度内容日历。',
  })
  async planContent(@Body() dto: ContentPlannerDto) {
    return await this.mediaclawService.planContent(dto)
  }

  @Post('tools/platform-packager')
  @Public()
  @ApiDoc({ summary: '平台包装', response: PlatformPackagerVo })
  @ApiOperation({
    summary: '平台包装',
    description: '为指定平台（抖音/小红书/快手/B站）生成标题、封面、标签、描述，并做合规检查。',
  })
  async packageForPlatform(@Body() dto: PlatformPackagerDto) {
    return await this.mediaclawService.packageForPlatform(dto)
  }

  @Get('insights/:videoId')
  @Public()
  @ApiDoc({ summary: '实时效果查询', response: PerformanceInsightVo })
  @ApiOperation({
    summary: '实时效果查询',
    description: '查询已发布视频的实时播放数据（播放/点赞/评论/分享），与行业基准对比并给出优化建议。',
  })
  async getInsight(
    @Param('videoId') videoId: string,
    @Query('platform') platform: string = 'douyin',
  ) {
    return await this.mediaclawService.getInsight(videoId, platform)
  }

  @Get('insights/monthly/:orgId')
  @Public()
  @ApiDoc({ summary: '月度报告', response: PerformanceInsightVo })
  @ApiOperation({
    summary: '月度效果报告',
    description: '获取指定组织的月度内容效果汇总：最佳类型、节省成本、投放建议。',
  })
  async getMonthlyInsight(
    @Param('orgId') orgId: string,
    @Query('period') period: string,
  ) {
    return await this.mediaclawService.getMonthlyInsight(orgId, period)
  }
}
