import { ClawHostDeploymentMode, ClawHostInstanceStatus } from '@yikart/mongodb'
import { Type } from 'class-transformer'
import {
  IsArray,
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

  @IsOptional()
  @IsEnum(ClawHostDeploymentMode)
  deploymentMode?: ClawHostDeploymentMode

  @IsOptional()
  @IsString()
  requestedImChannel?: string

  @IsObject()
  @ValidateNested()
  @Type(() => ClawHostInstanceConfigDto)
  config: ClawHostInstanceConfigDto
}

export class ProvisionClawHostInstanceDto {
  @IsString()
  @IsNotEmpty()
  orgId: string

  @IsString()
  @IsNotEmpty()
  clientName: string

  @IsOptional()
  @IsEnum(ClawHostDeploymentMode)
  deploymentMode?: ClawHostDeploymentMode

  @IsOptional()
  @IsString()
  requestedImChannel?: string

  @IsOptional()
  @IsString()
  accessUrl?: string

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ClawHostInstanceConfigDto)
  config?: ClawHostInstanceConfigDto
}

export class ConnectClawHostInstanceDto {
  @IsString()
  @IsNotEmpty()
  code: string

  @IsString()
  @IsNotEmpty()
  instanceId: string

  @IsOptional()
  @IsString()
  agentId?: string

  @IsOptional()
  @IsString()
  clientVersion?: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  capabilities?: string[]
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
