import { Body, Get, Post, Query } from '@nestjs/common'
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger'
import { GetToken, Public } from '@yikart/aitoearn-auth'
import { Type } from 'class-transformer'
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { MediaClawAuthUser } from '../mediaclaw-auth.types'
import { ContentRemixService } from './content-remix.service'
import { DiscoveryService } from './discovery.service'

class ViralScoreRequestDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  views?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  likes?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  comments?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  shares?: number

  @IsOptional()
  @IsString()
  publishedAt?: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  videoKeywords?: string[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  industryKeywords?: string[]
}

class MarkRemixedRequestDto {
  @IsString()
  contentId: string

  @IsString()
  taskId: string
}

class ContentIdRequestDto {
  @IsString()
  contentId: string
}

class GenerateRemixBriefRequestDto {
  @IsString()
  contentId: string

  @IsString()
  brandId: string
}

class ApplyRemixInsightsRequestDto {
  @IsString()
  contentId: string

  @IsString()
  pipelineId: string
}

class RemixAnalyzeRequestDto {
  @IsString()
  videoUrl: string

  @IsOptional()
  @IsString()
  pipelineId?: string

  @IsOptional()
  @IsString()
  contentId?: string
}

@Public()
@MediaClawApiController('api/v1/discovery')
export class DiscoveryController {
  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly contentRemixService: ContentRemixService,
  ) {}

  @Get('pool')
  @ApiOperation({ summary: '获取可推荐的爆款素材池' })
  @ApiQuery({ name: 'limit', required: false, description: '返回条数，默认 10' })
  @ApiQuery({ name: 'industry', required: false, description: '行业关键词过滤' })
  @ApiQuery({ name: 'orgId', required: false, description: '可选组织 ID，用于排除当前组织已改编内容' })
  @ApiOkResponse({ description: '返回推荐素材池列表' })
  async getRecommendationPool(
    @GetToken() user: MediaClawAuthUser | undefined,
    @Query('limit') limit = '10',
    @Query('industry') industry?: string,
    @Query('orgId') orgId?: string,
  ) {
    return this.discoveryService.getRecommendationPool(
      orgId || user?.orgId || user?.id,
      Number(limit),
      industry,
    )
  }

  @Post('score')
  @ApiOperation({ summary: '计算素材爆款分数' })
  @ApiBody({ type: ViralScoreRequestDto })
  @ApiOkResponse({ description: '返回素材的 viral score 计算结果' })
  async calculateViralScore(
    @Body() body: ViralScoreRequestDto,
  ) {
    return {
      viralScore: this.discoveryService.calculateViralScore(
        {
          views: body.views,
          likes: body.likes,
          comments: body.comments,
          shares: body.shares,
          keywords: body.videoKeywords,
        },
        body.publishedAt,
        body.industryKeywords || [],
      ),
    }
  }

  @Post('mark-remixed')
  @ApiOperation({ summary: '标记素材已完成改编' })
  @ApiBody({ type: MarkRemixedRequestDto })
  @ApiCreatedResponse({ description: '已记录素材改编状态' })
  async markRemixed(@Body() body: MarkRemixedRequestDto) {
    return this.discoveryService.markRemixed(body.contentId, body.taskId)
  }

  @Post('analyze-viral-elements')
  @ApiOperation({ summary: '分析爆款素材拆解要素' })
  @ApiBody({ type: ContentIdRequestDto })
  @ApiCreatedResponse({ description: '已生成素材的结构化爆款分析' })
  async analyzeViralElements(@Body() body: ContentIdRequestDto) {
    return this.contentRemixService.analyzeViralElements(body.contentId)
  }

  @Post('generate-remix-brief')
  @ApiOperation({ summary: '基于品牌生成素材改编 brief' })
  @ApiBody({ type: GenerateRemixBriefRequestDto })
  @ApiCreatedResponse({ description: '已生成素材改编 brief' })
  async generateRemixBrief(
    @Body() body: GenerateRemixBriefRequestDto,
  ) {
    return this.contentRemixService.generateRemixBrief(
      body.contentId,
      body.brandId,
    )
  }

  @Post('apply-remix-insights')
  @ApiOperation({ summary: '将爆款洞察写回到生产 pipeline' })
  @ApiBody({ type: ApplyRemixInsightsRequestDto })
  @ApiCreatedResponse({ description: '已将改编洞察应用到 pipeline 偏好配置' })
  async applyRemixInsights(
    @Body() body: ApplyRemixInsightsRequestDto,
  ) {
    return this.contentRemixService.applyRemixInsights(
      body.contentId,
      body.pipelineId,
    )
  }

  @Post('remix-analyze')
  @ApiOperation({ summary: '基于视频链接生成 5 维分析和 video recipe' })
  @ApiBody({ type: RemixAnalyzeRequestDto })
  @ApiCreatedResponse({ description: '已返回结构化 video recipe，并可选写回 pipeline 偏好' })
  async remixAnalyze(
    @Body() body: RemixAnalyzeRequestDto,
  ) {
    return this.contentRemixService.remixAnalyzeByVideoUrl(
      body.videoUrl,
      body.pipelineId,
      body.contentId,
    )
  }
}
