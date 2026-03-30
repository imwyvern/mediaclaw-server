import { Body, Controller, Get, Post } from '@nestjs/common'
import { GetToken, Public } from '@yikart/aitoearn-auth'
import { MediaClawHealthCheckService } from './health-check.service'
import { HealthService } from './health.service'

@Controller('api/v1')
export class HealthController {
  constructor(
    private readonly healthService: HealthService,
    private readonly mediaClawHealthCheckService: MediaClawHealthCheckService,
  ) {}

  @Public()
  @Get('health')
  check() {
    return {
      status: 'ok',
      service: 'mediaclaw-api',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    }
  }

  @Post('heartbeat')
  async heartbeat(
    @GetToken() user: any,
    @Body() body: {
      clientVersion?: string
      agentId?: string
      capabilities?: string[]
    },
  ) {
    return this.healthService.heartbeat(user, body)
  }

  @Get('health/system')
  async getSystemHealth() {
    return this.mediaClawHealthCheckService.getSystemHealth()
  }

  @Get('health/workers')
  async getWorkerStatus() {
    return this.mediaClawHealthCheckService.getWorkerStatus()
  }

  @Get('health/storage')
  async getStorageUsage() {
    return this.mediaClawHealthCheckService.getStorageUsage()
  }

  @Get('health/metrics')
  async getApiMetrics() {
    return this.mediaClawHealthCheckService.getApiMetrics()
  }
}
