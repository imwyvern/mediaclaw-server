import {
  Body,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { OrgStatus, OrgType, UserRole } from '@yikart/mongodb'
import { IsEnum, IsOptional, IsString } from 'class-validator'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { PermissionGuard, Roles } from '../permission.guard'
import { ClientMgmtService } from './client-mgmt.service'

class UpdateOrgStatusDto {
  @IsEnum(OrgStatus)
  status: OrgStatus
}

class UpdateClientMemberRoleDto {
  @IsEnum(UserRole)
  role: UserRole
}

class InviteClientMemberDto {
  @IsString()
  phone: string

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole
}

@UseGuards(PermissionGuard)
@Roles(UserRole.SUPER_ADMIN)
@MediaClawApiController('api/v1/admin/orgs')
export class ClientMgmtController {
  constructor(private readonly clientMgmtService: ClientMgmtService) {}

  @Get()
  async listOrgs(
    @Query('status') status?: OrgStatus,
    @Query('type') type?: OrgType,
    @Query('keyword') keyword?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.clientMgmtService.listOrgs(
      { status, type, keyword },
      {
        page: page ? Number.parseInt(page, 10) : 1,
        limit: limit ? Number.parseInt(limit, 10) : 20,
      },
    )
  }

  @Get(':orgId/invites')
  async listPendingInvites(@Param('orgId') orgId: string) {
    return this.clientMgmtService.listPendingInvites(orgId)
  }

  @Get(':orgId')
  async getOrgDetail(@Param('orgId') orgId: string) {
    return this.clientMgmtService.getOrgDetail(orgId)
  }

  @Patch(':orgId/status')
  async updateOrgStatus(
    @Param('orgId') orgId: string,
    @Body() body: UpdateOrgStatusDto,
  ) {
    return this.clientMgmtService.updateOrgStatus(orgId, body.status)
  }

  @Get(':orgId/members')
  async listOrgMembers(@Param('orgId') orgId: string) {
    return this.clientMgmtService.listOrgMembers(orgId)
  }

  @Patch(':orgId/members/:userId/role')
  async updateMemberRole(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Body() body: UpdateClientMemberRoleDto,
  ) {
    return this.clientMgmtService.updateMemberRole(orgId, userId, body.role)
  }

  @Delete(':orgId/members/:userId')
  async removeOrgMember(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
  ) {
    return this.clientMgmtService.removeOrgMember(orgId, userId)
  }

  @Post(':orgId/invite')
  async inviteMember(
    @Param('orgId') orgId: string,
    @Body() body: InviteClientMemberDto,
  ) {
    return this.clientMgmtService.inviteMember(orgId, body.phone, body.role)
  }

  @Delete(':orgId/invites/:inviteId')
  async revokeInvite(
    @Param('orgId') orgId: string,
    @Param('inviteId') inviteId: string,
  ) {
    return this.clientMgmtService.revokeInvite(orgId, inviteId)
  }
}
