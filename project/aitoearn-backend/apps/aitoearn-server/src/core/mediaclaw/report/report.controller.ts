import { Body, Delete, Get, Param, Post, Query } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { ReportType } from '@yikart/mongodb'
import { Type } from 'class-transformer'
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { MediaClawAuthUser } from '../mediaclaw-auth.types'
import { ReportService } from './report.service'

class ReportPeriodDto {
  @IsString()
  start: string

  @IsString()
  end: string
}

class GenerateReportDto {
  @IsEnum(ReportType)
  type: ReportType

  @ValidateNested()
  @Type(() => ReportPeriodDto)
  period: ReportPeriodDto

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  formats?: string[]

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  waitForCompletion?: boolean
}

class ScheduleReportDto {
  @IsOptional()
  @IsEnum(ReportType)
  type?: ReportType

  @IsOptional()
  @IsString()
  frequency?: string

  @IsOptional()
  @IsString()
  cron?: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  formats?: string[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  recipients?: string[]

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean

  @IsOptional()
  @IsString()
  timezone?: string

  @IsOptional()
  @IsObject()
  filters?: Record<string, any>
}

@MediaClawApiController('api/v1/reports')
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  @Post('generate')
  async generate(
    @GetToken() user: MediaClawAuthUser,
    @Body() body: GenerateReportDto,
  ) {
    return this.reportService.generateReport(
      user.orgId || user.id,
      body.type,
      body.period,
      {
        formats: body.formats,
        waitForCompletion: body.waitForCompletion,
      },
    )
  }

  @Post('schedule')
  async schedule(
    @GetToken() user: MediaClawAuthUser,
    @Body() body: ScheduleReportDto,
  ) {
    return this.reportService.scheduleAutoReport(user.orgId || user.id, body)
  }

  @Get()
  async list(
    @GetToken() user: MediaClawAuthUser,
    @Query('type') type?: ReportType,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.reportService.listReports(user.orgId || user.id, {
      type,
      startDate,
      endDate,
    })
  }

  @Get(':id')
  async detail(@GetToken() user: MediaClawAuthUser, @Param('id') id: string) {
    return this.reportService.getReport(user.orgId || user.id, id)
  }

  @Get(':id/files/:format')
  async file(
    @GetToken() user: MediaClawAuthUser,
    @Param('id') id: string,
    @Param('format') format: string,
  ) {
    return this.reportService.getReportFile(user.orgId || user.id, id, format)
  }

  @Delete(':id')
  async remove(@GetToken() user: MediaClawAuthUser, @Param('id') id: string) {
    return this.reportService.deleteReport(user.orgId || user.id, id)
  }
}
