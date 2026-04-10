import { Allow, IsOptional, IsString } from 'class-validator'

export class AnalyzeFailureDto {
  @IsString()
  videoTaskId: string

  @IsString()
  stage: string

  @IsOptional()
  @IsString()
  prompt?: string

  @IsOptional()
  @Allow()
  error?: unknown
}
