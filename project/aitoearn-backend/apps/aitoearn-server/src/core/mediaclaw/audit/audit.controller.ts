import { BadRequestException, Get, Query, Res } from '@nestjs/common'
import type { Response } from 'express'
import { GetToken } from '@yikart/aitoearn-auth'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { AuditService } from './audit.service'

@MediaClawApiController('api/v1/audit-logs')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('export')
  async export(
    @GetToken() user: any,
    @Query('format') format: 'csv' | 'json' = 'json',
    @Query('action') action: string | undefined,
    @Query('resource') resource: string | undefined,
    @Query('resourceId') resourceId: string | undefined,
    @Query('userId') userId: string | undefined,
    @Query('start') start: string | undefined,
    @Query('end') end: string | undefined,
    @Query('startDate') startDate: string | undefined,
    @Query('endDate') endDate: string | undefined,
    @Res() response: Response,
  ) {
    const normalizedFormat = format === 'csv' || format === 'json'
      ? format
      : null

    if (!normalizedFormat) {
      throw new BadRequestException('format must be csv or json')
    }

    const orgId = user.orgId || user.id
    const cursor = this.auditService.createExportCursor(orgId, {
      action,
      resource,
      resourceId,
      userId,
      startDate: start || startDate,
      endDate: end || endDate,
    })

    const fileName = 'audit-logs-' + new Date().toISOString().slice(0, 10) + '.' + normalizedFormat
    response.setHeader('Content-Disposition', 'attachment; filename="' + fileName + '"')
    response.setHeader('Cache-Control', 'no-store')

    try {
      if (normalizedFormat === 'csv') {
        response.setHeader('Content-Type', 'text/csv; charset=utf-8')
        response.write(this.csvHeader())

        for await (const row of cursor) {
          response.write(this.toCsvRow(this.auditService.serializeLog(row as Record<string, any>)))
        }
      }
      else {
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.write('[')
        let first = true

        for await (const row of cursor) {
          if (!first) {
            response.write(',')
          }

          response.write(JSON.stringify(this.auditService.serializeLog(row as Record<string, any>)))
          first = false
        }

        response.write(']')
      }
    }
    finally {
      await cursor.close().catch(() => undefined)
      response.end()
    }
  }

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

  private csvHeader() {
    return [
      'id',
      'orgId',
      'userId',
      'userName',
      'action',
      'resource',
      'target',
      'resourceId',
      'details',
      'meta',
      'ip',
      'ipAddress',
      'userAgent',
      'createdAt',
      'updatedAt',
    ].join(',') + '\n'
  }

  private toCsvRow(item: Record<string, any>) {
    return [
      item['id'],
      item['orgId'],
      item['userId'],
      item['userName'],
      item['action'],
      item['resource'],
      item['target'],
      item['resourceId'],
      JSON.stringify(item['details'] || {}),
      JSON.stringify(item['meta'] || {}),
      item['ip'],
      item['ipAddress'],
      item['userAgent'],
      item['createdAt'] ? new Date(item['createdAt']).toISOString() : '',
      item['updatedAt'] ? new Date(item['updatedAt']).toISOString() : '',
    ].map(value => this.escapeCsv(String(value ?? ''))).join(',') + '\n'
  }

  private escapeCsv(value: string) {
    return '"' + value.replace(/"/g, '""').replace(/\r?\n/g, '\\n') + '"'
  }
}
