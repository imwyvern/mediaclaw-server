import {
  Body,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { VideoTaskStatus, VideoTaskType } from '@yikart/mongodb'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { MediaClawAuthUser } from '../mediaclaw-auth.types'
import { TaskMgmtService } from './task-mgmt.service'

@MediaClawApiController('api/v1/tasks')
export class TaskMgmtController {
  constructor(private readonly taskMgmtService: TaskMgmtService) {}

  @Post()
  async createTask(
    @GetToken() user: MediaClawAuthUser,
    @Body() body: {
      orgId?: string
      brandId?: string
      pipelineId?: string
      taskType: VideoTaskType
      sourceVideoUrl?: string
      metadata?: Record<string, unknown>
    },
  ) {
    const orgId = user.orgId || user.id
    return this.taskMgmtService.createTask(orgId, {
      requestedBy: user.id,
      brandId: body.brandId,
      pipelineId: body.pipelineId,
      taskType: body.taskType,
      sourceVideoUrl: body.sourceVideoUrl,
      metadata: body.metadata,
    })
  }

  @Get('timeline/:id')
  async getTaskTimeline(@GetToken() user: MediaClawAuthUser, @Param('id') id: string) {
    return this.taskMgmtService.getTaskTimeline(user.orgId || user.id, id)
  }

  @Post('batch-download')
  async batchDownload(@GetToken() user: MediaClawAuthUser, @Body('taskIds') taskIds: string[]) {
    return this.taskMgmtService.batchDownload(user.orgId || user.id, taskIds)
  }

  @Get()
  async listTasks(
    @GetToken() user: MediaClawAuthUser,
    @Query('orgId') orgId?: string,
    @Query('status') status?: VideoTaskStatus,
    @Query('brandId') brandId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.taskMgmtService.listTasks(
      user.orgId || user.id,
      { status, brandId, startDate, endDate },
      {
        page: page ? Number.parseInt(page, 10) : 1,
        limit: limit ? Number.parseInt(limit, 10) : 20,
      },
    )
  }

  @Get(':id')
  async getTask(@GetToken() user: MediaClawAuthUser, @Param('id') id: string) {
    return this.taskMgmtService.getTask(user.orgId || user.id, id)
  }

  @Patch(':id')
  async updateTask(
    @GetToken() user: MediaClawAuthUser,
    @Param('id') id: string,
    @Body() body: {
      brandId?: string | null
      pipelineId?: string | null
      sourceVideoUrl?: string
      metadata?: Record<string, unknown>
    },
  ) {
    return this.taskMgmtService.updateTask(user.orgId || user.id, id, body)
  }

  @Delete(':id')
  async deleteTask(@GetToken() user: MediaClawAuthUser, @Param('id') id: string) {
    return this.taskMgmtService.deleteTask(user.orgId || user.id, id)
  }

  @Post(':id/cancel')
  async cancelTask(@GetToken() user: MediaClawAuthUser, @Param('id') id: string) {
    return this.taskMgmtService.cancelTask(user.orgId || user.id, id)
  }

  @Post(':id/retry')
  async retryTask(@GetToken() user: MediaClawAuthUser, @Param('id') id: string) {
    return this.taskMgmtService.retryTask(user.orgId || user.id, id)
  }
}
