import {
  Body,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { UserRole } from '@yikart/mongodb'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { PermissionGuard, Roles } from '../permission.guard'
import {
  BatchUpgradeClawHostSkillDto,
  CreateClawHostInstanceDto,
  GetClawHostLogsQueryDto,
  InstallClawHostSkillDto,
  ListClawHostInstancesQueryDto,
} from './clawhost.dto'
import { ClawHostService } from './clawhost.service'

@UseGuards(PermissionGuard)
@Roles(UserRole.ENTERPRISE_ADMIN)
@MediaClawApiController('api/v1/clawhost')
export class ClawHostController {
  constructor(private readonly clawHostService: ClawHostService) {}

  @Post('instances')
  async createInstance(
    @GetToken() user: { orgId?: string, id: string },
    @Body() body: CreateClawHostInstanceDto,
  ) {
    return this.clawHostService.createInstance(
      user.orgId || user.id,
      body.config,
      body.clientName,
    )
  }

  @Post('instances/:id/stop')
  async stopInstance(
    @GetToken() user: { orgId?: string, id: string },
    @Param('id') instanceId: string,
  ) {
    return this.clawHostService.stopInstance(user.orgId || user.id, instanceId)
  }

  @Post('instances/:id/restart')
  async restartInstance(
    @GetToken() user: { orgId?: string, id: string },
    @Param('id') instanceId: string,
  ) {
    return this.clawHostService.restartInstance(user.orgId || user.id, instanceId)
  }

  @Get('instances/:id/health')
  async getInstanceHealth(
    @GetToken() user: { orgId?: string, id: string },
    @Param('id') instanceId: string,
  ) {
    return this.clawHostService.getInstanceHealth(user.orgId || user.id, instanceId)
  }

  @Get('instances/:id')
  async getInstance(
    @GetToken() user: { orgId?: string, id: string },
    @Param('id') instanceId: string,
  ) {
    return this.clawHostService.getInstance(user.orgId || user.id, instanceId)
  }

  @Get('instances/:id/status')
  async getInstanceStatus(
    @GetToken() user: { orgId?: string, id: string },
    @Param('id') instanceId: string,
  ) {
    return this.clawHostService.getInstanceHealth(user.orgId || user.id, instanceId)
  }

  @Post('instances/:id/skills')
  async installSkill(
    @GetToken() user: { orgId?: string, id: string },
    @Param('id') instanceId: string,
    @Body() body: InstallClawHostSkillDto,
  ) {
    return this.clawHostService.installSkill(
      user.orgId || user.id,
      instanceId,
      body.skillId,
      body.version,
    )
  }

  @Delete('instances/:id/skills/:skillId')
  async uninstallSkill(
    @GetToken() user: { orgId?: string, id: string },
    @Param('id') instanceId: string,
    @Param('skillId') skillId: string,
  ) {
    return this.clawHostService.uninstallSkill(user.orgId || user.id, instanceId, skillId)
  }

  @Put('skills/:skillId/upgrade')
  async batchUpgradeSkill(
    @GetToken() user: { orgId?: string, id: string },
    @Param('skillId') skillId: string,
    @Body() body: BatchUpgradeClawHostSkillDto,
  ) {
    return this.clawHostService.batchUpgradeSkill(user.orgId || user.id, skillId, body.version)
  }

  @Get('instances')
  async listInstances(
    @GetToken() user: { orgId?: string, id: string },
    @Query() query: ListClawHostInstancesQueryDto,
  ) {
    return this.clawHostService.listInstances(
      {
        orgId: user.orgId || user.id,
        status: query.status,
      },
      {
        page: query.page,
        limit: query.limit,
      },
    )
  }

  @Get('instances/:id/logs')
  async getInstanceLogs(
    @GetToken() user: { orgId?: string, id: string },
    @Param('id') instanceId: string,
    @Query() query: GetClawHostLogsQueryDto,
  ) {
    return this.clawHostService.getInstanceLogs(user.orgId || user.id, instanceId, query.lines)
  }
}
