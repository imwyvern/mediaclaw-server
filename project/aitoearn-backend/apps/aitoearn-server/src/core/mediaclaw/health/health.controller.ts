import { Body, Controller, Get, Post } from '@nestjs/common'
import { GetToken, Public } from '@yikart/aitoearn-auth'
import { HealthService } from './health.service'

@Controller('api/v1')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

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
}
