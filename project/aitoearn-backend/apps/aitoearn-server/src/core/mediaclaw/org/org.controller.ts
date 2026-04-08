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
  Organization,
  OrganizationEnterpriseProfile,
  OrganizationModelPreferenceKey,
  UserRole,
} from '@yikart/mongodb'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { PermissionGuard, Roles } from '../permission.guard'
import { OrgService } from './org.service'

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
    @Body() body: { phone: string, role?: UserRole },
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
    @Body('role') role: UserRole,
  ) {
    return this.orgService.updateMemberRole(this.resolveOrgId(user), userId, role)
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
    @Body() body: Partial<Organization> & { enterpriseProfile?: Partial<OrganizationEnterpriseProfile> },
  ) {
    return this.orgService.createForCurrentOrg(this.resolveOrgId(user), body)
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
    @Body() body: Partial<Organization> & { enterpriseProfile?: Partial<OrganizationEnterpriseProfile> },
  ) {
    return this.orgService.update(this.resolveOrgId(user), body)
  }

  @Patch('model-preferences')
  async updateModelPreferences(
    @GetToken() user: { orgId?: string, id?: string },
    @Body() body: Partial<Record<OrganizationModelPreferenceKey, string | null | undefined>>,
  ) {
    return this.orgService.updateModelPreferences(this.resolveOrgId(user), body)
  }

  @Patch(':id')
  async update(
    @GetToken() user: { orgId?: string, id?: string },
    @Param('id') id: string,
    @Body() body: Partial<Organization> & { enterpriseProfile?: Partial<OrganizationEnterpriseProfile> },
  ) {
    this.assertOwnedOrg(user, id)
    return this.orgService.update(this.resolveOrgId(user), body)
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
}
