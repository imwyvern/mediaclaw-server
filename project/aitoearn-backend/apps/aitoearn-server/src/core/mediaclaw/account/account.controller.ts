import { Body, Controller, Get, Patch } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { McAccountService } from './account.service'

@Controller('api/v1/account')
export class McAccountController {
  constructor(private readonly accountService: McAccountService) {}

  @Get('info')
  async getInfo(@GetToken() user: any) {
    return this.accountService.getInfo(user.id)
  }

  @Get('usage')
  async getUsage(@GetToken() user: any) {
    return this.accountService.getUsage(user.id)
  }

  @Patch('profile')
  async updateProfile(@GetToken() user: any, @Body() body: any) {
    return this.accountService.updateProfile(user.id, body)
  }
}
