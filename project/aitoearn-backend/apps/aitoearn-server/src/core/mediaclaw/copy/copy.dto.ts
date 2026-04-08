import { Type } from 'class-transformer'
import {
  IsArray,
  IsIn,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator'

export class GenerateCopyDto {
  @IsOptional()
  @IsMongoId()
  videoTaskId?: string

  @IsOptional()
  @IsMongoId()
  brandId?: string

  @IsOptional()
  @IsString()
  theme?: string

  @IsOptional()
  @IsString()
  platform?: string

  @IsOptional()
  @IsString()
  style?: string

  @IsOptional()
  @IsString()
  videoUrl?: string

  @IsOptional()
  @IsString()
  sourceHint?: string

  @IsOptional()
  @IsString()
  @IsIn(['auto', 'deepseek', 'gemini', 'openai'])
  provider?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3)
  count?: number
}

export class InternalGenerateCopyDto extends GenerateCopyDto {
  @IsOptional()
  @IsMongoId()
  orgId?: string

  @IsOptional()
  @IsMongoId()
  userId?: string
}

export class RewriteCopyDto {
  @IsMongoId()
  @IsNotEmpty()
  copyId: string

  @IsOptional()
  @IsString()
  instructions?: string
}

export class RewriteStyleDto {
  @IsString()
  @IsNotEmpty()
  text: string

  @IsString()
  @IsNotEmpty()
  fromPlatform: string

  @IsString()
  @IsNotEmpty()
  toPlatform: string

  @IsOptional()
  @IsString()
  styleGuide?: string

  @IsOptional()
  @IsMongoId()
  brandId?: string

  @IsOptional()
  @IsMongoId()
  taskId?: string
}

export class GenerateBlueWordsDto {
  @IsString()
  @IsNotEmpty()
  title: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keywords?: string[]
}

export class GenerateCommentGuideDto {
  @IsOptional()
  @IsString()
  brand?: string

  @IsOptional()
  @IsString()
  content?: string
}

export class GenerateAbVariantsDto {
  @IsString()
  @IsNotEmpty()
  baseTitle: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3)
  count?: number
}

export class RecordCopyPerformanceMetricsDto {
  @IsOptional()
  @Type(() => Number)
  @Min(0)
  views?: number

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  likes?: number

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  comments?: number

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  shares?: number

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  saves?: number

  @IsOptional()
  @Type(() => Number)
  @Min(0)
  ctr?: number
}

export class RecordCopyPerformanceDto {
  @IsMongoId()
  @IsNotEmpty()
  copyHistoryId: string

  @IsMongoId()
  @IsNotEmpty()
  videoTaskId: string

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => RecordCopyPerformanceMetricsDto)
  metrics?: RecordCopyPerformanceMetricsDto
}

export class CopyInsightsQueryDto {
  @IsOptional()
  @IsString()
  period?: string
}

export class CopyTopPatternsQueryDto {
  @IsOptional()
  @IsString()
  platform?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number
}

export class CopyHistoryQueryDto {
  @IsOptional()
  @IsMongoId()
  videoTaskId?: string

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
