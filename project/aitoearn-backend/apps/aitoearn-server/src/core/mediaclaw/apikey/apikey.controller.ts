import { Body, Delete, Get, Param, Post } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import {
  IsArray,
  IsOptional,
  IsString,
} from 'class-validator'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { MediaClawAuthUser } from '../mediaclaw-auth.types'
import { MediaClawApiKeyService } from './apikey.service'

class CreateApiKeyDto {
  @IsString()
  name: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissions?: string[]

  @IsOptional()
  @IsString()
  expiresAt?: string | null
}

class ValidateApiKeyDto {
  @IsOptional()
  @IsString()
  key?: string

  @IsOptional()
  @IsString()
  prefix?: string
}

@MediaClawApiController('api/v1/apikey')
export class MediaClawApiKeyController {
  constructor(private readonly apiKeyService: MediaClawApiKeyService) {}

  @Post()
  async create(
    @GetToken() user: MediaClawAuthUser,
    @Body() body: CreateApiKeyDto,
  ) {
    return this.apiKeyService.create(user.id, {
      name: body.name,
      orgId: user.orgId || null,
      permissions: body.permissions || [],
      expiresAt: body.expiresAt || null,
      role: user.role || null,
    })
  }

  @Get()
  async list(@GetToken() user: MediaClawAuthUser) {
    return this.apiKeyService.list(user.id)
  }

  @Post('validate')
  async validateKey(
    @GetToken() user: MediaClawAuthUser,
    @Body() body: ValidateApiKeyDto,
  ) {
    return this.apiKeyService.validateOwnedKey(user.id, body)
  }

  @Delete(':id')
  async revoke(@GetToken() user: MediaClawAuthUser, @Param('id') id: string) {
    return this.apiKeyService.revoke(id, user.id)
  }
}
