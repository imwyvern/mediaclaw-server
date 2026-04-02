import { Body, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { VideoTaskStatus, VideoTaskType } from '@yikart/mongodb'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { VideoService } from './video.service'

@MediaClawApiController(['api/v1/video', 'api/v1/videos'])
export class VideoController {
  constructor(private readonly videoService: VideoService) {}

  @Post()
  async createTask(@GetToken() user: any, @Body() body: {
    brandId?: string
    pipelineId?: string
    taskType: VideoTaskType
    sourceVideoUrl: string
    source?: {
      type?: string
      url?: string
      videoId?: string
    }
    metadata?: Record<string, any>
  }) {
    return this.videoService.createTask(user.orgId || user.id, user.id, body)
  }

  @Post('batches')
  async createBatch(@GetToken() user: any, @Body() body: {
    brandId?: string
    batchName: string
    tasks: Array<{
      brandId?: string
      pipelineId?: string
      taskType: VideoTaskType
      sourceVideoUrl: string
      source?: {
        type?: string
        url?: string
        videoId?: string
      }
      metadata?: Record<string, any>
    }>
  }) {
    return this.videoService.createBatch(user.orgId || user.id, user.id, body)
  }

  @Get('batches/:id')
  async getBatchStatus(@GetToken() user: any, @Param('id') id: string) {
    return this.videoService.getBatchStatus(user.orgId || user.id, id)
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
      page: page ? Number.parseInt(page, 10) : 1,
      limit: limit ? Number.parseInt(limit, 10) : 20,
    })
  }

  @Get(':id/iterations')
  async getIterations(@GetToken() user: any, @Param('id') id: string) {
    return this.videoService.getIterations(user.orgId || user.id, id)
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
