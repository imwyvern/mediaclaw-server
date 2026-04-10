import { Controller, Get, Header, UseGuards } from '@nestjs/common'
import { Throttle, ThrottlerGuard } from '@nestjs/throttler'
import { Public } from '@yikart/aitoearn-auth'
import client from 'prom-client'
import { MonitoringMetricsService } from './monitoring-metrics.service'

@Controller()
@UseGuards(ThrottlerGuard)
@Throttle({
  mediaclawPublic: {
    limit: 30,
    ttl: 60_000,
  },
})
export class MonitoringMetricsController {
  constructor(
    private readonly monitoringMetricsService: MonitoringMetricsService,
  ) {}

  @Public()
  @Get('metrics')
  @Header('content-type', client.register.contentType)
  async getMetrics() {
    return this.monitoringMetricsService.renderPrometheusMetrics()
  }
}
