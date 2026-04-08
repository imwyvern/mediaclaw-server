import {
  BillingMode,
  PaymentMethod,
  PaymentProductType,
  SubscriptionPlan,
} from '@yikart/mongodb'
import { Type } from 'class-transformer'
import {
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator'

export class CreatePaymentOrderDto {
  @IsOptional()
  @IsString()
  productId?: string

  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  quantity?: number

  @IsOptional()
  @IsEnum(PaymentProductType)
  productType?: PaymentProductType

  @IsOptional()
  @IsString()
  openId?: string

  @IsOptional()
  @IsString()
  clientIp?: string

  @IsOptional()
  @IsMongoId()
  invoiceId?: string

  @IsOptional()
  @IsEnum(SubscriptionPlan)
  subscriptionPlan?: SubscriptionPlan

  @IsOptional()
  @IsEnum(BillingMode)
  billingMode?: BillingMode

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  monthlyFeeCents?: number
}
