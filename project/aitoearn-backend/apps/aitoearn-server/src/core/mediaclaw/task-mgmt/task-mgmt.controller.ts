import {
  Body,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { VideoTaskStatus, VideoTaskType } from '@yikart/mongodb'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { TaskMgmtService } from './task-mgmt.service'

@MediaClawApiController('api/v1/tasks')
export class TaskMgmtController {
  constructor(private readonly taskMgmtService: TaskMgmtService) {}

  @Post()
  async createTask(
    @GetToken() user: any,
    @Body() body: {
      orgId?: string
      brandId?: string
      pipelineId?: string
      taskType: VideoTaskType
      sourceVideoUrl?: string
      metadata?: Record<string, any>
    },
  ) {
    const orgId = body.orgId || user.orgId
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
  async getTaskTimeline(@Param('id') id: string) {
    return this.taskMgmtService.getTaskTimeline(id)
  }

  @Post('batch-download')
  async batchDownload(@Body('taskIds') taskIds: string[]) {
    return this.taskMgmtService.batchDownload(taskIds)
  }

  @Get()
  async listTasks(
    @GetToken() user: any,
    @Query('orgId') orgId?: string,
    @Query('status') status?: VideoTaskStatus,
    @Query('brandId') brandId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.taskMgmtService.listTasks(
      orgId || user.orgId,
      { status, brandId, startDate, endDate },
      {
        page: page ? Number.parseInt(page, 10) : 1,
        limit: limit ? Number.parseInt(limit, 10) : 20,
      },
    )
  }

  @Get(':id')
  async getTask(@Param('id') id: string) {
    return this.taskMgmtService.getTask(id)
  }

  @Post(':id/cancel')
  async cancelTask(@Param('id') id: string) {
    return this.taskMgmtService.cancelTask(id)
  }

  @Post(':id/retry')
  async retryTask(@Param('id') id: string) {
    return this.taskMgmtService.retryTask(id)
  }
}
