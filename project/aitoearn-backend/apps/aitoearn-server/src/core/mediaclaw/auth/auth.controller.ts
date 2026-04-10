import { Body, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
import { GetToken, Public } from '@yikart/aitoearn-auth'
import { UserRole } from '@yikart/mongodb'
import { Type } from 'class-transformer'
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { PermissionGuard, Roles } from '../permission.guard'
import { McAuthService } from './auth.service'
import { EnterpriseAuthService } from './enterprise-auth.service'
import {
  CreateEnterpriseSsoProviderDto,
  EnterpriseSsoCallbackQueryDto,
  EnterpriseSsoLoginUrlQueryDto,
  EnterpriseSsoSamlAssertionDto,
} from './enterprise-sso.dto'
import { EnterpriseSsoService } from './enterprise-sso.service'
import { PersonalSharedExperienceService } from './personal-shared-experience.service'

class SendSmsDto {
  @IsString()
  @MaxLength(32)
  phone: string
}

class VerifySmsDto {
  @IsString()
  @MaxLength(32)
  phone: string

  @IsString()
  @MaxLength(32)
  code: string
}

class WechatCallbackDto {
  @IsString()
  @MaxLength(512)
  code: string
}

class RefreshTokenDto {
  @IsString()
  @MaxLength(4096)
  refreshToken: string
}

class CompatLoginDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  type?: string

  @IsOptional()
  @IsString()
  @MaxLength(64)
  phone?: string

  @IsOptional()
  @IsString()
  @MaxLength(32)
  code?: string

  @IsOptional()
  @IsString()
  @MaxLength(256)
  email?: string

  @IsOptional()
  @IsString()
  @MaxLength(128)
  password?: string
}

class CompatRegisterDto {
  @IsString()
  @MaxLength(128)
  account: string

  @IsOptional()
  @IsString()
  @MaxLength(128)
  password?: string

  @IsOptional()
  @IsString()
  @MaxLength(128)
  company?: string
}

class RegisterEnterpriseDto {
  @IsString()
  @MaxLength(128)
  orgName: string

  @IsString()
  @MaxLength(32)
  adminPhone: string

  @IsString()
  @MaxLength(32)
  code: string

  @IsOptional()
  @IsString()
  @MaxLength(64)
  adminName?: string

  @IsOptional()
  @IsString()
  @MaxLength(256)
  contactEmail?: string

  @IsOptional()
  @IsString()
  @MaxLength(64)
  contactName?: string

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  monthlyQuota?: number

  @IsOptional()
  @IsString()
  @MaxLength(128)
  companyName?: string

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  businessLicenseUrl?: string

  @IsOptional()
  @IsString()
  @MaxLength(64)
  unifiedSocialCreditCode?: string

  @IsOptional()
  @IsString()
  @MaxLength(64)
  legalRepresentative?: string

  @IsOptional()
  @IsString()
  @MaxLength(256)
  registeredAddress?: string

  @IsOptional()
  @IsString()
  @MaxLength(64)
  industry?: string

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  officialWebsite?: string

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string
}

class InviteEnterpriseMemberDto {
  @IsString()
  @MaxLength(32)
  phone: string

  @IsEnum(UserRole)
  role: UserRole
}

class AcceptInviteDto {
  @IsString()
  @MaxLength(2048)
  token: string

  @IsString()
  @MaxLength(32)
  phone: string

  @IsString()
  @MaxLength(32)
  code: string
}

class SwitchOrgDto {
  @IsString()
  @MaxLength(64)
  orgId: string
}

class ActivatePersonalSharedExperienceDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  instanceId?: string

  @IsOptional()
  @IsString()
  @MaxLength(64)
  preferredChannel?: string
}

@MediaClawApiController('api/v1/auth')
export class McAuthController {
  constructor(
    private readonly authService: McAuthService,
    private readonly enterpriseAuthService: EnterpriseAuthService,
    private readonly enterpriseSsoService: EnterpriseSsoService,
    private readonly personalSharedExperienceService: PersonalSharedExperienceService,
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
  @Post('login')
  async compatLogin(@Body() body: CompatLoginDto) {
    return this.authService.compatLogin(body)
  }

  @Public()
  @Post('register')
  async compatRegister(@Body() body: CompatRegisterDto) {
    return this.authService.compatRegister(body)
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

  @Public()
  @Get('personal/shared-experience/catalog')
  async getPersonalSharedExperienceCatalog() {
    return this.personalSharedExperienceService.getCatalog()
  }

  @Get('personal/shared-experience')
  async getPersonalSharedExperience(@GetToken() user: { id: string }) {
    return this.personalSharedExperienceService.getMyEntry(user.id)
  }

  @Post('personal/shared-experience/activate')
  async activatePersonalSharedExperience(
    @GetToken() user: { id: string },
    @Body() body: ActivatePersonalSharedExperienceDto,
  ) {
    return this.personalSharedExperienceService.activate(user.id, body)
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

  @Roles(UserRole.ENTERPRISE_ADMIN)
  @UseGuards(PermissionGuard)
  @Post('enterprise/sso/providers')
  async createSsoProvider(
    @GetToken() user: { orgId?: string, id: string },
    @Body() body: CreateEnterpriseSsoProviderDto,
  ) {
    return this.enterpriseSsoService.createProvider(
      user.orgId || '',
      user.id,
      body,
    )
  }

  @Roles(UserRole.ENTERPRISE_ADMIN)
  @UseGuards(PermissionGuard)
  @Get('enterprise/sso/providers')
  async listSsoProviders(@GetToken() user: { orgId?: string }) {
    return this.enterpriseSsoService.listProviders(user.orgId || '')
  }

  @Roles(UserRole.ENTERPRISE_ADMIN)
  @UseGuards(PermissionGuard)
  @Delete('enterprise/sso/providers/:providerId')
  async deleteSsoProvider(
    @GetToken() user: { orgId?: string },
    @Param('providerId') providerId: string,
  ) {
    return this.enterpriseSsoService.deleteProvider(user.orgId || '', providerId)
  }

  @Public()
  @Get('enterprise/sso/providers/:providerId/login-url')
  async getSsoLoginUrl(
    @Param('providerId') providerId: string,
    @Query() query: EnterpriseSsoLoginUrlQueryDto,
  ) {
    return this.enterpriseSsoService.getLoginUrl(providerId, query)
  }

  @Public()
  @Get('enterprise/sso/callback')
  async handleSsoCallback(@Query() query: EnterpriseSsoCallbackQueryDto) {
    return this.enterpriseSsoService.handleOidcCallback(query.code, query.state)
  }

  @Public()
  @Post('enterprise/sso/saml/assertion')
  async handleSamlAssertion(@Body() body: EnterpriseSsoSamlAssertionDto) {
    return this.enterpriseSsoService.handleSamlAssertion(
      body.samlResponse,
      body.relayState,
      body.providerId,
    )
  }
}
