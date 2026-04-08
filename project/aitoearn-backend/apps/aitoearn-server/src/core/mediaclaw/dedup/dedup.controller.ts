import { Body, Get, Post } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { DedupBatchItem, DedupService } from './dedup.service'

@MediaClawApiController('api/v1/dedup')
export class DedupController {
  constructor(private readonly dedupService: DedupService) {}

  @Post('check')
  async checkDuplicate(
    @GetToken() user: { id: string, orgId?: string | null },
    @Body() body: {
      content?: string
      contentType?: string
    },
  ) {
    return this.dedupService.checkDuplicate(
      user.orgId || user.id,
      body.content || '',
      body.contentType || 'video_task',
    )
  }

  @Post('check-v2')
  async checkDuplicateV2(
    @GetToken() user: { id: string, orgId?: string | null },
    @Body() body: {
      projectId?: string
      contentUrl?: string
      imageUrl?: string
    },
  ) {
    return this.dedupService.checkDuplicateV2(
      user.orgId || user.id,
      body.projectId || user.orgId || user.id,
      body.contentUrl || '',
      body.imageUrl,
    )
  }

  @Post('batch')
  async batchCheck(
    @GetToken() user: { id: string, orgId?: string | null },
    @Body() body: {
      projectId?: string
      batchId?: string
      items?: DedupBatchItem[]
    },
  ) {
    if (body.batchId?.trim()) {
      return this.dedupService.batchCheckDuplicateByBatch(
        user.orgId || user.id,
        body.projectId || user.orgId || user.id,
        body.batchId,
      )
    }

    return this.dedupService.batchCheckDuplicate(
      user.orgId || user.id,
      body.projectId || user.orgId || user.id,
      body.items || [],
    )
  }

  @Post('register-v2')
  async registerContentV2(
    @GetToken() user: { id: string, orgId?: string | null },
    @Body() body: {
      projectId?: string
      contentUrl?: string
      imageUrl?: string
      recordId?: string
    },
  ) {
    return this.dedupService.registerContentV2(
      user.orgId || user.id,
      body.projectId || user.orgId || user.id,
      body.contentUrl || '',
      body.imageUrl,
      body.recordId || '',
    )
  }

  @Get('stats')
  async getStats(@GetToken() user: { id: string, orgId?: string | null }) {
    return this.dedupService.getDeduplicationStats(user.orgId || user.id)
  }
}
