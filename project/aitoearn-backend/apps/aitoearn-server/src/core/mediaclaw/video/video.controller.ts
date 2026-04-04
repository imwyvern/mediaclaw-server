import { Body, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { VideoTaskStatus, VideoTaskType } from '@yikart/mongodb'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { MediaClawAuthUser } from '../mediaclaw-auth.types'
import { VideoService } from './video.service'

interface VideoTaskInputSource {
  type?: string
  url?: string
  videoId?: string
}

interface VideoCopyUpdateInput {
  title?: string
  subtitle?: string
  description?: string
  hashtags?: string[]
  commentGuide?: string
}

@MediaClawApiController(['api/v1/video', 'api/v1/videos'])
export class VideoController {
  constructor(private readonly videoService: VideoService) {}

  @Post()
  async createTask(@GetToken() user: MediaClawAuthUser, @Body() body: {
    brandId?: string
    pipelineId?: string
    taskType: VideoTaskType
    sourceVideoUrl: string
    source?: VideoTaskInputSource
    metadata?: Record<string, unknown>
  }) {
    return this.videoService.createTask(user.orgId || user.id, user.id, body)
  }

  @Post('batches')
  async createBatch(@GetToken() user: MediaClawAuthUser, @Body() body: {
    brandId?: string
    batchName: string
    tasks: Array<{
      brandId?: string
      pipelineId?: string
      taskType: VideoTaskType
      sourceVideoUrl: string
      source?: VideoTaskInputSource
      metadata?: Record<string, unknown>
    }>
  }) {
    return this.videoService.createBatch(user.orgId || user.id, user.id, body)
  }

  @Get('batches/:id')
  async getBatchStatus(@GetToken() user: MediaClawAuthUser, @Param('id') id: string) {
    return this.videoService.getBatchStatus(user.orgId || user.id, id)
  }

  @Get()
  async listTasks(
    @GetToken() user: MediaClawAuthUser,
    @Query('status') status?: VideoTaskStatus,
    @Query('brandId') brandId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.videoService.listTasks(user.orgId || user.id, user.id, {
      status,
      brandId,
      page: page ? Number.parseInt(page, 10) : 1,
      limit: limit ? Number.parseInt(limit, 10) : 20,
    })
  }

  @Get(':id/iterations')
  async getIterations(@GetToken() user: MediaClawAuthUser, @Param('id') id: string) {
    return this.videoService.getIterations(user.orgId || user.id, id)
  }

  @Get(':id')
  async getTask(@GetToken() user: MediaClawAuthUser, @Param('id') id: string) {
    return this.videoService.getTask(user.orgId || user.id, id)
  }

  @Patch(':id/copy')
  async editCopy(
    @GetToken() user: MediaClawAuthUser,
    @Param('id') id: string,
    @Body() body: VideoCopyUpdateInput,
  ) {
    return this.videoService.editCopy(user.orgId || user.id, id, body)
  }

  @Patch(':id/publish')
  async markPublished(@GetToken() user: MediaClawAuthUser, @Param('id') id: string) {
    return this.videoService.markPublished(user.orgId || user.id, id)
  }
}
