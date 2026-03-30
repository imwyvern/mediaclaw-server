import { Get, Query } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { AuditService } from './audit.service'

@MediaClawApiController('api/v1/audit-logs')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  async list(
    @GetToken() user: any,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('action') action?: string,
    @Query('resource') resource?: string,
    @Query('resourceId') resourceId?: string,
    @Query('userId') userId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.auditService.query(
      user.orgId || user.id,
      {
        action,
        resource,
        resourceId,
        userId,
        startDate,
        endDate,
      },
      {
        page: Number(page),
        limit: Number(limit),
      },
    )
  }
}
