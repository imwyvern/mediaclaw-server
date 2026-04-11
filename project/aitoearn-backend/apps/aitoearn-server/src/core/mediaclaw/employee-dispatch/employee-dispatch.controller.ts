import { Body, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'

import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { MediaClawAuthUser } from '../mediaclaw-auth.types'
import {
  AppendSessionMessageDto,
  AssignmentQueryDto,
  BatchDispatchDto,
  BindImAccountDto,
  CreateEmployeeAssignmentDto,
  CreateSessionDto,
  DeliveryPublishDto,
  DispatchStatsQueryDto,
  DispatchToEmployeeDto,
  PendingDeliveriesQueryDto,
  StartSessionApprovalDto,
  SubmitSessionVoteDto,
  UpdateEmployeeAssignmentDto,
  UpsertSessionParticipantsDto,
} from './employee-dispatch.dto'
import { EmployeeDispatchService } from './employee-dispatch.service'
import { ImSessionService } from './im-session.service'

@MediaClawApiController('api/v1/dispatch')
export class EmployeeDispatchController {
  constructor(
    private readonly employeeDispatchService: EmployeeDispatchService,
    private readonly imSessionService: ImSessionService,
  ) {}

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

  @Post('sessions')
  async createSession(
    @GetToken() user: MediaClawAuthUser,
    @Body() body: CreateSessionDto,
  ) {
    return this.employeeDispatchService.createDispatchSession(
      user.orgId || user.id || '',
      body.deliveryRecordId,
      {
        conversationId: body.conversationId,
        participants: body.participants,
      },
    )
  }

  @Get('sessions/:id')
  async getSession(
    @GetToken() user: MediaClawAuthUser,
    @Param('id') id: string,
  ) {
    return this.imSessionService.getSession(user.orgId || user.id || '', id)
  }

  @Patch('sessions/:id/participants')
  async upsertSessionParticipants(
    @GetToken() user: MediaClawAuthUser,
    @Param('id') id: string,
    @Body() body: UpsertSessionParticipantsDto,
  ) {
    return this.imSessionService.upsertParticipants(
      user.orgId || user.id || '',
      id,
      body.participants,
    )
  }

  @Post('sessions/:id/messages')
  async appendSessionMessage(
    @GetToken() user: MediaClawAuthUser,
    @Param('id') id: string,
    @Body() body: AppendSessionMessageDto,
  ) {
    return this.employeeDispatchService.appendSessionMessage(
      user.orgId || user.id || '',
      id,
      body.memberId,
      body.content,
      body.role,
    )
  }

  @Post('sessions/:id/approval')
  async startSessionApproval(
    @GetToken() user: MediaClawAuthUser,
    @Param('id') id: string,
    @Body() body: StartSessionApprovalDto,
  ) {
    return this.employeeDispatchService.startSessionApproval(
      user.orgId || user.id || '',
      id,
      body.memberId,
      body.requiredVotes,
      body.hoursToExpire,
    )
  }

  @Post('sessions/:id/votes')
  async submitSessionVote(
    @GetToken() user: MediaClawAuthUser,
    @Param('id') id: string,
    @Body() body: SubmitSessionVoteDto,
  ) {
    return this.employeeDispatchService.submitSessionVote(
      user.orgId || user.id || '',
      id,
      body.memberId,
      body.decision,
      body.reason,
    )
  }

  @Post('sessions/:id/published')
  async confirmSessionPublished(
    @GetToken() user: MediaClawAuthUser,
    @Param('id') id: string,
    @Body() body: DeliveryPublishDto,
  ) {
    return this.employeeDispatchService.confirmSessionPublished(
      user.orgId || user.id || '',
      id,
      body,
    )
  }
}
