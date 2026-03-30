import { Body, Get, Post, Query, UseGuards } from '@nestjs/common'
import { GetToken, Public } from '@yikart/aitoearn-auth'
import { UserRole } from '@yikart/mongodb'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { PermissionGuard, Roles } from '../permission.guard'
import { McAuthService } from './auth.service'
import { EnterpriseAuthService } from './enterprise-auth.service'

@MediaClawApiController('api/v1/auth')
export class McAuthController {
  constructor(
    private readonly authService: McAuthService,
    private readonly enterpriseAuthService: EnterpriseAuthService,
  ) {}

  @Public()
  @Post('sms/send')
  async sendSms(@Body('phone') phone: string) {
    return this.authService.sendSmsCode(phone)
  }

  @Public()
  @Post('sms/verify')
  async verifySms(@Body() body: { phone: string, code: string }) {
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

  @Public()
  @Post('enterprise/register')
  async registerEnterprise(
    @Body()
    body: {
      orgName: string
      adminPhone: string
      adminName?: string
      contactEmail?: string
      contactName?: string
      monthlyQuota?: number
    },
  ) {
    return this.enterpriseAuthService.registerEnterprise(body)
  }

  @Roles(UserRole.ADMIN)
  @UseGuards(PermissionGuard)
  @Post('enterprise/invite')
  async inviteByPhone(
    @GetToken() user: { orgId?: string },
    @Body()
    body: {
      orgId?: string
      phone: string
      role: UserRole
    },
  ) {
    return this.enterpriseAuthService.inviteByPhone(
      user.orgId || '',
      body.phone,
      body.role,
    )
  }

  @Public()
  @Post('enterprise/accept-invite')
  async acceptInvite(
    @Body()
    body: {
      token: string
      phone: string
      code: string
    },
  ) {
    return this.enterpriseAuthService.acceptInvite(body.token, body.phone, body.code)
  }

  @Post('switch-org')
  async switchOrg(
    @GetToken() user: { id: string },
    @Body('orgId') orgId: string,
  ) {
    return this.enterpriseAuthService.switchOrg(user.id, orgId)
  }

  @Get('my-orgs')
  async listUserOrgs(@GetToken() user: { id: string }) {
    return this.enterpriseAuthService.listUserOrgs(user.id)
  }
}
