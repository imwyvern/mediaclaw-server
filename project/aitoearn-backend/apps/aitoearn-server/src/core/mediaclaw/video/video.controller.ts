import { Body, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { VideoTaskStatus, VideoTaskType } from '@yikart/mongodb'
import { Type } from 'class-transformer'
import {
  IsArray,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { MediaClawAuthUser } from '../mediaclaw-auth.types'
import { VideoService } from './video.service'

class VideoTaskInputSourceValidatedDto {
  @IsOptional()
  @IsString()
  type?: string

  @IsOptional()
  @IsString()
  url?: string

  @IsOptional()
  @IsString()
  videoId?: string
}

class CreateVideoTaskDto {
  @IsOptional()
  @IsString()
  brandId?: string

  @IsOptional()
  @IsString()
  pipelineId?: string

  @IsEnum(VideoTaskType)
  taskType: VideoTaskType

  @IsString()
  sourceVideoUrl: string

  @IsOptional()
  @ValidateNested()
  @Type(() => VideoTaskInputSourceValidatedDto)
  source?: VideoTaskInputSourceValidatedDto

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>
}

class CreateVideoBatchTaskDto extends CreateVideoTaskDto {}

class CreateVideoBatchDto {
  @IsOptional()
  @IsString()
  brandId?: string

  @IsString()
  batchName: string

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateVideoBatchTaskDto)
  tasks: CreateVideoBatchTaskDto[]
}

class VideoCopyUpdateDto {
  @IsOptional()
  @IsString()
  title?: string

  @IsOptional()
  @IsString()
  subtitle?: string

  @IsOptional()
  @IsString()
  description?: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  hashtags?: string[]

  @IsOptional()
  @IsString()
  commentGuide?: string
}

@MediaClawApiController('api/v1/videos')
export class VideoController {
  constructor(private readonly videoService: VideoService) {}

  @Post()
  async createTask(@GetToken() user: MediaClawAuthUser, @Body() body: CreateVideoTaskDto) {
    return this.videoService.createTask(user.orgId || user.id, user.id, body)
  }

  @Post('batch')
  async createBatch(@GetToken() user: MediaClawAuthUser, @Body() body: CreateVideoBatchDto) {
    return this.videoService.createBatch(user.orgId || user.id, user.id, body)
  }

  @Get('batch/:id')
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
    @Body() body: VideoCopyUpdateDto,
  ) {
    return this.videoService.editCopy(user.orgId || user.id, id, body)
  }

  @Patch(':id/publish')
  async markPublished(@GetToken() user: MediaClawAuthUser, @Param('id') id: string) {
    return this.videoService.markPublished(user.orgId || user.id, id)
  }
}
