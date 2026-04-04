import { Body, Get, Post } from '@nestjs/common'
import { HealthCheck } from '@nestjs/terminus'
import { GetToken, Public } from '@yikart/aitoearn-auth'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { MediaClawAuthUser } from '../mediaclaw-auth.types'
import { MediaClawHealthCheckService } from './health-check.service'
import { HealthService } from './health.service'

@MediaClawApiController('api/v1')
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
    @GetToken() user: MediaClawAuthUser,
    @Body() body: {
      clientVersion?: string
      agentId?: string
      capabilities?: string[]
    },
  ) {
    return this.healthService.heartbeat(user, body)
  }

  @Public()
  @HealthCheck()
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
