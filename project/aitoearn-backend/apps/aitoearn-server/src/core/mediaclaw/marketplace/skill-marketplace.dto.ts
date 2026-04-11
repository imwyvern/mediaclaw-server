import {
  SkillMarketplaceEntryStatus,
  SkillMarketplaceVisibility,
} from '@yikart/mongodb'
import { Type } from 'class-transformer'
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator'
import {
  LayerBillingPolicyDto,
  LayerPermissionPolicyDto,
  LayerQuotaPolicyDto,
} from '../shared/layer-policy.dto'

class SkillMarketplaceCapabilityDeclarationDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  capabilities?: string[]

  @IsOptional()
  @IsObject()
  schema?: Record<string, unknown>
}

class SkillMarketplaceCompatibilityDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  runtimeKinds?: string[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  deploymentModes?: string[]

  @IsOptional()
  @IsString()
  minPlan?: string
}

class SkillMarketplaceLayerDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => LayerQuotaPolicyDto)
  quotaPolicy?: LayerQuotaPolicyDto

  @IsOptional()
  @ValidateNested()
  @Type(() => LayerBillingPolicyDto)
  billingPolicy?: LayerBillingPolicyDto

  @IsOptional()
  @ValidateNested()
  @Type(() => LayerPermissionPolicyDto)
  permissionPolicy?: LayerPermissionPolicyDto
}

export class RegisterSkillMarketplaceEntryDto {
  @IsString()
  skillId: string

  @IsOptional()
  @IsString()
  version?: string

  @IsString()
  name: string

  @IsOptional()
  @IsString()
  summary?: string

  @IsOptional()
  @IsString()
  description?: string

  @IsOptional()
  @IsString()
  category?: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[]

  @IsOptional()
  @IsString()
  iconUrl?: string

  @IsOptional()
  @IsEnum(SkillMarketplaceEntryStatus)
  status?: SkillMarketplaceEntryStatus

  @IsOptional()
  @IsEnum(SkillMarketplaceVisibility)
  visibility?: SkillMarketplaceVisibility

  @IsOptional()
  @ValidateNested()
  @Type(() => SkillMarketplaceCapabilityDeclarationDto)
  capabilityDeclaration?: SkillMarketplaceCapabilityDeclarationDto

  @IsOptional()
  @ValidateNested()
  @Type(() => SkillMarketplaceCompatibilityDto)
  compatibility?: SkillMarketplaceCompatibilityDto

  @IsOptional()
  @ValidateNested()
  @Type(() => SkillMarketplaceLayerDto)
  skillLayer?: SkillMarketplaceLayerDto

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean
}

export class InstallSkillMarketplaceEntryDto {
  @IsString()
  instanceId: string

  @IsString()
  skillId: string

  @IsOptional()
  @IsString()
  version?: string
}

export class UninstallSkillMarketplaceEntryDto {
  @IsString()
  instanceId: string

  @IsString()
  skillId: string

  @IsOptional()
  @IsString()
  version?: string
}

export class RateSkillMarketplaceEntryDto {
  @IsString()
  skillId: string

  @IsOptional()
  @IsString()
  version?: string

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(5)
  rating: number

  @IsOptional()
  @IsString()
  review?: string
}
