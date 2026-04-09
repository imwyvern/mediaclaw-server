import { Body, Get, Param, Patch, Post, Put, Query, Res } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { VideoTaskStatus } from '@yikart/mongodb'
import { Type } from 'class-transformer'
import {
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator'
import { Response } from 'express'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { ContentMgmtService } from './content-mgmt.service'

class SetStylePreferencesDto {
  @IsOptional()
  @IsString()
  orgId?: string

  @IsObject()
  preferences: Record<string, unknown>
}

class CopyUpdateDto {
  @IsOptional()
  @IsString()
  title?: string

  @IsOptional()
  @IsString()
  subtitle?: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  hashtags?: string[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  blueWords?: string[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  commentGuides?: string[]
}

class BatchEditCopyDto {
  @IsArray()
  @IsString({ each: true })
  contentIds: string[]

  @ValidateNested()
  @Type(() => CopyUpdateDto)
  updates: CopyUpdateDto
}

class ContentExportFiltersDto {
  @IsOptional()
  @IsString()
  status?: VideoTaskStatus

  @IsOptional()
  @IsString()
  publishStatus?: string

  @IsOptional()
  @IsString()
  brandId?: string

  @IsOptional()
  @IsString()
  startDate?: string

  @IsOptional()
  @IsString()
  endDate?: string
}

class ExportContentDto {
  @IsOptional()
  @IsString()
  orgId?: string

  @IsString()
  format: string

  @IsOptional()
  @ValidateNested()
  @Type(() => ContentExportFiltersDto)
  filters?: ContentExportFiltersDto
}

class ApproveContentDto {
  @IsOptional()
  @IsString()
  comment?: string
}

class ReviewContentDto {
  @IsIn(['approve', 'reject', 'changes_requested'])
  action: 'approve' | 'reject' | 'changes_requested'

  @IsOptional()
  @IsString()
  comment?: string
}

class PublishContentDto {
  @IsString()
  platform: string

  @IsString()
  publishUrl: string
}

@MediaClawApiController('api/v1/content')
export class ContentMgmtController {
  constructor(private readonly contentMgmtService: ContentMgmtService) {}

  @Put('style-preferences')
  async setStylePreferences(
    @GetToken() user: { orgId?: string, id?: string },
    @Body() body: SetStylePreferencesDto,
  ) {
    return this.contentMgmtService.setStylePreferences(
      user.orgId || user.id || '',
      body.preferences,
    )
  }

  @Get('style-preferences')
  async getStylePreferences(@GetToken() user: { orgId?: string, id?: string }) {
    return this.contentMgmtService.getStylePreferences(user.orgId || user.id || '')
  }

  @Get()
  async listContent(
    @GetToken() user: { orgId?: string, id?: string },
    @Query('status') status?: VideoTaskStatus,
    @Query('publishStatus') publishStatus?: string,
    @Query('brandId') brandId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.contentMgmtService.listContent(
      user.orgId || user.id || '',
      { status, publishStatus, brandId, startDate, endDate },
      {
        page: page ? Number.parseInt(page, 10) : 1,
        limit: limit ? Number.parseInt(limit, 10) : 20,
      },
    )
  }

  @Get('pending')
  async listPendingContent(@GetToken() user: { orgId?: string, id?: string }) {
    return this.contentMgmtService.listPendingContent(
      user.orgId || user.id || '',
      user.id || '',
    )
  }

  @Post('batch-edit')
  async batchEditCopy(
    @GetToken() user: { orgId?: string, id?: string },
    @Body() body: BatchEditCopyDto,
  ) {
    return this.contentMgmtService.batchEditCopy(user.orgId || user.id || '', body.contentIds, body.updates)
  }

  @Post('export')
  async exportContent(
    @GetToken() user: { orgId?: string, id?: string },
    @Body() body: ExportContentDto,
  ) {
    return this.contentMgmtService.exportContent(
      user.orgId || user.id || '',
      body.format,
      body.filters || {},
    )
  }

  @Get(':id/download')
  async downloadContent(
    @GetToken() user: { orgId?: string, id?: string },
    @Param('id') id: string,
    @Res() response: Response,
  ) {
    const url = await this.contentMgmtService.getDownloadUrl(user.orgId || user.id || '', id)
    return response.redirect(302, url)
  }

  @Get(':id')
  async getContent(
    @GetToken() user: { orgId?: string, id?: string },
    @Param('id') id: string,
  ) {
    return this.contentMgmtService.getContent(user.orgId || user.id || '', id)
  }

  @Patch(':id/copy')
  async editCopy(
    @GetToken() user: { orgId?: string, id?: string },
    @Param('id') id: string,
    @Body() body: CopyUpdateDto,
  ) {
    return this.contentMgmtService.editCopy(
      user.orgId || user.id || '',
      id,
      body.title,
      body.subtitle,
      body.hashtags,
      body.blueWords,
      body.commentGuides,
    )
  }

  @Post(':id/approve')
  async approveContent(
    @GetToken() user: { orgId?: string, id?: string },
    @Param('id') id: string,
    @Body() body: ApproveContentDto,
  ) {
    return this.contentMgmtService.approveContent(
      user.orgId || user.id || '',
      id,
      user.id || '',
      body.comment,
    )
  }

  @Post(':id/review')
  async reviewContent(
    @GetToken() user: { orgId?: string, id?: string },
    @Param('id') id: string,
    @Body() body: ReviewContentDto,
  ) {
    return this.contentMgmtService.reviewContent(
      user.orgId || user.id || '',
      id,
      user.id || '',
      body,
    )
  }

  @Post(':id/publish')
  async markPublished(
    @GetToken() user: { orgId?: string, id?: string },
    @Param('id') id: string,
    @Body() body: PublishContentDto,
  ) {
    return this.contentMgmtService.markPublished(
      user.orgId || user.id || '',
      id,
      body.platform,
      body.publishUrl,
      user.id || '',
    )
  }

  @Post(':id/published')
  async markPublishedAlias(
    @GetToken() user: { orgId?: string, id?: string },
    @Param('id') id: string,
    @Body() body: PublishContentDto,
  ) {
    return this.contentMgmtService.markPublished(
      user.orgId || user.id || '',
      id,
      body.platform,
      body.publishUrl,
      user.id || '',
    )
  }
}
