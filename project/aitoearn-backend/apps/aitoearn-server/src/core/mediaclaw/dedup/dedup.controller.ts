import { Body, Get, Post } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { DedupService } from './dedup.service'

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

  @Get('stats')
  async getStats(@GetToken() user: { id: string, orgId?: string | null }) {
    return this.dedupService.getDeduplicationStats(user.orgId || user.id)
  }
}
