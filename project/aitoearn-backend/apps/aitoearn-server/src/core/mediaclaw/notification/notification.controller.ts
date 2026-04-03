import { Body, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { NotificationChannel, NotificationEvent } from '@yikart/mongodb'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { NotificationService } from './notification.service'

@MediaClawApiController(['api/v1/notifications', 'api/v1/notification'])
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Post()
  async create(
    @GetToken() user: any,
    @Body() body: {
      channel: NotificationChannel
      events?: NotificationEvent[]
      config?: Record<string, any>
      isActive?: boolean
    },
  ) {
    return this.notificationService.createConfig(user.orgId || user.id, body)
  }

  @Get('list')
  async listNotifications(
    @GetToken() user: any,
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
  async list(@GetToken() user: any) {
    return this.notificationService.listConfigs(user.orgId || user.id)
  }

  @Get(':id')
  async findOne(@GetToken() user: any, @Param('id') id: string) {
    return this.notificationService.getConfig(user.orgId || user.id, id)
  }

  @Patch(':id')
  async update(
    @GetToken() user: any,
    @Param('id') id: string,
    @Body() body: {
      channel?: NotificationChannel
      events?: NotificationEvent[]
      config?: Record<string, any>
      isActive?: boolean
    },
  ) {
    return this.notificationService.updateConfig(user.orgId || user.id, id, body)
  }

  @Delete(':id')
  async remove(@GetToken() user: any, @Param('id') id: string) {
    return this.notificationService.deleteConfig(user.orgId || user.id, id)
  }

  @Post(':id/test')
  async test(@GetToken() user: any, @Param('id') id: string) {
    return this.notificationService.testConfig(user.orgId || user.id, id)
  }
}
