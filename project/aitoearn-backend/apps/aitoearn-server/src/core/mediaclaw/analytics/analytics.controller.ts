import { Body, Get, Param, Post, Query } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { ReportType } from '@yikart/mongodb'
import { Type } from 'class-transformer'
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator'

import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { ReportService } from '../report/report.service'
import { AnalyticsService } from './analytics.service'

class RefreshAnalyticsDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  period?: number
}

class AnalyticsReportPeriodDto {
  @IsOptional()
  @IsString()
  start?: string

  @IsOptional()
  @IsString()
  end?: string
}

class GenerateAnalyticsReportDto {
  @IsOptional()
  @IsEnum(ReportType)
  type?: ReportType

  @IsOptional()
  @ValidateNested()
  @Type(() => AnalyticsReportPeriodDto)
  period?: AnalyticsReportPeriodDto

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  formats?: string[]

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  waitForCompletion?: boolean

  @IsOptional()
  @IsString()
  startDate?: string

  @IsOptional()
  @IsString()
  endDate?: string
}

class LegacyAnalyticsExportDto {
  @IsOptional()
  @IsString()
  template?: string

  @IsOptional()
  @IsString()
  dateRange?: string

  @IsOptional()
  @IsString()
  format?: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  platforms?: string[]

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isScheduled?: boolean

  @IsOptional()
  @IsString()
  scheduleEmail?: string
}

@MediaClawApiController('api/v1/analytics')
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly reportService: ReportService,
  ) {}

  @Get('overview')
  async getOverview(
    @GetToken() user: { orgId?: string, id?: string },
    @Query('period') period?: string,
  ) {
    return this.analyticsService.getOverview(
      user.orgId || user.id || '',
      period ? Number.parseInt(period, 10) : 30,
    )
  }

  @Post('collect/:videoTaskId')
  async collectVideo(
    @GetToken() user: { orgId?: string, id?: string },
    @Param('videoTaskId') videoTaskId: string,
  ) {
    return this.analyticsService.collectVideo(user.orgId || user.id || '', videoTaskId)
  }

  @Get('video/:videoTaskId/timeseries')
  async getVideoTimeSeries(
    @GetToken() user: { orgId?: string, id?: string },
    @Param('videoTaskId') videoTaskId: string,
    @Query('period') period?: string,
  ) {
    return this.analyticsService.getVideoTimeSeries(
      user.orgId || user.id || '',
      videoTaskId,
      period ? Number.parseInt(period, 10) : 90,
    )
  }

  @Get('video/:videoTaskId/latest')
  async getVideoLatestMetrics(
    @GetToken() user: { orgId?: string, id?: string },
    @Param('videoTaskId') videoTaskId: string,
  ) {
    return this.analyticsService.getVideoLatestMetrics(user.orgId || user.id || '', videoTaskId)
  }

  @Get('video/:videoId')
  async getVideoHistory(
    @GetToken() user: { orgId?: string, id?: string },
    @Param('videoId') videoId: string,
  ) {
    return this.analyticsService.getVideoHistory(user.orgId || user.id || '', videoId)
  }

  @Get('content/:id')
  async getContentAnalytics(
    @GetToken() user: { orgId?: string, id?: string },
    @Param('id') id: string,
  ) {
    return this.analyticsService.getVideoStats(user.orgId || user.id || '', id)
  }

  @Get('benchmark')
  async getBenchmark(
    @GetToken() user: { orgId?: string, id?: string },
    @Query('industry') industry?: string,
  ) {
    return this.analyticsService.getBenchmark(user.orgId || user.id || '', industry)
  }

  @Post('refresh')
  async refreshAnalytics(
    @GetToken() user: { orgId?: string, id?: string },
    @Body() body: RefreshAnalyticsDto,
  ) {
    return this.analyticsService.refreshAnalytics(
      user.orgId || user.id || '',
      body?.limit,
      body?.period,
    )
  }

  @Get('stats/:id')
  async getVideoStats(
    @GetToken() user: { orgId?: string, id?: string },
    @Param('id') id: string,
  ) {
    return this.analyticsService.getVideoStats(user.orgId || user.id || '', id)
  }

  @Get('trends')
  async getTrends(
    @GetToken() user: { orgId?: string, id?: string },
    @Query('period') period: 'daily' | 'weekly' | 'monthly' = 'daily',
    @Query('metric') metric:
      | 'views'
      | 'likes'
      | 'comments'
      | 'shares'
      | 'saves'
      | 'followers'
      | 'engagementRate'
      | 'engagement'
      | 'conversion' = 'views',
    @Query('windowDays') windowDays?: string,
  ) {
    return this.analyticsService.getTrends(
      user.orgId || user.id || '',
      period,
      metric,
      windowDays ? Number.parseInt(windowDays, 10) : 30,
    )
  }

  @Get('top')
  async getTopContent(
    @GetToken() user: { orgId?: string, id?: string },
    @Query('limit') limit = '10',
    @Query('metric') metric:
      | 'views'
      | 'likes'
      | 'comments'
      | 'shares'
      | 'saves'
      | 'followers'
      | 'engagementRate'
      | 'engagement'
      | 'conversion' = 'views',
    @Query('period') period?: string,
  ) {
    return this.analyticsService.getTopContent(
      user.orgId || user.id || '',
      Number.parseInt(limit, 10),
      metric,
      period ? Number.parseInt(period, 10) : 30,
    )
  }

  @Get('exports')
  async listLegacyExports(
    @GetToken() user: { orgId?: string, id?: string },
  ) {
    const reports = await this.reportService.listReports(user.orgId || user.id || '')
    return {
      items: reports.map(report => ({
        id: report.id,
        name: report.type,
        type: report.type,
        format: Array.isArray(report.requestedFormats) ? report.requestedFormats[0] : 'pdf',
        dateRange: report.period?.start && report.period?.end
          ? `${report.period.start} ~ ${report.period.end}`
          : '',
        status: report.status,
        createdAt: report.createdAt,
        url: report.fileUrl,
      })),
      total: reports.length,
      page: 1,
      limit: reports.length || 20,
    }
  }

  @Post('export')
  async createLegacyExport(
    @GetToken() user: { orgId?: string, id?: string },
    @Body() body: LegacyAnalyticsExportDto,
  ) {
    if (body.isScheduled) {
      return this.reportService.scheduleAutoReport(user.orgId || user.id || '', {
        type: this.mapLegacyTemplateToReportType(body.template),
        recipients: body.scheduleEmail ? [body.scheduleEmail] : [],
        formats: [this.normalizeLegacyReportFormat(body.format)],
        filters: {
          dateRange: body.dateRange || '30d',
          platforms: body.platforms || [],
        },
        isActive: true,
      })
    }

    return this.reportService.generateReport(
      user.orgId || user.id || '',
      this.mapLegacyTemplateToReportType(body.template),
      this.resolveLegacyReportPeriod(body.dateRange),
      {
        formats: [this.normalizeLegacyReportFormat(body.format)],
        waitForCompletion: false,
      },
    )
  }

  @Get('seo')
  async getSeo(
    @GetToken() user: { orgId?: string, id?: string },
    @Query('windowDays') windowDays?: string,
    @Query('limit') limit?: string,
  ) {
    return this.analyticsService.getSeoInsights(
      user.orgId || user.id || '',
      windowDays ? Number.parseInt(windowDays, 10) : 30,
      limit ? Number.parseInt(limit, 10) : 10,
    )
  }

  @Post('report')
  async generateReport(
    @GetToken() user: { orgId?: string, id?: string },
    @Body() body: GenerateAnalyticsReportDto,
  ) {
    const periodEnd = body.period?.end || body.endDate || new Date().toISOString()
    const periodStart = body.period?.start
      || body.startDate
      || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

    return this.reportService.generateReport(
      user.orgId || user.id || '',
      body.type || ReportType.WEEKLY,
      {
        start: periodStart,
        end: periodEnd,
      },
      {
        formats: body.formats,
        waitForCompletion: body.waitForCompletion,
      },
    )
  }

  private mapLegacyTemplateToReportType(template?: string) {
    switch ((template || '').trim().toLowerCase()) {
      case 'monthly':
        return ReportType.MONTHLY
      case 'campaign':
        return ReportType.CAMPAIGN
      case 'brand':
        return ReportType.BRAND
      default:
        return ReportType.WEEKLY
    }
  }

  private normalizeLegacyReportFormat(format?: string) {
    const normalized = (format || '').trim().toLowerCase()
    if (normalized === 'pdf') {
      return 'pdf'
    }

    return 'markdown'
  }

  private resolveLegacyReportPeriod(dateRange?: string) {
    const normalized = (dateRange || '').trim().toLowerCase()
    const end = new Date()
    const start = new Date(end)
    switch (normalized) {
      case '7d':
        start.setDate(end.getDate() - 7)
        break
      case '90d':
        start.setDate(end.getDate() - 90)
        break
      case 'all':
        start.setFullYear(end.getFullYear() - 1)
        break
      case '30d':
      default:
        start.setDate(end.getDate() - 30)
        break
    }

    return {
      start: start.toISOString(),
      end: end.toISOString(),
    }
  }
}
