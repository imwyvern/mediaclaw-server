import { Type } from 'class-transformer'
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator'
import { ClawHostInstanceStatus } from '@yikart/mongodb'

export class ClawHostInstanceConfigDto {
  @IsString()
  @IsNotEmpty()
  cpu: string

  @IsString()
  @IsNotEmpty()
  memory: string

  @IsString()
  @IsNotEmpty()
  storage: string
}

export class CreateClawHostInstanceDto {
  @IsOptional()
  @IsString()
  orgId?: string

  @IsString()
  @IsNotEmpty()
  clientName: string

  @IsObject()
  @ValidateNested()
  @Type(() => ClawHostInstanceConfigDto)
  config: ClawHostInstanceConfigDto
}

export class InstallClawHostSkillDto {
  @IsString()
  @IsNotEmpty()
  skillId: string

  @IsString()
  @IsNotEmpty()
  version: string
}

export class BatchUpgradeClawHostSkillDto {
  @IsString()
  @IsNotEmpty()
  version: string
}

export class ListClawHostInstancesQueryDto {
  @IsOptional()
  @IsString()
  orgId?: string

  @IsOptional()
  @IsEnum(ClawHostInstanceStatus)
  status?: ClawHostInstanceStatus

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

export class GetClawHostLogsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  lines?: number
}
