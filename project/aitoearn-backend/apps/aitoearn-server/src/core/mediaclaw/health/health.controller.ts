import { Controller, Get } from '@nestjs/common'
import { Public } from '@yikart/aitoearn-auth'

@Controller('api/v1/health')
export class HealthController {
  @Public()
  @Get()
  check() {
    return {
      status: 'ok',
      service: 'mediaclaw-api',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    }
  }
}
