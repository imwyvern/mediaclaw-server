import { PipelineType } from '@yikart/mongodb'
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
  Max,
  Min,
  ValidateNested,
} from 'class-validator'
import {
  PipelineDistributionRulesDto,
  PipelineGroupBindingDto,
  PipelineScheduleDto,
  PipelineStyleConfigDto,
} from '../pipeline/pipeline.dto'

export class PipelineTemplateStepDto {
  @IsString()
  @IsNotEmpty()
  name: string

  @IsOptional()
  config?: Record<string, unknown>

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  order?: number
}

export class PipelineTemplateDefaultParamsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(180)
  duration?: number

  @IsOptional()
  @IsString()
  aspectRatio?: string

  @IsOptional()
  subtitleStyle?: Record<string, unknown>

  @IsOptional()
  @IsString()
  musicStyle?: string
}

export class CreatePipelineTemplateDto {
  @IsOptional()
  @IsString()
  templateId?: string

  @IsString()
  @IsNotEmpty()
  name: string

  @IsOptional()
  @IsEnum(PipelineType)
  type?: PipelineType

  @IsOptional()
  @IsString()
  description?: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categories?: string[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  styles?: string[]

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => PipelineTemplateStepDto)
  @IsArray()
  steps?: PipelineTemplateStepDto[]

  @IsOptional()
  @ValidateNested()
  @Type(() => PipelineTemplateDefaultParamsDto)
  defaultParams?: PipelineTemplateDefaultParamsDto

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isPublic?: boolean
}

export class PipelineTemplateQueryDto {
  @IsOptional()
  @IsString()
  type?: string

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isPublic?: boolean

  @IsOptional()
  @IsString()
  keyword?: string

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  presetOnly?: boolean
}

export class ApplyPipelineTemplateOverridesDto {
  @IsOptional()
  @IsString()
  name?: string

  @IsOptional()
  @IsString()
  description?: string

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
  @Type(() => PipelineScheduleDto)
  schedule?: PipelineScheduleDto

  @IsOptional()
  @IsMongoId()
  routingConfigId?: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  preferredStyles?: string[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  avoidStyles?: string[]

  @IsOptional()
  subtitleStyle?: Record<string, unknown>

  @IsOptional()
  @IsString()
  musicStyle?: string
}

export class ApplyPipelineTemplateDto {
  @IsMongoId()
  brandId: string

  @IsOptional()
  @ValidateNested()
  @Type(() => ApplyPipelineTemplateOverridesDto)
  overrides?: ApplyPipelineTemplateOverridesDto
}

export class LearnPipelinePreferenceDto {
  @IsOptional()
  @IsString()
  source?: string

  @IsOptional()
  @IsString()
  preference?: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  preferredStyles?: string[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  avoidStyles?: string[]

  @IsOptional()
  subtitleStyle?: Record<string, unknown>

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  score?: number

  @IsOptional()
  @IsString()
  notes?: string

  @IsOptional()
  @IsString()
  rejectionReason?: string
}
