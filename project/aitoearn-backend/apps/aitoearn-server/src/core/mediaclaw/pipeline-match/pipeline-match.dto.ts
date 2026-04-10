import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator'

export class MatchPipelineDto {
  @IsOptional()
  @IsString()
  referenceVideoUrl?: string

  @IsOptional()
  @IsString()
  category?: string

  @IsOptional()
  @IsString()
  style?: string

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  duration?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  budget?: number

  @IsOptional()
  @IsString()
  description?: string
}

export class AnalyzeReferenceDto {
  @IsString()
  videoUrl: string
}

export class CreatePipelineTemplateDto {
  @IsOptional()
  @IsString()
  templateId?: string

  @IsOptional()
  @IsString()
  name?: string

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
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @Type(() => Number)
  @IsNumber({}, { each: true })
  durationRange?: [number, number]

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  costPerVideo?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  qualityStars?: number

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  limitations?: string[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  verifiedClients?: string[]

  @IsOptional()
  @IsObject()
  defaultParams?: Record<string, unknown>

  @IsOptional()
  @IsString()
  status?: string

  @IsOptional()
  @IsString()
  type?: string

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isPublic?: boolean
}

export class UpdatePipelineTemplateDto extends CreatePipelineTemplateDto {}
