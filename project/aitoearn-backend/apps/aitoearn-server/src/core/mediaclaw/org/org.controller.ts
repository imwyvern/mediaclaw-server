import { Body, Get, Patch, Post, UseGuards } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { UserRole } from '@yikart/mongodb'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { PermissionGuard, Roles } from '../permission.guard'
import { OrgService } from './org.service'

@UseGuards(PermissionGuard)
@Roles(UserRole.ADMIN)
@MediaClawApiController('api/v1/org')
export class OrgController {
  constructor(private readonly orgService: OrgService) {}

  @Post()
  async create(@GetToken() user: any, @Body() body: any) {
    return this.orgService.createForCurrentOrg(user.orgId || user.id, body)
  }

  @Get(':id')
  async findOne(@GetToken() user: any) {
    return this.orgService.findById(user.orgId || user.id)
  }

  @Patch(':id')
  async update(@GetToken() user: any, @Body() body: any) {
    return this.orgService.update(user.orgId || user.id, body)
  }
}
