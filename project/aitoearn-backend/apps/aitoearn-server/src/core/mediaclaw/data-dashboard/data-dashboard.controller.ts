import { Controller, Get, Query } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { DataDashboardService } from './data-dashboard.service'

@Controller('api/v1/data')
export class DataDashboardController {
  constructor(private readonly dataDashboardService: DataDashboardService) {}

  @Get('health')
  async getContentHealth(@GetToken() user: any) {
    return this.dataDashboardService.getContentHealth(user.orgId || user.id)
  }

  @Get('benchmark')
  async getCompetitorBenchmark(
    @GetToken() user: any,
    @Query('industry') industry = 'generic',
  ) {
    return this.dataDashboardService.getCompetitorBenchmark(user.orgId || user.id, industry)
  }

  @Get('cold-start')
  async getColdStartRecommendations(@GetToken() user: any) {
    return this.dataDashboardService.getColdStartRecommendations(user.orgId || user.id)
  }

  @Get('export')
  async exportReport(
    @GetToken() user: any,
    @Query('format') format = 'json',
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.dataDashboardService.exportReport(
      user.orgId || user.id,
      format,
      { startDate, endDate },
    )
  }
}
