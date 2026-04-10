import { Controller, Get, UseGuards } from '@nestjs/common'
import { Throttle, ThrottlerGuard } from '@nestjs/throttler'
import { Public } from '@yikart/aitoearn-auth'
import { HealthService } from './health.service'

@Controller()
@UseGuards(ThrottlerGuard)
@Throttle({
  mediaclawPublic: {
    limit: 60,
    ttl: 60_000,
  },
})
export class PublicHealthController {
  constructor(private readonly healthService: HealthService) {}

  @Public()
  @Get('health')
  check() {
    return this.healthService.getPublicStatus()
  }
}
