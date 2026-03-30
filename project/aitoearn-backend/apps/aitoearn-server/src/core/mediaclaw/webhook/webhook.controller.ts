import { Body, Delete, Get, Param, Patch, Post } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { WebhookService } from './webhook.service'

@MediaClawApiController('api/v1/webhook')
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  @Post()
  async create(
    @GetToken() user: any,
    @Body() body: {
      name?: string
      url: string
      secret?: string
      events?: string[]
      isActive?: boolean
    },
  ) {
    return this.webhookService.register(
      user.orgId || user.id,
      body.url,
      body.events || [],
      {
        name: body.name,
        secret: body.secret,
        isActive: body.isActive,
      },
    )
  }

  @Get()
  async list(@GetToken() user: any) {
    return this.webhookService.listByOrg(user.orgId || user.id)
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.webhookService.getById(id)
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: any) {
    return this.webhookService.update(id, body)
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.webhookService.delete(id)
  }
}
