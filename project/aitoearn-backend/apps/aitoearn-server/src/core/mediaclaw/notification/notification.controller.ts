import { Body, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { NotificationChannel, NotificationEvent } from '@yikart/mongodb'
import { Type } from 'class-transformer'
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { MediaClawAuthUser } from '../mediaclaw-auth.types'
import { NotificationService } from './notification.service'

class NotificationConfigDto {
  @IsEnum(NotificationChannel)
  channel: NotificationChannel

  @IsOptional()
  @IsString()
  name?: string

  @IsOptional()
  @IsArray()
  @IsEnum(NotificationEvent, { each: true })
  events?: NotificationEvent[]

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean
}

class UpdateNotificationConfigDto {
  @IsOptional()
  @IsEnum(NotificationChannel)
  channel?: NotificationChannel

  @IsOptional()
  @IsString()
  name?: string

  @IsOptional()
  @IsArray()
  @IsEnum(NotificationEvent, { each: true })
  events?: NotificationEvent[]

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean
}

@MediaClawApiController('api/v1/notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Post()
  async create(
    @GetToken() user: MediaClawAuthUser,
    @Body() body: NotificationConfigDto,
  ) {
    return this.notificationService.createConfig(user.orgId || user.id, body)
  }

  @Get('list')
  async listNotifications(
    @GetToken() user: MediaClawAuthUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.notificationService.listNotifications(
      user.orgId || user.id,
      page ? Number.parseInt(page, 10) : 1,
      limit ? Number.parseInt(limit, 10) : 20,
    )
  }

  @Get()
  async list(@GetToken() user: MediaClawAuthUser) {
    return this.notificationService.listConfigs(user.orgId || user.id)
  }

  @Get(':id')
  async findOne(@GetToken() user: MediaClawAuthUser, @Param('id') id: string) {
    return this.notificationService.getConfig(user.orgId || user.id, id)
  }

  @Patch(':id')
  async update(
    @GetToken() user: MediaClawAuthUser,
    @Param('id') id: string,
    @Body() body: UpdateNotificationConfigDto,
  ) {
    return this.notificationService.updateConfig(user.orgId || user.id, id, body)
  }

  @Delete(':id')
  async remove(@GetToken() user: MediaClawAuthUser, @Param('id') id: string) {
    return this.notificationService.deleteConfig(user.orgId || user.id, id)
  }

  @Post(':id/test')
  async test(@GetToken() user: MediaClawAuthUser, @Param('id') id: string) {
    return this.notificationService.testConfig(user.orgId || user.id, id)
  }
}
