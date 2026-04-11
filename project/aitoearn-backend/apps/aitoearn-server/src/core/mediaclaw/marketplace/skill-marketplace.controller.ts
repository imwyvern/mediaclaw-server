import { Body, Get, Post, Query, UseGuards } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import {
  SkillMarketplaceEntryStatus,
  SkillMarketplaceVisibility,
  UserRole,
} from '@yikart/mongodb'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { MediaClawAuthUser } from '../mediaclaw-auth.types'
import { PermissionGuard, Roles } from '../permission.guard'
import {
  InstallSkillMarketplaceEntryDto,
  RateSkillMarketplaceEntryDto,
  RegisterSkillMarketplaceEntryDto,
  UninstallSkillMarketplaceEntryDto,
} from './skill-marketplace.dto'
import { SkillMarketplaceService } from './skill-marketplace.service'

@MediaClawApiController('api/v1/marketplace/skills')
export class SkillMarketplaceController {
  constructor(private readonly skillMarketplaceService: SkillMarketplaceService) {}

  @UseGuards(PermissionGuard)
  @Roles(UserRole.ENTERPRISE_ADMIN)
  @Post('register')
  async register(
    @GetToken() user: MediaClawAuthUser,
    @Body() body: RegisterSkillMarketplaceEntryDto,
  ) {
    return this.skillMarketplaceService.registerSkill(user.orgId || user.id, body)
  }

  @Get()
  async list(
    @GetToken() user: MediaClawAuthUser,
    @Query('search') search?: string,
    @Query('category') category?: string,
    @Query('tag') tag?: string,
    @Query('capability') capability?: string,
    @Query('status') status?: SkillMarketplaceEntryStatus,
    @Query('visibility') visibility?: SkillMarketplaceVisibility,
    @Query('sort') sort?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.skillMarketplaceService.listSkills(
      user.orgId || user.id,
      {
        search,
        category,
        tag,
        capability,
        status,
        visibility,
      },
      sort,
      {
        page: Number(page),
        limit: Number(limit),
      },
    )
  }

  @UseGuards(PermissionGuard)
  @Roles(UserRole.ENTERPRISE_ADMIN)
  @Post('install')
  async install(
    @GetToken() user: MediaClawAuthUser,
    @Body() body: InstallSkillMarketplaceEntryDto,
  ) {
    return this.skillMarketplaceService.installSkill(user.orgId || user.id, body)
  }

  @UseGuards(PermissionGuard)
  @Roles(UserRole.ENTERPRISE_ADMIN)
  @Post('uninstall')
  async uninstall(
    @GetToken() user: MediaClawAuthUser,
    @Body() body: UninstallSkillMarketplaceEntryDto,
  ) {
    return this.skillMarketplaceService.uninstallSkill(user.orgId || user.id, body)
  }

  @UseGuards(PermissionGuard)
  @Roles(UserRole.ENTERPRISE_ADMIN)
  @Post('rate')
  async rate(
    @GetToken() user: MediaClawAuthUser,
    @Body() body: RateSkillMarketplaceEntryDto,
  ) {
    return this.skillMarketplaceService.rateSkill(user.orgId || user.id, body)
  }
}
