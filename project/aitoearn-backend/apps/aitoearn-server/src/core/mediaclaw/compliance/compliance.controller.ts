import { Body, Get, Param, Post, Put, Query } from '@nestjs/common'
import { GetToken, Public } from '@yikart/aitoearn-auth'
import {
  ComplianceDeletionRequestStatus,
  UserRole,
} from '@yikart/mongodb'
import { Type } from 'class-transformer'
import {
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { Roles } from '../permission.guard'
import { ComplianceService } from './compliance.service'

const COMPLIANCE_REVIEW_ACTIONS = ['reviewing', 'approve', 'reject'] as const

class CreateComplianceDeletionRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  contentUrl?: string

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  platformPostUrl?: string

  @IsString()
  @MaxLength(256)
  reason: string

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string

  @IsString()
  @MaxLength(128)
  requesterName: string

  @IsOptional()
  @IsString()
  @MaxLength(256)
  requesterEmail?: string

  @IsOptional()
  @IsString()
  @MaxLength(64)
  requesterPhone?: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  evidenceUrls?: string[]

  @IsOptional()
  @IsString()
  @MaxLength(64)
  source?: string
}

class ListComplianceDeletionRequestQueryDto {
  @IsOptional()
  @IsEnum(ComplianceDeletionRequestStatus)
  status?: ComplianceDeletionRequestStatus

  @IsOptional()
  @IsString()
  @MaxLength(256)
  keyword?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number
}

class ReviewComplianceDeletionRequestDto {
  @IsIn(COMPLIANCE_REVIEW_ACTIONS)
  @MaxLength(32)
  action: 'reviewing' | 'approve' | 'reject'

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  comment?: string
}

@MediaClawApiController('api/v1/compliance')
export class ComplianceController {
  constructor(private readonly complianceService: ComplianceService) {}

  @Public()
  @Post('deletion-request')
  async createDeletionRequest(@Body() body: CreateComplianceDeletionRequestDto) {
    return this.complianceService.createRequest(body)
  }

  @Roles(UserRole.SUPER_ADMIN)
  @Get('deletion-requests')
  async listDeletionRequests(@Query() query: ListComplianceDeletionRequestQueryDto) {
    return this.complianceService.listRequests(query)
  }

  @Roles(UserRole.SUPER_ADMIN)
  @Put('deletion-requests/:id/review')
  async reviewDeletionRequest(
    @Param('id') id: string,
    @GetToken() user: { id?: string },
    @Body() body: ReviewComplianceDeletionRequestDto,
  ) {
    return this.complianceService.reviewRequest(id, user.id || 'system', body)
  }
}
