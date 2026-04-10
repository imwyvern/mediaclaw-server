import {
  BillingMode,
  PaymentMethod,
  PaymentProductType,
  RefundRequestStatus,
  SubscriptionPlan,
} from '@yikart/mongodb'
import { Transform, Type } from 'class-transformer'
import {
  Allow,
  IsEnum,
  IsIn,
  IsInt,
  IsMongoId,
  IsObject,
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

export class XorPayCallbackDto {
  @Transform(({ obj }) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return obj
    }

    return { ...(obj as Record<string, unknown>) }
  }, { toClassOnly: true })
  @Allow()
  @IsObject()
  payload: Record<string, unknown>
}

export class CreateRefundRequestDto {
  @IsString()
  orderId: string

  @Type(() => Number)
  @IsInt()
  @Min(1)
  amount: number

  @IsString()
  reason: string

  @IsOptional()
  @IsString()
  description?: string
}

export class ReviewRefundRequestDto {
  @IsIn(['approve', 'reject'])
  action: 'approve' | 'reject'

  @IsOptional()
  @IsString()
  comment?: string
}

export class ListRefundRequestQueryDto {
  @IsOptional()
  @IsEnum(RefundRequestStatus)
  status?: RefundRequestStatus

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
