import { Body, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'

import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { MediaClawAuthUser } from '../mediaclaw-auth.types'
import {
  AssignmentQueryDto,
  BatchDispatchDto,
  BindImAccountDto,
  CreateEmployeeAssignmentDto,
  DeliveryPublishDto,
  DispatchStatsQueryDto,
  DispatchToEmployeeDto,
  PendingDeliveriesQueryDto,
  UpdateEmployeeAssignmentDto,
} from './employee-dispatch.dto'
import { EmployeeDispatchService } from './employee-dispatch.service'

@MediaClawApiController('api/v1/dispatch')
export class EmployeeDispatchController {
  constructor(private readonly employeeDispatchService: EmployeeDispatchService) {}

  @Post('assignments')
  async createAssignment(
    @GetToken() user: MediaClawAuthUser,
    @Body() body: CreateEmployeeAssignmentDto,
  ) {
    return this.employeeDispatchService.createAssignment(
      user.orgId || user.id || '',
      body as unknown as Record<string, unknown>,
    )
  }

  @Get('assignments')
  async listAssignments(
    @GetToken() user: MediaClawAuthUser,
    @Query() query: AssignmentQueryDto,
  ) {
    return this.employeeDispatchService.listAssignments(
      user.orgId || user.id || '',
      { status: query.status, keyword: query.keyword },
      {
        page: query.page,
        limit: query.limit,
      },
    )
  }

  @Patch('assignments/:id')
  async updateAssignment(
    @GetToken() user: MediaClawAuthUser,
    @Param('id') id: string,
    @Body() body: UpdateEmployeeAssignmentDto,
  ) {
    return this.employeeDispatchService.updateAssignment(
      user.orgId || user.id || '',
      id,
      body as unknown as Record<string, unknown>,
    )
  }

  @Delete('assignments/:id')
  async removeAssignment(@GetToken() user: MediaClawAuthUser, @Param('id') id: string) {
    return this.employeeDispatchService.removeAssignment(user.orgId || user.id || '', id)
  }

  @Post('assignments/:id/bind-im')
  async bindImAccount(
    @GetToken() user: MediaClawAuthUser,
    @Param('id') id: string,
    @Body() body: BindImAccountDto,
  ) {
    return this.employeeDispatchService.bindImAccount(
      user.orgId || user.id || '',
      id,
      body.channel,
      body as unknown as Record<string, unknown>,
    )
  }

  @Post('deliver')
  async dispatchToEmployee(
    @GetToken() user: MediaClawAuthUser,
    @Body() body: DispatchToEmployeeDto,
  ) {
    return this.employeeDispatchService.dispatchToEmployee(user.orgId || user.id || '', body.videoTaskId, body.assignmentId)
  }

  @Post('batch')
  async batchDispatch(
    @GetToken() user: MediaClawAuthUser,
    @Body() body: BatchDispatchDto,
  ) {
    return this.employeeDispatchService.batchDispatch(user.orgId || user.id || '', body.videoTaskIds || [], body.rules || {})
  }

  @Post('deliveries/:id/confirm')
  async confirmDelivery(@GetToken() user: MediaClawAuthUser, @Param('id') id: string) {
    return this.employeeDispatchService.confirmDelivery(user.orgId || user.id || '', id)
  }

  @Post('deliveries/:id/published')
  async markPublished(
    @GetToken() user: MediaClawAuthUser,
    @Param('id') id: string,
    @Body() body: DeliveryPublishDto,
  ) {
    return this.employeeDispatchService.markPublished(user.orgId || user.id || '', id, body)
  }

  @Get('deliveries/pending')
  async listPendingDeliveries(
    @GetToken() user: MediaClawAuthUser,
    @Query() query: PendingDeliveriesQueryDto,
  ) {
    return this.employeeDispatchService.listPendingDeliveries(
      user.orgId || user.id || '',
      query as unknown as Record<string, unknown>,
      { page: query.page, limit: query.limit },
    )
  }

  @Get('stats')
  async getDispatchStats(
    @GetToken() user: MediaClawAuthUser,
    @Query() query: DispatchStatsQueryDto,
  ) {
    return this.employeeDispatchService.getDispatchStats(user.orgId || user.id || '', {
      period: query.period,
      startAt: query.startAt,
      endAt: query.endAt,
    })
  }
}
