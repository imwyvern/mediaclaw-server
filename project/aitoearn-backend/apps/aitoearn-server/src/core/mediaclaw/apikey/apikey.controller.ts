import { Body, Delete, Get, Param, Post } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { OrgApiKeyProvider } from '@yikart/mongodb'
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { MediaClawAuthUser } from '../mediaclaw-auth.types'
import { MediaClawApiKeyService } from './apikey.service'

class CreateApiKeyDto {
  @IsString()
  @MaxLength(128)
  name: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  permissions?: string[]

  @IsOptional()
  @IsString()
  @MaxLength(64)
  expiresAt?: string | null
}

class ValidateApiKeyDto {
  @IsOptional()
  @IsString()
  @MaxLength(512)
  key?: string

  @IsOptional()
  @IsString()
  @MaxLength(64)
  prefix?: string
}

class UpsertByokDto {
  @IsEnum(OrgApiKeyProvider)
  provider: OrgApiKeyProvider

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  key?: string

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  apiKey?: string

  @IsOptional()
  @IsBoolean()
  validateNow?: boolean
}

class RotateByokDto {
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  key?: string

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  apiKey?: string

  @IsOptional()
  @IsBoolean()
  validateNow?: boolean
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

  @Post('byok')
  async createByok(
    @GetToken() user: MediaClawAuthUser,
    @Body() body: UpsertByokDto,
  ) {
    return this.apiKeyService.createByok(user.orgId || user.id, body)
  }

  @Get('byok')
  async listByok(@GetToken() user: MediaClawAuthUser) {
    return this.apiKeyService.listByok(user.orgId || user.id)
  }

  @Post('byok/validate')
  async validateIncomingByok(@Body() body: UpsertByokDto) {
    return this.apiKeyService.validateIncomingByok(body)
  }

  @Post('byok/:provider/validate')
  async validateStoredByok(
    @GetToken() user: MediaClawAuthUser,
    @Param('provider') provider: OrgApiKeyProvider,
  ) {
    return this.apiKeyService.validateStoredByok(user.orgId || user.id, provider)
  }

  @Post('byok/:provider/rotate')
  async rotateByok(
    @GetToken() user: MediaClawAuthUser,
    @Param('provider') provider: OrgApiKeyProvider,
    @Body() body: RotateByokDto,
  ) {
    return this.apiKeyService.rotateByok(user.orgId || user.id, provider, body)
  }

  @Delete('byok/:provider')
  async deleteByok(
    @GetToken() user: MediaClawAuthUser,
    @Param('provider') provider: OrgApiKeyProvider,
  ) {
    return this.apiKeyService.deleteByok(user.orgId || user.id, provider)
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
