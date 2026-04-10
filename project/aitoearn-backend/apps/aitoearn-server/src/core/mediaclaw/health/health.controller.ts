import { Body, Get, Post, Query } from '@nestjs/common'
import { HealthCheck } from '@nestjs/terminus'
import { GetToken, Public } from '@yikart/aitoearn-auth'
import { UserRole } from '@yikart/mongodb'
import {
  IsArray,
  IsOptional,
  IsString,
} from 'class-validator'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { MediaClawAuthUser } from '../mediaclaw-auth.types'
import { Roles } from '../permission.guard'
import { MediaClawHealthCheckService } from './health-check.service'
import { HealthService } from './health.service'
import { SlaService } from './sla.service'

class HeartbeatDto {
  @IsOptional()
  @IsString()
  clientVersion?: string

  @IsOptional()
  @IsString()
  agentId?: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  capabilities?: string[]
}

class EvaluateSlaDto {
  @IsOptional()
  @IsString()
  windowStart?: string

  @IsOptional()
  @IsString()
  windowEnd?: string
}

class SlaHistoryQueryDto {
  @IsOptional()
  @IsString()
  limit?: string
}

@MediaClawApiController('api/v1')
export class HealthController {
  constructor(
    private readonly healthService: HealthService,
    private readonly mediaClawHealthCheckService: MediaClawHealthCheckService,
    private readonly slaService: SlaService,
  ) {}

  @Public()
  @Get('health')
  check() {
    return this.healthService.getPublicStatus()
  }

  @Roles(UserRole.SUPER_ADMIN)
  @Get('health/status')
  async getDashboardStatus() {
    return this.mediaClawHealthCheckService.getDashboardStatus()
  }

  @Post('heartbeat')
  async heartbeat(
    @GetToken() user: MediaClawAuthUser,
    @Body() body: HeartbeatDto,
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

  @Roles(UserRole.SUPER_ADMIN)
  @Get('health/storage/policy')
  async getStorageLifecyclePolicy() {
    return this.mediaClawHealthCheckService.getStorageLifecyclePolicy()
  }

  @Get('health/metrics')
  async getApiMetrics() {
    return this.mediaClawHealthCheckService.getApiMetrics()
  }

  @Get('health/sla')
  async getCurrentSla(@GetToken() user: MediaClawAuthUser) {
    return this.slaService.getCurrentSla({
      orgId: user.orgId,
      userId: user.id,
    })
  }

  @Post('health/sla/evaluate')
  async evaluateSla(
    @GetToken() user: MediaClawAuthUser,
    @Body() body: EvaluateSlaDto,
  ) {
    return this.slaService.evaluateCurrentSla({
      orgId: user.orgId,
      userId: user.id,
    }, body)
  }

  @Get('health/sla/history')
  async getSlaHistory(
    @GetToken() user: MediaClawAuthUser,
    @Query() query: SlaHistoryQueryDto,
  ) {
    return this.slaService.listHistory({
      orgId: user.orgId,
      userId: user.id,
    }, query.limit)
  }
}
