import { ClawHostDeploymentMode, ClawHostInstanceStatus } from '@yikart/mongodb'
import { Type } from 'class-transformer'
import {
  IsArray,
  IsBoolean,
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

  @IsOptional()
  @IsString()
  plan?: string

  @IsString()
  @IsOptional()
  clientName?: string

  @IsOptional()
  @IsEnum(ClawHostDeploymentMode)
  deploymentMode?: ClawHostDeploymentMode

  @IsOptional()
  @IsString()
  requestedImChannel?: string

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ClawHostInstanceConfigDto)
  config?: ClawHostInstanceConfigDto
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

export class UpgradeClawHostSkillDto {
  @IsOptional()
  @IsString()
  version?: string
}

export class ConfigureClawHostGatewayDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  url?: string

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  toolName?: string
}

export class ClawHostSharedExperienceChannelDto {
  @IsString()
  @IsNotEmpty()
  channel: string

  @IsOptional()
  @IsString()
  groupName?: string

  @IsOptional()
  @IsString()
  inviteUrl?: string

  @IsOptional()
  @IsString()
  chatId?: string

  @IsOptional()
  @IsString()
  entryKeyword?: string
}

export class ConfigureSharedExperienceDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean

  @IsOptional()
  @IsString()
  displayName?: string

  @IsOptional()
  @IsString()
  welcomeMessage?: string

  @IsOptional()
  @IsString()
  supportContact?: string

  @IsOptional()
  @IsString()
  defaultChannel?: string

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ClawHostSharedExperienceChannelDto)
  channels?: ClawHostSharedExperienceChannelDto[]
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
