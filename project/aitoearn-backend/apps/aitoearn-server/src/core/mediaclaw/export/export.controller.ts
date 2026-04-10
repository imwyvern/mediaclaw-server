import { Body, Post } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { ReportType } from '@yikart/mongodb'
import { Type } from 'class-transformer'
import {
  IsArray,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { ExportService } from './export.service'

const EXPORT_REPORT_FORMATS = ['csv', 'json', 'pdf', 'excel', 'zip'] as const
const EXPORT_SINGLE_REPORT_FORMATS = ['csv', 'json', 'pdf', 'excel'] as const

class ExportReportPeriodDto {
  @IsString()
  start: string

  @IsString()
  end: string
}

class ExportReportItemDto {
  @IsEnum(ReportType)
  type: ReportType

  @ValidateNested()
  @Type(() => ExportReportPeriodDto)
  period: ExportReportPeriodDto

  @IsOptional()
  @IsIn(EXPORT_SINGLE_REPORT_FORMATS)
  format?: 'csv' | 'json' | 'pdf' | 'excel'
}

class ExportReportDto {
  @IsIn(EXPORT_REPORT_FORMATS)
  format: 'csv' | 'json' | 'pdf' | 'excel' | 'zip'

  @IsOptional()
  @IsEnum(ReportType)
  type?: ReportType

  @IsOptional()
  @ValidateNested()
  @Type(() => ExportReportPeriodDto)
  period?: ExportReportPeriodDto

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExportReportItemDto)
  reports?: ExportReportItemDto[]
}

@MediaClawApiController('api/v1/export')
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  @Post('report')
  async exportReport(
    @GetToken() user: { orgId?: string | null, id?: string },
    @Body() body: ExportReportDto,
  ) {
    return this.exportService.exportReport(user.orgId || user.id || '', body)
  }
}
