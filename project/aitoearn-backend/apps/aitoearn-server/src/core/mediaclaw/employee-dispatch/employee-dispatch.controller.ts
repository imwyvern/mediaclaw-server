import { Body, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'

import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { EmployeeDispatchService } from './employee-dispatch.service'

@MediaClawApiController('api/v1/dispatch')
export class EmployeeDispatchController {
  constructor(private readonly employeeDispatchService: EmployeeDispatchService) {}

  @Post('assignments')
  async createAssignment(
    @GetToken() user: { orgId?: string, id?: string },
    @Body() body: Record<string, unknown>,
  ) {
    return this.employeeDispatchService.createAssignment(user.orgId || user.id || '', body)
  }

  @Get('assignments')
  async listAssignments(
    @GetToken() user: { orgId?: string, id?: string },
    @Query('status') status?: string,
    @Query('keyword') keyword?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.employeeDispatchService.listAssignments(
      user.orgId || user.id || '',
      { status, keyword },
      {
        page: page ? Number.parseInt(page, 10) : 1,
        limit: limit ? Number.parseInt(limit, 10) : 20,
      },
    )
  }

  @Patch('assignments/:id')
  async updateAssignment(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.employeeDispatchService.updateAssignment(id, body)
  }

  @Delete('assignments/:id')
  async removeAssignment(@Param('id') id: string) {
    return this.employeeDispatchService.removeAssignment(id)
  }

  @Post('assignments/:id/bind-im')
  async bindImAccount(
    @Param('id') id: string,
    @Body() body: { channel?: string } & Record<string, unknown>,
  ) {
    return this.employeeDispatchService.bindImAccount(id, body.channel || '', body)
  }

  @Post('deliver')
  async dispatchToEmployee(
    @Body() body: { videoTaskId: string, assignmentId: string },
  ) {
    return this.employeeDispatchService.dispatchToEmployee(body.videoTaskId, body.assignmentId)
  }

  @Post('batch')
  async batchDispatch(
    @Body() body: { videoTaskIds?: string[], rules?: Record<string, unknown> },
  ) {
    return this.employeeDispatchService.batchDispatch(body.videoTaskIds || [], body.rules || {})
  }

  @Post('deliveries/:id/confirm')
  async confirmDelivery(@Param('id') id: string) {
    return this.employeeDispatchService.confirmDelivery(id)
  }

  @Post('deliveries/:id/published')
  async markPublished(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.employeeDispatchService.markPublished(id, body)
  }

  @Get('stats')
  async getDispatchStats(
    @GetToken() user: { orgId?: string, id?: string },
    @Query('period') period?: string,
    @Query('startAt') startAt?: string,
    @Query('endAt') endAt?: string,
  ) {
    return this.employeeDispatchService.getDispatchStats(user.orgId || user.id || '', {
      period,
      startAt,
      endAt,
    })
  }
}
