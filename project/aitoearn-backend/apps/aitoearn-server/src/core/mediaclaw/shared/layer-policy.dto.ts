import { LayerBillingModel } from '@yikart/mongodb'
import { Type } from 'class-transformer'
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator'

export class LayerQuotaPolicyDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  monthlyLimit?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  dailyLimit?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  concurrencyLimit?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  storageLimitGb?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  seatLimit?: number

  @IsOptional()
  @IsObject()
  extras?: Record<string, unknown>
}

export class LayerBillingPolicyDto {
  @IsOptional()
  @IsEnum(LayerBillingModel)
  mode?: LayerBillingModel

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  baseFeeCents?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  includedUnits?: number

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  overageUnitPriceCents?: number

  @IsOptional()
  @IsString()
  currency?: string

  @IsOptional()
  @IsString()
  billableUnit?: string

  @IsOptional()
  @IsObject()
  extras?: Record<string, unknown>
}

export class LayerPermissionPolicyDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  adminRoles?: string[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  operatorRoles?: string[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  viewerRoles?: string[]

  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean

  @IsOptional()
  @IsBoolean()
  allowMarketplaceInstall?: boolean

  @IsOptional()
  @IsBoolean()
  allowCrossInstanceAnalytics?: boolean

  @IsOptional()
  @IsObject()
  extras?: Record<string, unknown>
}
