import { Body, Get, Post } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import {
  IsArray,
  IsOptional,
  IsString,
} from 'class-validator'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { DedupBatchItem, DedupService } from './dedup.service'

class CheckDuplicateDto {
  @IsString()
  content: string

  @IsOptional()
  @IsString()
  contentType?: string
}

class DedupContentV2Dto {
  @IsOptional()
  @IsString()
  projectId?: string

  @IsString()
  contentUrl: string

  @IsOptional()
  @IsString()
  imageUrl?: string
}

class DedupBatchRequestDto {
  @IsOptional()
  @IsString()
  projectId?: string

  @IsOptional()
  @IsString()
  batchId?: string

  @IsOptional()
  @IsArray()
  items?: DedupBatchItem[]
}

class RegisterContentV2Dto extends DedupContentV2Dto {
  @IsString()
  recordId: string
}

@MediaClawApiController('api/v1/dedup')
export class DedupController {
  constructor(private readonly dedupService: DedupService) {}

  @Post('check')
  async checkDuplicate(
    @GetToken() user: { id: string, orgId?: string | null },
    @Body() body: CheckDuplicateDto,
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
    @Body() body: DedupContentV2Dto,
  ) {
    return this.dedupService.checkDuplicateV2(
      user.orgId || user.id,
      body.projectId || user.orgId || user.id,
      body.contentUrl,
      body.imageUrl,
    )
  }

  @Post('batch')
  async batchCheck(
    @GetToken() user: { id: string, orgId?: string | null },
    @Body() body: DedupBatchRequestDto,
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
    @Body() body: RegisterContentV2Dto,
  ) {
    return this.dedupService.registerContentV2(
      user.orgId || user.id,
      body.projectId || user.orgId || user.id,
      body.contentUrl,
      body.imageUrl,
      body.recordId,
    )
  }

  @Get('stats')
  async getStats(@GetToken() user: { id: string, orgId?: string | null }) {
    return this.dedupService.getDeduplicationStats(user.orgId || user.id)
  }
}
