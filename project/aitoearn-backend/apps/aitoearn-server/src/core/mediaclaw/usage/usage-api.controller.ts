import { BadRequestException, Get, Query } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { MediaClawAuthUser } from '../mediaclaw-auth.types'
import { UsageService } from './usage.service'

@MediaClawApiController('api/v1/usage')
export class UsageApiController {
  constructor(private readonly usageService: UsageService) {}

  @Get()
  async summary(
    @GetToken() user: MediaClawAuthUser,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.usageService.getApiUsageSummary(user.orgId || user.id, {
      startDate,
      endDate,
    })
  }

  @Get('summary')
  async packSummary(@GetToken() user: MediaClawAuthUser) {
    return this.usageService.getPackBalanceSummary({
      userId: user.id,
      orgId: user.orgId || null,
    })
  }

  @Get('history')
  async history(
    @GetToken() user: MediaClawAuthUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.usageService.getChargeHistory(
      {
        userId: user.id,
        orgId: user.orgId || null,
      },
      {
        page: page ? Number.parseInt(page, 10) : 1,
        limit: limit ? Number.parseInt(limit, 10) : 20,
      },
    )
  }

  @Get('quota')
  async quota(@GetToken() user: MediaClawAuthUser) {
    return this.usageService.getQuotaStatus(user.orgId || user.id)
  }

  @Get('rate-limit')
  async rateLimit(
    @GetToken() user: MediaClawAuthUser,
    @Query('apiKey') apiKey?: string,
  ) {
    const resolvedApiKey = apiKey || user.apiKeyId || ''
    if (!resolvedApiKey) {
      throw new BadRequestException('apiKey is required')
    }

    return this.usageService.getRateLimitStatus(resolvedApiKey)
  }
}
