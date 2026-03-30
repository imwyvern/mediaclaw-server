import { Body, Controller, Post, Query } from '@nestjs/common'
import { Public } from '@yikart/aitoearn-auth'
import { McAuthService } from './auth.service'

@Controller('api/v1/auth')
export class McAuthController {
  constructor(private readonly authService: McAuthService) {}

  @Public()
  @Post('sms/send')
  async sendSms(@Body('phone') phone: string) {
    return this.authService.sendSmsCode(phone)
  }

  @Public()
  @Post('sms/verify')
  async verifySms(@Body() body: { phone: string; code: string }) {
    return this.authService.verifySmsCode(body.phone, body.code)
  }

  @Public()
  @Post('wechat/callback')
  async wechatCallback(@Query('code') code: string) {
    return this.authService.wechatCallback(code)
  }

  @Public()
  @Post('refresh')
  async refresh(@Body('refreshToken') refreshToken: string) {
    return this.authService.refreshToken(refreshToken)
  }
}
