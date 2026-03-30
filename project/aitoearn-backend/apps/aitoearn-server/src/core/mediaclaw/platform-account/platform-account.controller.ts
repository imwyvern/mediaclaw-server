import { Body, Delete, Get, Param, Post, Query } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { PlatformAccountPlatform } from '@yikart/mongodb'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { PlatformAccountService } from './platform-account.service'

@MediaClawApiController('api/v1/platform-accounts')
export class PlatformAccountController {
  constructor(private readonly platformAccountService: PlatformAccountService) {}

  @Post()
  async create(
    @GetToken() user: any,
    @Body() body: {
      platform: PlatformAccountPlatform
      accountId?: string
      accountName?: string
      avatarUrl?: string
      credentials?: Record<string, any>
    },
  ) {
    return this.platformAccountService.addAccount(
      user.orgId || user.id,
      body.platform,
      {
        ...(body.credentials || {}),
        accountId: body.accountId || body.credentials?.['accountId'],
        accountName: body.accountName || body.credentials?.['accountName'],
        avatarUrl: body.avatarUrl || body.credentials?.['avatarUrl'],
      },
    )
  }

  @Get()
  async list(@GetToken() user: any) {
    return this.platformAccountService.listAccounts(user.orgId || user.id)
  }

  @Get(':id')
  async detail(@GetToken() user: any, @Param('id') id: string) {
    return this.platformAccountService.getAccount(user.orgId || user.id, id)
  }

  @Post(':id/sync')
  async sync(@GetToken() user: any, @Param('id') id: string) {
    return this.platformAccountService.syncMetrics(user.orgId || user.id, id)
  }

  @Get(':id/history')
  async history(
    @GetToken() user: any,
    @Param('id') id: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.platformAccountService.getPublishHistory(user.orgId || user.id, id, {
      page: Number(page),
      limit: Number(limit),
    })
  }

  @Delete(':id')
  async remove(@GetToken() user: any, @Param('id') id: string) {
    return this.platformAccountService.removeAccount(user.orgId || user.id, id)
  }
}
