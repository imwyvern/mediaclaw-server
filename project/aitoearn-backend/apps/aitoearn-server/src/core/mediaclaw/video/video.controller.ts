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
    return this.videoService.createTask(user.id, body)
  }

  @Get()
  async listTasks(
    @GetToken() user: any,
    @Query('status') status?: VideoTaskStatus,
    @Query('brandId') brandId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.videoService.listTasks(user.id, {
      status,
      brandId,
      page: page ? Number.parseInt(page) : 1,
      limit: limit ? Number.parseInt(limit) : 20,
    })
  }

  @Get(':id')
  async getTask(@Param('id') id: string) {
    return this.videoService.getTask(id)
  }

  @Patch(':id/copy')
  async editCopy(@Param('id') id: string, @Body() body: any) {
    return this.videoService.editCopy(id, body)
  }

  @Patch(':id/publish')
  async markPublished(@Param('id') id: string) {
    return this.videoService.markPublished(id)
  }
}
