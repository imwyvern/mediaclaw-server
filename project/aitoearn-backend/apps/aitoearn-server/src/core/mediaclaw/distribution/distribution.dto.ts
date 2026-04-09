import { DistributionRuleType } from '@yikart/mongodb'
import { Type } from 'class-transformer'
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  IsUrl,
  Max,
  Min,
  ValidateNested,
} from 'class-validator'
import {
  DistributionCallbackStatus,
  DistributionPublishStatus,
} from './distribution.constants'

export class DistributionRuleEntryDto {
  @IsOptional()
  @IsObject()
  condition?: Record<string, unknown> | null

  @IsString()
  @IsNotEmpty()
  action: string

  @IsString()
  @IsNotEmpty()
  target: string
}

export class CreateDistributionRuleDto {
  @IsString()
  @IsNotEmpty()
  name: string

  @IsEnum(DistributionRuleType)
  type: DistributionRuleType

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DistributionRuleEntryDto)
  rules: DistributionRuleEntryDto[]

  @IsOptional()
  @IsBoolean()
  isActive?: boolean

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  priority?: number
}

export class UpdateDistributionRuleDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string

  @IsOptional()
  @IsEnum(DistributionRuleType)
  type?: DistributionRuleType

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DistributionRuleEntryDto)
  rules?: DistributionRuleEntryDto[]

  @IsOptional()
  @IsBoolean()
  isActive?: boolean

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  priority?: number
}

export class AssignDistributionDto {
  @IsMongoId()
  contentId: string
}

export class EvaluateDistributionRulesDto {
  @IsObject()
  content: Record<string, unknown>
}

export class DistributionTargetDto {
  @IsOptional()
  @IsString()
  action?: string

  @IsString()
  @IsNotEmpty()
  target: string
}

export class PushDistributionDto {
  @IsMongoId()
  contentId: string

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DistributionTargetDto)
  targets: DistributionTargetDto[]
}

export class TrackDistributionStatusDto {
  @IsMongoId()
  contentId: string

  @IsEnum(DistributionPublishStatus)
  status: DistributionPublishStatus
}

export class CollectDistributionFeedbackDto {
  @IsMongoId()
  contentId: string

  @IsString()
  @IsNotEmpty()
  employeeId: string

  @IsNotEmpty()
  feedback: Record<string, unknown> | string
}

export class PublishConfirmDto {
  @IsMongoId()
  contentId: string

  @IsOptional()
  @IsUrl({ require_tld: false }, { message: 'publishUrl must be a valid URL' })
  publishUrl?: string

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  platform?: string

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  publishPostId?: string
}

export class DistributionStatusQueryDto {
  @IsOptional()
  @IsMongoId()
  contentId?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number
}

export class DistributionDashboardQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @Max(365)
  days?: number

  @IsOptional()
  @IsString()
  @IsIn(['all', 'published', 'expired', 'pushed'])
  status?: 'all' | 'published' | 'expired' | 'pushed'
}

export class DistributionCallbackDto {
  @IsEnum(DistributionCallbackStatus)
  status: DistributionCallbackStatus

  @IsOptional()
  @IsUrl({ require_tld: false }, { message: 'publishUrl must be a valid URL' })
  publishUrl?: string

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  publishPostId?: string

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  platform?: string

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  reason?: string
}
