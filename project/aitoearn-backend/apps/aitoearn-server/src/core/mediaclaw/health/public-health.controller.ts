import { Controller, Get } from '@nestjs/common'
import { Public } from '@yikart/aitoearn-auth'
import { HealthService } from './health.service'

@Controller()
export class PublicHealthController {
  constructor(private readonly healthService: HealthService) {}

  @Public()
  @Get('health')
  check() {
    return this.healthService.getPublicStatus()
  }
}
