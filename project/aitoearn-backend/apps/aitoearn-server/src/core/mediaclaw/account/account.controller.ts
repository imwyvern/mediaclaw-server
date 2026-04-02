import { Body, Get, Patch } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { McAccountService } from './account.service'

@MediaClawApiController('api/v1/account')
export class McAccountController {
  constructor(private readonly accountService: McAccountService) {}

  @Get('info')
  async getInfo(@GetToken() user: any) {
    return this.accountService.getInfo(user.id)
  }

  @Patch('profile')
  async updateProfile(@GetToken() user: any, @Body() body: any) {
    return this.accountService.updateProfile(user.id, body)
  }
}
