import { Get, Query } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { MediaClawAuthUser } from '../mediaclaw-auth.types'
import { DataDashboardService } from './data-dashboard.service'

@MediaClawApiController('api/v1/data')
export class DataDashboardController {
  constructor(private readonly dataDashboardService: DataDashboardService) {}

  @Get('overview')
  async getOverview(
    @GetToken() user: MediaClawAuthUser,
    @Query('period') period?: string,
  ) {
    return this.dataDashboardService.getOverview(
      user.orgId || user.id,
      period ? Number.parseInt(period, 10) : 30,
    )
  }

  @Get('health')
  async getContentHealth(
    @GetToken() user: MediaClawAuthUser,
    @Query('period') period?: string,
  ) {
    return this.dataDashboardService.getContentHealth(
      user.orgId || user.id,
      period ? Number.parseInt(period, 10) : 30,
    )
  }

  @Get('benchmark')
  async getCompetitorBenchmark(
    @GetToken() user: MediaClawAuthUser,
    @Query('industry') industry = 'generic',
    @Query('period') period?: string,
  ) {
    return this.dataDashboardService.getCompetitorBenchmark(
      user.orgId || user.id,
      industry,
      period ? Number.parseInt(period, 10) : 30,
    )
  }

  @Get('cold-start')
  async getColdStartRecommendations(@GetToken() user: MediaClawAuthUser) {
    return this.dataDashboardService.getColdStartRecommendations(user.orgId || user.id)
  }

  @Get('export')
  async exportReport(
    @GetToken() user: MediaClawAuthUser,
    @Query('format') format = 'json',
    @Query('period') period?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.dataDashboardService.exportReport(
      user.orgId || user.id,
      format,
      { startDate, endDate },
      period ? Number.parseInt(period, 10) : 30,
    )
  }
}
