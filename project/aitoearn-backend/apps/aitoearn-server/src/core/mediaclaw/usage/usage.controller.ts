import { Get, Query } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { UsageHistoryType } from '@yikart/mongodb'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { UsageService } from './usage.service'

@MediaClawApiController('api/v1/account')
export class UsageController {
  constructor(private readonly usageService: UsageService) {}

  @Get()
  async account(@GetToken() user: { id: string, orgId?: string | null }) {
    return this.usageService.getAccountOverview({
      userId: user.id,
      orgId: user.orgId || null,
    })
  }

  @Get('usage')
  async summary(
    @GetToken() user: { id: string, orgId?: string | null },
    @Query('start') start?: string,
    @Query('end') end?: string,
  ) {
    const monthStart = new Date()
    monthStart.setUTCDate(1)
    monthStart.setUTCHours(0, 0, 0, 0)

    return this.usageService.getUsageSummary(
      {
        userId: user.id,
        orgId: user.orgId || null,
      },
      start || monthStart,
      end || new Date(),
    )
  }

  @Get('usage/timeline')
  async timeline(
    @GetToken() user: { id: string, orgId?: string | null },
    @Query('start') start?: string,
    @Query('end') end?: string,
    @Query('granularity') granularity?: 'day' | 'week' | 'month',
  ) {
    return this.usageService.getUsageTimeline(
      {
        userId: user.id,
        orgId: user.orgId || null,
      },
      start,
      end,
      granularity || 'day',
    )
  }

  @Get('usage/detail')
  async detail(
    @GetToken() user: { id: string, orgId?: string | null },
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('type') type?: UsageHistoryType,
  ) {
    return this.usageService.getUsageDetail(
      {
        userId: user.id,
        orgId: user.orgId || null,
      },
      {
        page: page ? Number.parseInt(page, 10) : 1,
        limit: limit ? Number.parseInt(limit, 10) : 20,
        type,
      },
    )
  }
}
