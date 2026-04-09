import { Body, Delete, Get, Param, Patch, Post } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { Type } from 'class-transformer'
import {
  IsArray,
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { MediaClawAuthUser } from '../mediaclaw-auth.types'
import { WebhookService } from './webhook.service'

class CreateWebhookDto {
  @IsOptional()
  @IsString()
  name?: string

  @IsString()
  url: string

  @IsOptional()
  @IsString()
  secret?: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  events?: string[]

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean
}

class UpdateWebhookDto {
  @IsOptional()
  @IsString()
  name?: string

  @IsOptional()
  @IsString()
  url?: string

  @IsOptional()
  @IsString()
  secret?: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  events?: string[]

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean
}

class TestWebhookDto {
  @IsString()
  event: string

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>
}

@MediaClawApiController('api/v1/webhook')
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  @Post()
  async create(
    @GetToken() user: MediaClawAuthUser,
    @Body() body: CreateWebhookDto,
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
    @Body() body: UpdateWebhookDto,
  ) {
    return this.webhookService.update(user.orgId || user.id, id, body)
  }

  @Delete(':id')
  async remove(@GetToken() user: MediaClawAuthUser, @Param('id') id: string) {
    return this.webhookService.delete(user.orgId || user.id, id)
  }

  @Post(':id/test')
  async test(
    @GetToken() user: MediaClawAuthUser,
    @Param('id') id: string,
    @Body() body: TestWebhookDto,
  ) {
    return this.webhookService.testDelivery(
      user.orgId || user.id,
      id,
      body.event,
      body.payload || {},
    )
  }
}
