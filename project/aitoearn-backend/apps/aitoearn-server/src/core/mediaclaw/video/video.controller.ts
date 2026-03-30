import { Body, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { VideoTaskStatus, VideoTaskType } from '@yikart/mongodb'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { VideoService } from './video.service'

@MediaClawApiController('api/v1/content')
export class VideoController {
  constructor(private readonly videoService: VideoService) {}

  @Post()
  async createTask(@GetToken() user: any, @Body() body: {
    brandId?: string
    pipelineId?: string
    taskType: VideoTaskType
    sourceVideoUrl: string
    metadata?: Record<string, any>
  }) {
    return this.videoService.createTask(user.orgId || user.id, user.id, body)
  }

  @Get()
  async listTasks(
    @GetToken() user: any,
    @Query('status') status?: VideoTaskStatus,
    @Query('brandId') brandId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.videoService.listTasks(user.orgId || user.id, user.id, {
      status,
      brandId,
      page: page ? Number.parseInt(page) : 1,
      limit: limit ? Number.parseInt(limit) : 20,
    })
  }

  @Get(':id')
  async getTask(@GetToken() user: any, @Param('id') id: string) {
    return this.videoService.getTask(user.orgId || user.id, id)
  }

  @Patch(':id/copy')
  async editCopy(@GetToken() user: any, @Param('id') id: string, @Body() body: any) {
    return this.videoService.editCopy(user.orgId || user.id, id, body)
  }

  @Patch(':id/publish')
  async markPublished(@GetToken() user: any, @Param('id') id: string) {
    return this.videoService.markPublished(user.orgId || user.id, id)
  }
}
