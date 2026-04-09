import { Body, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator'

import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { PipelineMatchService } from './pipeline-match.service'

class CreatePipelineTemplateDto {
  @IsOptional()
  @IsString()
  templateId?: string

  @IsOptional()
  @IsString()
  name?: string

  @IsOptional()
  @IsString()
  description?: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categories?: string[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  styles?: string[]

  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @Type(() => Number)
  @IsNumber({}, { each: true })
  durationRange?: [number, number]

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  costPerVideo?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  qualityStars?: number

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  limitations?: string[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  verifiedClients?: string[]

  @IsOptional()
  @IsObject()
  defaultParams?: Record<string, unknown>

  @IsOptional()
  @IsString()
  status?: string

  @IsOptional()
  @IsString()
  type?: string

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isPublic?: boolean
}

class UpdatePipelineTemplateDto extends CreatePipelineTemplateDto {}

@MediaClawApiController('api/v1/pipelines/templates')
export class PipelineTemplateController {
  constructor(private readonly pipelineMatchService: PipelineMatchService) {}

  @Get()
  async listTemplates(
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('style') style?: string,
    @Query('type') type?: string,
    @Query('keyword') keyword?: string,
  ) {
    return this.pipelineMatchService.listTemplates({
      status,
      category,
      style,
      type,
      keyword,
    })
  }

  @Post()
  async createTemplate(
    @GetToken() user: { id?: string } | undefined,
    @Body() body: CreatePipelineTemplateDto,
  ) {
    return this.pipelineMatchService.createTemplate({
      ...body,
      createdBy: user?.id || 'system',
    })
  }

  @Patch(':id')
  async updateTemplate(
    @Param('id') id: string,
    @Body() body: UpdatePipelineTemplateDto,
  ) {
    return this.pipelineMatchService.updateTemplate(id, body)
  }
}
