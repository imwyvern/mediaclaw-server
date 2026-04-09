import { Body, Get, Post, Query } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
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

@MediaClawApiController('api/v1/discovery')
export class DiscoveryController {
  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly contentRemixService: ContentRemixService,
  ) {}

  @Get('pool')
  async getRecommendationPool(
    @GetToken() user: MediaClawAuthUser,
    @Query('limit') limit = '10',
    @Query('industry') industry?: string,
  ) {
    return this.discoveryService.getRecommendationPool(
      user.orgId || user.id,
      Number(limit),
      industry,
    )
  }

  @Post('score')
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
  async markRemixed(@Body() body: MarkRemixedRequestDto) {
    return this.discoveryService.markRemixed(body.contentId, body.taskId)
  }

  @Post('analyze-viral-elements')
  async analyzeViralElements(@Body() body: ContentIdRequestDto) {
    return this.contentRemixService.analyzeViralElements(body.contentId)
  }

  @Post('generate-remix-brief')
  async generateRemixBrief(
    @Body() body: GenerateRemixBriefRequestDto,
  ) {
    return this.contentRemixService.generateRemixBrief(
      body.contentId,
      body.brandId,
    )
  }

  @Post('apply-remix-insights')
  async applyRemixInsights(
    @Body() body: ApplyRemixInsightsRequestDto,
  ) {
    return this.contentRemixService.applyRemixInsights(
      body.contentId,
      body.pipelineId,
    )
  }
}
