import {
  Body,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { Organization, OrganizationEnterpriseProfile, UserRole } from '@yikart/mongodb'
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
