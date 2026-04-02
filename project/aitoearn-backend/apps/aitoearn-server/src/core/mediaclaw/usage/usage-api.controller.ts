import { BadRequestException, Get, Query } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { UsageService } from './usage.service'

@MediaClawApiController('api/v1/usage')
export class UsageApiController {
  constructor(private readonly usageService: UsageService) {}

  @Get()
  async summary(
    @GetToken() user: any,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.usageService.getApiUsageSummary(user.orgId || user.id, {
      startDate,
      endDate,
    })
  }

  @Get('quota')
  async quota(@GetToken() user: any) {
    return this.usageService.getQuotaStatus(user.orgId || user.id)
  }

  @Get('rate-limit')
  async rateLimit(
    @GetToken() user: any,
    @Query('apiKey') apiKey?: string,
  ) {
    const resolvedApiKey = apiKey || user.apiKeyId || ''
    if (!resolvedApiKey) {
      throw new BadRequestException('apiKey is required')
    }

    return this.usageService.getRateLimitStatus(resolvedApiKey)
  }
}
