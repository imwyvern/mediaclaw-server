import { Controller, Get, Header } from '@nestjs/common'
import { Public } from '@yikart/aitoearn-auth'
import client from 'prom-client'
import { MonitoringMetricsService } from './monitoring-metrics.service'

@Controller()
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
