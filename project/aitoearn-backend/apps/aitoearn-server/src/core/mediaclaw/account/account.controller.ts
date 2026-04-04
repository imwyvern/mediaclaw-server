import { Body, Get, Patch } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { MediaClawAuthUser } from '../mediaclaw-auth.types'
import { McAccountService } from './account.service'

@MediaClawApiController('api/v1/account')
export class McAccountController {
  constructor(private readonly accountService: McAccountService) {}

  @Get('info')
  async getInfo(@GetToken() user: MediaClawAuthUser) {
    return this.accountService.getInfo(user.id)
  }

  @Patch('profile')
  async updateProfile(
    @GetToken() user: MediaClawAuthUser,
    @Body() body: { name?: string, avatarUrl?: string, email?: string },
  ) {
    return this.accountService.updateProfile(user.id, body)
  }
}
