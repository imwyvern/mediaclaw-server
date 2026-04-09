import {
  Body,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import {
  OrganizationModelPreferenceKey,
  UserRole,
} from '@yikart/mongodb'
import { Type } from 'class-transformer'
import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { PermissionGuard, Roles } from '../permission.guard'
import { OrgService } from './org.service'

class EnterpriseProfileDto {
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

class InviteOrgMemberDto {
  @IsString()
  phone: string

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole
}

class UpdateOrgMemberRoleDto {
  @IsEnum(UserRole)
  role: UserRole
}

class UpsertOrganizationDto {
  @IsOptional()
  @IsString()
  name?: string

  @IsOptional()
  @IsString()
  contactName?: string

  @IsOptional()
  @IsString()
  contactPhone?: string

  @IsOptional()
  @IsString()
  contactEmail?: string

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>

  @IsOptional()
  @ValidateNested()
  @Type(() => EnterpriseProfileDto)
  enterpriseProfile?: EnterpriseProfileDto
}

class UpdateModelPreferencesDto {
  @IsOptional()
  @IsString()
  chat?: string | null

  @IsOptional()
  @IsString()
  copy?: string | null

  @IsOptional()
  @IsString()
  frameEdit?: string | null

  @IsOptional()
  @IsString()
  videoGen?: string | null

  @IsOptional()
  @IsString()
  analysis?: string | null
}

@UseGuards(PermissionGuard)
@Roles(UserRole.ENTERPRISE_ADMIN)
@MediaClawApiController('api/v1/org')
export class OrgController {
  constructor(private readonly orgService: OrgService) {}

  @Get()
  async findCurrent(@GetToken() user: { orgId?: string, id?: string }) {
    return this.orgService.findById(this.resolveOrgId(user))
  }

  @Get('members')
  async listMembers(@GetToken() user: { orgId?: string, id?: string }) {
    return this.orgService.listMembers(this.resolveOrgId(user))
  }

  @Get('invites')
  async listPendingInvites(@GetToken() user: { orgId?: string, id?: string }) {
    return this.orgService.listPendingInvites(this.resolveOrgId(user))
  }

  @Get('model-preferences')
  async getModelPreferences(@GetToken() user: { orgId?: string, id?: string }) {
    return this.orgService.getModelPreferences(this.resolveOrgId(user))
  }

  @Post('members/invite')
  async inviteMember(
    @GetToken() user: { orgId?: string, id?: string },
    @Body() body: InviteOrgMemberDto,
  ) {
    return this.orgService.inviteMember(
      this.resolveOrgId(user),
      body.phone,
      body.role || UserRole.EMPLOYEE,
      user.id,
    )
  }

  @Patch('members/:userId/role')
  async updateMemberRole(
    @GetToken() user: { orgId?: string, id?: string },
    @Param('userId') userId: string,
    @Body() body: UpdateOrgMemberRoleDto,
  ) {
    return this.orgService.updateMemberRole(this.resolveOrgId(user), userId, body.role)
  }

  @Delete('members/:userId')
  async removeMember(
    @GetToken() user: { orgId?: string, id?: string },
    @Param('userId') userId: string,
  ) {
    return this.orgService.removeMember(this.resolveOrgId(user), userId)
  }

  @Delete('invites/:inviteId')
  async revokeInvite(
    @GetToken() user: { orgId?: string, id?: string },
    @Param('inviteId') inviteId: string,
  ) {
    return this.orgService.revokeInvite(this.resolveOrgId(user), inviteId)
  }

  @Post()
  async create(
    @GetToken() user: { orgId?: string, id?: string },
    @Body() body: UpsertOrganizationDto,
  ) {
    return this.orgService.createForCurrentOrg(this.resolveOrgId(user), this.toOrganizationPayload(body))
  }

  @Get(':id')
  async findOne(
    @GetToken() user: { orgId?: string, id?: string },
    @Param('id') id: string,
  ) {
    this.assertOwnedOrg(user, id)
    return this.orgService.findById(this.resolveOrgId(user))
  }

  @Patch()
  async updateCurrent(
    @GetToken() user: { orgId?: string, id?: string },
    @Body() body: UpsertOrganizationDto,
  ) {
    return this.orgService.update(this.resolveOrgId(user), this.toOrganizationPayload(body))
  }

  @Patch('model-preferences')
  async updateModelPreferences(
    @GetToken() user: { orgId?: string, id?: string },
    @Body() body: UpdateModelPreferencesDto,
  ) {
    const preferences: Partial<Record<OrganizationModelPreferenceKey, string | null | undefined>> = {
      chat: body.chat,
      copy: body.copy,
      frameEdit: body.frameEdit,
      videoGen: body.videoGen,
      analysis: body.analysis,
    }
    return this.orgService.updateModelPreferences(this.resolveOrgId(user), preferences)
  }

  @Patch(':id')
  async update(
    @GetToken() user: { orgId?: string, id?: string },
    @Param('id') id: string,
    @Body() body: UpsertOrganizationDto,
  ) {
    this.assertOwnedOrg(user, id)
    return this.orgService.update(this.resolveOrgId(user), this.toOrganizationPayload(body))
  }

  private resolveOrgId(user: { orgId?: string, id?: string }) {
    const orgId = user.orgId || user.id
    if (!orgId) {
      throw new ForbiddenException('No organization selected')
    }

    return orgId
  }

  private assertOwnedOrg(user: { orgId?: string, id?: string }, requestedOrgId: string) {
    const currentOrgId = this.resolveOrgId(user)
    if (requestedOrgId !== currentOrgId) {
      throw new ForbiddenException('Cannot access another organization')
    }
  }

  private toOrganizationPayload(body: UpsertOrganizationDto) {
    return {
      ...body,
      ...(body.enterpriseProfile ? { enterpriseProfile: { ...body.enterpriseProfile } } : {}),
      ...(body.settings ? { settings: { ...body.settings } } : {}),
    } as any
  }
}
