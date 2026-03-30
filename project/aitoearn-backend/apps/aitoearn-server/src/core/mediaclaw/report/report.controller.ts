import { Body, Delete, Get, Param, Post, Query } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { ReportType } from '@yikart/mongodb'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { ReportService } from './report.service'

@MediaClawApiController('api/v1/reports')
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  @Post('generate')
  async generate(
    @GetToken() user: any,
    @Body() body: {
      type: ReportType
      period: {
        start: string
        end: string
      }
    },
  ) {
    return this.reportService.generateReport(user.orgId || user.id, body.type, body.period)
  }

  @Post('schedule')
  async schedule(
    @GetToken() user: any,
    @Body() body: Record<string, any>,
  ) {
    return this.reportService.scheduleAutoReport(user.orgId || user.id, body)
  }

  @Get()
  async list(
    @GetToken() user: any,
    @Query('type') type?: ReportType,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.reportService.listReports(user.orgId || user.id, {
      type,
      startDate,
      endDate,
    })
  }

  @Get(':id')
  async detail(@GetToken() user: any, @Param('id') id: string) {
    return this.reportService.getReport(user.orgId || user.id, id)
  }

  @Delete(':id')
  async remove(@GetToken() user: any, @Param('id') id: string) {
    return this.reportService.deleteReport(user.orgId || user.id, id)
  }
}
