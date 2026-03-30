import { Body, Delete, Get, Param, Patch, Post } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { NotificationChannel, NotificationEvent } from '@yikart/mongodb'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { NotificationService } from './notification.service'

@MediaClawApiController('api/v1/notifications')
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

  @Get()
  async list(@GetToken() user: any) {
    return this.notificationService.listConfigs(user.orgId || user.id)
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.notificationService.getConfig(id)
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: {
      channel?: NotificationChannel
      events?: NotificationEvent[]
      config?: Record<string, any>
      isActive?: boolean
    },
  ) {
    return this.notificationService.updateConfig(id, body)
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.notificationService.deleteConfig(id)
  }

  @Post(':id/test')
  async test(@Param('id') id: string) {
    return this.notificationService.testConfig(id)
  }
}
