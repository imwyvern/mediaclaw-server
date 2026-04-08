import { PipelineStatus, PipelineType } from '@yikart/mongodb'
import { Type } from 'class-transformer'
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator'

export class PipelineBrandAssetsDto {
  @IsOptional()
  @IsString()
  logo?: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  colors?: string[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  fonts?: string[]
}

export class PipelineStyleRewriteConfigDto {
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  enabled?: boolean

  @IsOptional()
  @IsString()
  scope?: string

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  preserveComposition?: boolean

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  preserveProductPlacement?: boolean

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mutationDomains?: string[]
}

export class PipelineStyleConfigDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  duration?: number

  @IsOptional()
  @IsString()
  aspectRatio?: string

  @IsOptional()
  @IsString()
  tone?: string

  @IsOptional()
  @IsString()
  visualStyle?: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  platforms?: string[]

  @IsOptional()
  @ValidateNested()
  @Type(() => PipelineBrandAssetsDto)
  brandAssets?: PipelineBrandAssetsDto

  @IsOptional()
  @ValidateNested()
  @Type(() => PipelineStyleRewriteConfigDto)
  styleRewrite?: PipelineStyleRewriteConfigDto
}

export class PipelineDistributionTargetDto {
  @IsOptional()
  @IsString()
  employeeName?: string

  @IsOptional()
  @IsMongoId()
  assignmentId?: string

  @IsOptional()
  @IsString()
  imChannel?: string

  @IsOptional()
  @IsString()
  imUserId?: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetPlatforms?: string[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  preferredTimeSlots?: string[]

  @IsOptional()
  outputConfig?: Record<string, unknown>
}

export class PipelineDistributionRulesDto {
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
  @IsString()
  strategy?: string

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => PipelineDistributionTargetDto)
  @IsArray()
  targets?: PipelineDistributionTargetDto[]
}

export class PipelineScheduleDto {
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  enabled?: boolean

  @IsOptional()
  @IsString()
  cron?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  videosPerRun?: number

  @IsOptional()
  @IsString()
  timezone?: string
}

export class PipelinePreferencesDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  preferredStyles?: string[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  avoidStyles?: string[]

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  preferredDuration?: number

  @IsOptional()
  @IsString()
  aspectRatio?: string

  @IsOptional()
  subtitlePreferences?: Record<string, unknown>

  @IsOptional()
  remixInsights?: Record<string, unknown>
}

export class PipelineModelOverridesDto {
  @IsOptional()
  @IsString()
  copy?: string

  @IsOptional()
  @IsString()
  frameEdit?: string

  @IsOptional()
  @IsString()
  videoGen?: string
}

export class PipelineGroupBindingDto {
  @IsString()
  @IsNotEmpty()
  channel: string

  @IsString()
  @IsNotEmpty()
  groupId: string

  @IsOptional()
  @IsString()
  groupName?: string
}

export class CreatePipelineDto {
  @IsMongoId()
  brandId: string

  @IsString()
  @IsNotEmpty()
  name: string

  @IsOptional()
  @IsString()
  description?: string

  @IsOptional()
  @IsEnum(PipelineType)
  type?: PipelineType

  @IsOptional()
  @IsMongoId()
  routingConfigId?: string

  @IsOptional()
  @IsString()
  templateId?: string

  @IsOptional()
  @ValidateNested()
  @Type(() => PipelineStyleConfigDto)
  styleConfig?: PipelineStyleConfigDto

  @IsOptional()
  @ValidateNested()
  @Type(() => PipelineDistributionRulesDto)
  distributionRules?: PipelineDistributionRulesDto

  @IsOptional()
  @ValidateNested()
  @Type(() => PipelineGroupBindingDto)
  groupBinding?: PipelineGroupBindingDto

  @IsOptional()
  @ValidateNested()
  @Type(() => PipelinePreferencesDto)
  preferences?: PipelinePreferencesDto

  @IsOptional()
  @ValidateNested()
  @Type(() => PipelineScheduleDto)
  schedule?: PipelineScheduleDto

  @IsOptional()
  @ValidateNested()
  @Type(() => PipelineModelOverridesDto)
  modelOverrides?: PipelineModelOverridesDto
}

export class UpdatePipelineDto {
  @IsOptional()
  @IsMongoId()
  brandId?: string

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string

  @IsOptional()
  @IsString()
  description?: string

  @IsOptional()
  @IsEnum(PipelineType)
  type?: PipelineType

  @IsOptional()
  @IsEnum(PipelineStatus)
  status?: PipelineStatus

  @IsOptional()
  @IsMongoId()
  routingConfigId?: string

  @IsOptional()
  @IsString()
  templateId?: string

  @IsOptional()
  @ValidateNested()
  @Type(() => PipelineStyleConfigDto)
  styleConfig?: PipelineStyleConfigDto

  @IsOptional()
  @ValidateNested()
  @Type(() => PipelineDistributionRulesDto)
  distributionRules?: PipelineDistributionRulesDto

  @IsOptional()
  @ValidateNested()
  @Type(() => PipelineGroupBindingDto)
  groupBinding?: PipelineGroupBindingDto

  @IsOptional()
  @ValidateNested()
  @Type(() => PipelinePreferencesDto)
  preferences?: PipelinePreferencesDto

  @IsOptional()
  @ValidateNested()
  @Type(() => PipelineScheduleDto)
  schedule?: PipelineScheduleDto
}
