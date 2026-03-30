import { Body, Get, Param, Patch, Post, Put, Query } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { VideoTaskStatus } from '@yikart/mongodb'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { ContentMgmtService } from './content-mgmt.service'

@MediaClawApiController('api/v1/content')
export class ContentMgmtController {
  constructor(private readonly contentMgmtService: ContentMgmtService) {}

  @Put('style-preferences')
  async setStylePreferences(
    @GetToken() user: { orgId?: string; id?: string },
    @Body()
    body: {
      orgId?: string
      preferences: Record<string, unknown>
    },
  ) {
    return this.contentMgmtService.setStylePreferences(
      body.orgId || user.orgId || user.id || '',
      body.preferences,
    )
  }

  @Get('style-preferences')
  async getStylePreferences(
    @GetToken() user: { orgId?: string; id?: string },
    @Query('orgId') orgId?: string,
  ) {
    return this.contentMgmtService.getStylePreferences(orgId || user.orgId || user.id || '')
  }

  @Get()
  async listContent(
    @GetToken() user: { orgId?: string; id?: string },
    @Query('orgId') orgId?: string,
    @Query('status') status?: VideoTaskStatus,
    @Query('publishStatus') publishStatus?: string,
    @Query('brandId') brandId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.contentMgmtService.listContent(
      orgId || user.orgId || user.id || '',
      { status, publishStatus, brandId, startDate, endDate },
      {
        page: page ? parseInt(page, 10) : 1,
        limit: limit ? parseInt(limit, 10) : 20,
      },
    )
  }

  @Post('batch-edit')
  async batchEditCopy(
    @Body()
    body: {
      contentIds: string[]
      updates: {
        title?: string
        subtitle?: string
        hashtags?: string[]
      }
    },
  ) {
    return this.contentMgmtService.batchEditCopy(body.contentIds, body.updates)
  }

  @Post('export')
  async exportContent(
    @GetToken() user: { orgId?: string; id?: string },
    @Body()
    body: {
      orgId?: string
      format: string
      filters?: {
        status?: VideoTaskStatus
        publishStatus?: string
        brandId?: string
        startDate?: string
        endDate?: string
      }
    },
  ) {
    return this.contentMgmtService.exportContent(
      body.orgId || user.orgId || user.id || '',
      body.format,
      body.filters || {},
    )
  }

  @Get(':id')
  async getContent(@Param('id') id: string) {
    return this.contentMgmtService.getContent(id)
  }

  @Patch(':id/copy')
  async editCopy(
    @Param('id') id: string,
    @Body()
    body: {
      title?: string
      subtitle?: string
      hashtags?: string[]
    },
  ) {
    return this.contentMgmtService.editCopy(id, body.title, body.subtitle, body.hashtags)
  }

  @Post(':id/publish')
  async markPublished(
    @Param('id') id: string,
    @Body()
    body: {
      platform: string
      publishUrl: string
    },
  ) {
    return this.contentMgmtService.markPublished(id, body.platform, body.publishUrl)
  }
}
