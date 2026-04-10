import { Get, Query, UseGuards } from '@nestjs/common'
import { OrgStatus, OrgType, UserRole } from '@yikart/mongodb'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { PermissionGuard, Roles } from '../permission.guard'
import { MonitoringMetricsService } from '../health/monitoring-metrics.service'
import { ClientMgmtService } from './client-mgmt.service'

@UseGuards(PermissionGuard)
@Roles(UserRole.SUPER_ADMIN)
@MediaClawApiController('api/v1/admin')
export class AdminDashboardController {
  constructor(
    private readonly clientMgmtService: ClientMgmtService,
    private readonly monitoringMetricsService: MonitoringMetricsService,
  ) {}

  @Get('customers')
  async listCustomers(
    @Query('status') status?: OrgStatus,
    @Query('type') type?: OrgType,
    @Query('keyword') keyword?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.clientMgmtService.listOrgs(
      { status, type, keyword },
      {
        page: page ? Number.parseInt(page, 10) : 1,
        limit: limit ? Number.parseInt(limit, 10) : 20,
      },
    )
  }

  @Get('stats')
  async getStats() {
    const [videosToday, snapshot] = await Promise.all([
      this.clientMgmtService.countVideosCreatedToday(),
      Promise.resolve(this.monitoringMetricsService.getOperationalSnapshot()),
    ])

    return {
      videosToday,
      apiCalls: snapshot.http.totalRequests,
      errorRate: Number((snapshot.http.errorRate * 100).toFixed(2)),
      queueDepth: snapshot.queue.depth,
      queueLatency: snapshot.queue.latency,
    }
  }
}
