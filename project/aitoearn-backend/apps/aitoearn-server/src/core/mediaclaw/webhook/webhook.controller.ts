import { Body, Delete, Get, Param, Patch, Post } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { MediaClawAuthUser } from '../mediaclaw-auth.types'
import { WebhookService } from './webhook.service'

interface WebhookUpdateBody {
  name?: string
  url?: string
  secret?: string
  events?: string[]
  isActive?: boolean
}

@MediaClawApiController('api/v1/webhook')
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  @Post()
  async create(
    @GetToken() user: MediaClawAuthUser,
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
  async list(@GetToken() user: MediaClawAuthUser) {
    return this.webhookService.listByOrg(user.orgId || user.id)
  }

  @Get(':id')
  async findOne(@GetToken() user: MediaClawAuthUser, @Param('id') id: string) {
    return this.webhookService.getById(user.orgId || user.id, id)
  }

  @Patch(':id')
  async update(
    @GetToken() user: MediaClawAuthUser,
    @Param('id') id: string,
    @Body() body: WebhookUpdateBody,
  ) {
    return this.webhookService.update(user.orgId || user.id, id, body)
  }

  @Delete(':id')
  async remove(@GetToken() user: MediaClawAuthUser, @Param('id') id: string) {
    return this.webhookService.delete(user.orgId || user.id, id)
  }
}
