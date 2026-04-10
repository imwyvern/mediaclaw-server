import {
  Body,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common'
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger'
import { GetToken, Public } from '@yikart/aitoearn-auth'
import { IsString } from 'class-validator'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { MediaClawAuthUser } from '../mediaclaw-auth.types'
import { CompetitorService } from './competitor.service'

class AddCompetitorDto {
  @IsString()
  platform: string

  @IsString()
  accountUrl: string
}

@MediaClawApiController('api/v1/competitors')
export class CompetitorController {
  constructor(private readonly competitorService: CompetitorService) {}

  @Post()
  @ApiOperation({ summary: '添加竞品账号' })
  @ApiBody({ type: AddCompetitorDto })
  @ApiCreatedResponse({ description: '竞品账号已加入监控列表' })
  async addCompetitor(
    @GetToken() user: MediaClawAuthUser,
    @Body() body: AddCompetitorDto,
  ) {
    return this.competitorService.addCompetitor(
      user.orgId || user.id,
      body.platform,
      body.accountUrl,
    )
  }

  @Get()
  @ApiOperation({ summary: '获取当前组织的竞品列表' })
  @ApiOkResponse({ description: '返回当前组织的竞品账号列表' })
  async listCompetitors(@GetToken() user: MediaClawAuthUser) {
    return this.competitorService.listCompetitors(user.orgId || user.id)
  }

  @Get('hot')
  @ApiOperation({ summary: '获取竞品热点内容榜单' })
  @ApiQuery({ name: 'period', required: false, description: '时间窗口，例如 7d' })
  @ApiQuery({ name: 'limit', required: false, description: '榜单数量，默认 5' })
  @ApiQuery({ name: 'platform', required: false, description: '平台过滤' })
  @ApiQuery({ name: 'orgId', required: false, description: '可选组织 ID，匿名 demo 时使用' })
  @ApiOkResponse({ description: '返回竞品热点榜单' })
  @Public()
  async getCompetitorHot(
    @GetToken() user: MediaClawAuthUser | undefined,
    @Query('period') period = '7d',
    @Query('limit') limit = '5',
    @Query('platform') platform?: string,
    @Query('orgId') orgId?: string,
  ) {
    return this.competitorService.getCompetitorHot(
      orgId || user?.orgId || user?.id || '',
      period,
      Number(limit),
      platform,
    )
  }

  @Get('trending')
  @ApiOperation({ summary: '获取行业热点内容榜单' })
  @ApiQuery({ name: 'industry', required: true, description: '行业关键词' })
  @ApiQuery({ name: 'platform', required: false, description: '平台过滤' })
  @ApiQuery({ name: 'period', required: false, description: '时间窗口，例如 7d' })
  @ApiOkResponse({ description: '返回行业热点榜单' })
  @Public()
  async getIndustryHot(
    @Query('industry') industry: string,
    @Query('platform') platform?: string,
    @Query('period') period = '7d',
  ) {
    return this.competitorService.getIndustryHot(industry, platform, period)
  }

  @Post(':id/sync')
  @ApiOperation({ summary: '同步单个竞品账号的最新数据' })
  @ApiParam({ name: 'id', description: '竞品记录 ID' })
  @ApiCreatedResponse({ description: '竞品账号同步任务已触发' })
  async syncCompetitor(
    @GetToken() user: MediaClawAuthUser,
    @Param('id') id: string,
  ) {
    return this.competitorService.syncCompetitor(user.orgId || user.id, id)
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除竞品账号' })
  @ApiParam({ name: 'id', description: '竞品记录 ID' })
  @ApiOkResponse({ description: '竞品账号已删除' })
  async removeCompetitor(@GetToken() user: MediaClawAuthUser, @Param('id') id: string) {
    return this.competitorService.removeCompetitor(user.orgId || user.id, id)
  }
}
