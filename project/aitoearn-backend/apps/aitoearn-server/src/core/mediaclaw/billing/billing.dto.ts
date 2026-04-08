import {
  BillingMode,
  InvoiceStatus,
  PaymentMethod,
  SubscriptionPlan,
} from '@yikart/mongodb'
import { Type } from 'class-transformer'
import {
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator'

export class ExportInvoicesDto {
  @IsOptional()
  @IsString()
  startDate?: string

  @IsOptional()
  @IsString()
  endDate?: string

  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus
}

export class GenerateInvoiceDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/)
  period?: string
}

export class CreateSubscriptionCheckoutDto {
  @IsEnum(SubscriptionPlan)
  plan: SubscriptionPlan

  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod

  @IsOptional()
  @IsEnum(BillingMode)
  billingMode?: BillingMode

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  monthlyFeeCents?: number

  @IsOptional()
  @IsString()
  openId?: string

  @IsOptional()
  @IsString()
  clientIp?: string
}

export class CreateInvoicePaymentDto {
  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod

  @IsOptional()
  @IsString()
  openId?: string

  @IsOptional()
  @IsString()
  clientIp?: string
}

export class ReconcileBillingDto {
  @IsOptional()
  @IsMongoId()
  orgId?: string
}
