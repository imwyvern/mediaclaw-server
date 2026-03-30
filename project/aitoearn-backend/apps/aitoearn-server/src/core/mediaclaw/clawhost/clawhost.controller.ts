import {
  Body,
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
@Roles(UserRole.ADMIN)
@MediaClawApiController('api/v1/clawhost')
export class ClawHostController {
  constructor(private readonly clawHostService: ClawHostService) {}

  @Post('instances')
  async createInstance(
    @GetToken() user: { orgId?: string, id: string },
    @Body() body: CreateClawHostInstanceDto,
  ) {
    return this.clawHostService.createInstance(
      body.orgId || user.orgId || user.id,
      body.config,
      body.clientName,
    )
  }

  @Post('instances/:id/stop')
  async stopInstance(@Param('id') instanceId: string) {
    return this.clawHostService.stopInstance(instanceId)
  }

  @Post('instances/:id/restart')
  async restartInstance(@Param('id') instanceId: string) {
    return this.clawHostService.restartInstance(instanceId)
  }

  @Get('instances/:id/health')
  async getInstanceHealth(@Param('id') instanceId: string) {
    return this.clawHostService.getInstanceHealth(instanceId)
  }

  @Post('instances/:id/skills')
  async installSkill(
    @Param('id') instanceId: string,
    @Body() body: InstallClawHostSkillDto,
  ) {
    return this.clawHostService.installSkill(instanceId, body.skillId, body.version)
  }

  @Put('skills/:skillId/upgrade')
  async batchUpgradeSkill(
    @Param('skillId') skillId: string,
    @Body() body: BatchUpgradeClawHostSkillDto,
  ) {
    return this.clawHostService.batchUpgradeSkill(skillId, body.version)
  }

  @Get('instances')
  async listInstances(@Query() query: ListClawHostInstancesQueryDto) {
    return this.clawHostService.listInstances(
      {
        orgId: query.orgId,
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
    @Param('id') instanceId: string,
    @Query() query: GetClawHostLogsQueryDto,
  ) {
    return this.clawHostService.getInstanceLogs(instanceId, query.lines)
  }
}
