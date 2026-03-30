import { Body, Delete, Get, Param, Post } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { MediaClawApiKeyService } from './apikey.service'

@MediaClawApiController('api/v1/apikey')
export class MediaClawApiKeyController {
  constructor(private readonly apiKeyService: MediaClawApiKeyService) {}

  @Post()
  async create(
    @GetToken() user: any,
    @Body() body: {
      name: string
      permissions?: string[]
      expiresAt?: string | null
    },
  ) {
    return this.apiKeyService.create(user.id, {
      name: body.name,
      orgId: user.orgId || null,
      permissions: body.permissions || [],
      expiresAt: body.expiresAt || null,
    })
  }

  @Get()
  async list(@GetToken() user: any) {
    return this.apiKeyService.list(user.id)
  }

  @Delete(':id')
  async revoke(@GetToken() user: any, @Param('id') id: string) {
    return this.apiKeyService.revoke(id, user.id)
  }
}
