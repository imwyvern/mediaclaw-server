import { Body, Get, Post, Query, UseGuards } from '@nestjs/common'
import { GetToken, Public } from '@yikart/aitoearn-auth'
import { UserRole } from '@yikart/mongodb'
import { Type } from 'class-transformer'
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { PermissionGuard, Roles } from '../permission.guard'
import { McAuthService } from './auth.service'
import { EnterpriseAuthService } from './enterprise-auth.service'

class SendSmsDto {
  @IsString()
  phone: string
}

class VerifySmsDto {
  @IsString()
  phone: string

  @IsString()
  code: string
}

class WechatCallbackDto {
  @IsString()
  code: string
}

class RefreshTokenDto {
  @IsString()
  refreshToken: string
}

class RegisterEnterpriseDto {
  @IsString()
  orgName: string

  @IsString()
  adminPhone: string

  @IsString()
  code: string

  @IsOptional()
  @IsString()
  adminName?: string

  @IsOptional()
  @IsString()
  contactEmail?: string

  @IsOptional()
  @IsString()
  contactName?: string

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  monthlyQuota?: number

  @IsOptional()
  @IsString()
  companyName?: string

  @IsOptional()
  @IsString()
  businessLicenseUrl?: string

  @IsOptional()
  @IsString()
  unifiedSocialCreditCode?: string

  @IsOptional()
  @IsString()
  legalRepresentative?: string

  @IsOptional()
  @IsString()
  registeredAddress?: string

  @IsOptional()
  @IsString()
  industry?: string

  @IsOptional()
  @IsString()
  officialWebsite?: string

  @IsOptional()
  @IsString()
  description?: string
}

class InviteEnterpriseMemberDto {
  @IsString()
  phone: string

  @IsEnum(UserRole)
  role: UserRole
}

class AcceptInviteDto {
  @IsString()
  token: string

  @IsString()
  phone: string

  @IsString()
  code: string
}

class SwitchOrgDto {
  @IsString()
  orgId: string
}

@MediaClawApiController('api/v1/auth')
export class McAuthController {
  constructor(
    private readonly authService: McAuthService,
    private readonly enterpriseAuthService: EnterpriseAuthService,
  ) {}

  @Public()
  @Post('sms/send')
  async sendSms(@Body() body: SendSmsDto) {
    return this.authService.sendSmsCode(body.phone)
  }

  @Public()
  @Post('sms/verify')
  async verifySms(@Body() body: VerifySmsDto) {
    return this.authService.verifySmsCode(body.phone, body.code)
  }

  @Public()
  @Get('wechat/login')
  async wechatLogin(
    @Query('redirectUri') redirectUri?: string,
    @Query('state') state?: string,
  ) {
    return this.authService.getWechatLoginUrl(redirectUri, state)
  }

  @Public()
  @Get('wechat/callback')
  async wechatCallbackByQuery(@Query('code') code?: string) {
    return this.authService.wechatCallback(code || '')
  }

  @Public()
  @Post('wechat/callback')
  async wechatCallback(
    @Body() body: WechatCallbackDto,
    @Query('code') codeFromQuery?: string,
  ) {
    return this.authService.wechatCallback(body.code || codeFromQuery || '')
  }

  @Public()
  @Post('refresh')
  async refresh(@Body() body: RefreshTokenDto) {
    return this.authService.refreshToken(body.refreshToken)
  }

  @Public()
  @Post('enterprise/register')
  async registerEnterprise(
    @Body() body: RegisterEnterpriseDto,
  ) {
    return this.enterpriseAuthService.registerEnterprise(body)
  }

  @Roles(UserRole.ENTERPRISE_ADMIN)
  @UseGuards(PermissionGuard)
  @Post('enterprise/invite')
  async inviteByPhone(
    @GetToken() user: { id: string, orgId?: string },
    @Body() body: InviteEnterpriseMemberDto,
  ) {
    return this.enterpriseAuthService.inviteByPhone(
      user.orgId || '',
      body.phone,
      body.role,
      user.id,
    )
  }

  @Roles(UserRole.ENTERPRISE_ADMIN)
  @UseGuards(PermissionGuard)
  @Get('enterprise/invites')
  async listPendingInvites(@GetToken() user: { orgId?: string }) {
    return this.enterpriseAuthService.listPendingInvites(user.orgId || '')
  }

  @Public()
  @Post('enterprise/accept-invite')
  async acceptInvite(@Body() body: AcceptInviteDto) {
    return this.enterpriseAuthService.acceptInvite(body.token, body.phone, body.code)
  }

  @Post('switch-org')
  async switchOrg(
    @GetToken() user: { id: string },
    @Body() body: SwitchOrgDto,
  ) {
    return this.enterpriseAuthService.switchOrg(user.id, body.orgId)
  }

  @Get('my-orgs')
  async listUserOrgs(@GetToken() user: { id: string }) {
    return this.enterpriseAuthService.listUserOrgs(user.id)
  }
}
