import { DeliveryChannel, EmployeeAssignmentStatus } from '@yikart/mongodb'
import { Type } from 'class-transformer'
import {
  IsArray,
  IsEnum,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  ValidateNested,
} from 'class-validator'

export class EmployeeDistributionRulesDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxDailyVideos?: number

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  preferredPlatforms?: string[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  preferredCategories?: string[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  templateIds?: string[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  accountTypes?: string[]

  @IsOptional()
  @IsMongoId()
  defaultPlatformAccountId?: string
}

export class EmployeeImChannelBindingDto {
  @IsOptional()
  @IsString()
  openId?: string

  @IsOptional()
  @IsString()
  userId?: string

  @IsOptional()
  @IsString()
  chatId?: string
}

export class EmployeeImBindingDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => EmployeeImChannelBindingDto)
  feishu?: EmployeeImChannelBindingDto

  @IsOptional()
  @ValidateNested()
  @Type(() => EmployeeImChannelBindingDto)
  wecom?: EmployeeImChannelBindingDto
}

export class CreateEmployeeAssignmentDto {
  @IsString()
  @IsNotEmpty()
  employeeName: string

  @IsString()
  @IsNotEmpty()
  employeePhone: string

  @IsOptional()
  @IsString()
  employeeUserId?: string

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  platformAccountIds?: string[]

  @IsOptional()
  @IsUrl({ require_tld: false }, { message: 'webhookUrl must be a valid URL' })
  webhookUrl?: string

  @IsOptional()
  @IsEnum(EmployeeAssignmentStatus)
  status?: EmployeeAssignmentStatus

  @IsOptional()
  @ValidateNested()
  @Type(() => EmployeeDistributionRulesDto)
  distributionRules?: EmployeeDistributionRulesDto

  @IsOptional()
  @ValidateNested()
  @Type(() => EmployeeImBindingDto)
  imBinding?: EmployeeImBindingDto
}

export class UpdateEmployeeAssignmentDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  employeeName?: string

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  employeePhone?: string

  @IsOptional()
  @IsString()
  employeeUserId?: string

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  platformAccountIds?: string[]

  @IsOptional()
  @IsUrl({ require_tld: false }, { message: 'webhookUrl must be a valid URL' })
  webhookUrl?: string

  @IsOptional()
  @IsEnum(EmployeeAssignmentStatus)
  status?: EmployeeAssignmentStatus

  @IsOptional()
  @ValidateNested()
  @Type(() => EmployeeDistributionRulesDto)
  distributionRules?: EmployeeDistributionRulesDto

  @IsOptional()
  @ValidateNested()
  @Type(() => EmployeeImBindingDto)
  imBinding?: EmployeeImBindingDto
}

export class AssignmentQueryDto {
  @IsOptional()
  @IsString()
  status?: string

  @IsOptional()
  @IsString()
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
  @Max(100)
  limit?: number
}

export class BindImAccountDto {
  @IsString()
  @IsNotEmpty()
  channel: string

  @IsOptional()
  @IsString()
  openId?: string

  @IsOptional()
  @IsString()
  userId?: string

  @IsOptional()
  @IsString()
  chatId?: string
}

export class DispatchToEmployeeDto {
  @IsMongoId()
  videoTaskId: string

  @IsMongoId()
  assignmentId: string
}

export class BatchDispatchRulesDto {
  @IsOptional()
  @IsMongoId()
  pipelineId?: string

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  assignmentIds?: string[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  preferredPlatforms?: string[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  preferredCategories?: string[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  templateIds?: string[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  accountTypes?: string[]

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  platformAccountIds?: string[]

  @IsOptional()
  @IsMongoId()
  platformAccountId?: string

  @IsOptional()
  @IsString()
  strategy?: string
}

export class BatchDispatchDto {
  @IsArray()
  @IsMongoId({ each: true })
  videoTaskIds: string[]

  @IsOptional()
  @ValidateNested()
  @Type(() => BatchDispatchRulesDto)
  rules?: BatchDispatchRulesDto
}

export class PendingDeliveriesQueryDto {
  @IsOptional()
  @IsMongoId()
  assignmentId?: string

  @IsOptional()
  @IsMongoId()
  videoTaskId?: string

  @IsOptional()
  @IsEnum(DeliveryChannel)
  channel?: DeliveryChannel

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

export class DeliveryPublishDto {
  @IsOptional()
  @IsUrl({ require_tld: false }, { message: 'publishUrl must be a valid URL' })
  publishUrl?: string

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  publishPlatform?: string

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  publishPostId?: string
}

export class DispatchStatsQueryDto {
  @IsOptional()
  @IsString()
  period?: string

  @IsOptional()
  @IsString()
  startAt?: string

  @IsOptional()
  @IsString()
  endAt?: string
}
