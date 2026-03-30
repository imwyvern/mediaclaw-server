import {
  Body,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { GetToken, Public } from '@yikart/aitoearn-auth'
import {
  PaymentMethod,
  PaymentProductType,
  PaymentStatus,
  UserRole,
} from '@yikart/mongodb'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { PaymentCreateThrottleGuard } from './payment-create-throttle.guard'
import { XorPayService } from './xorpay.service'

interface AuthenticatedPaymentUser {
  id: string
  orgId?: string | null
  role?: UserRole
}

@MediaClawApiController('api/v1/payment')
export class XorPayController {
  constructor(private readonly xorPayService: XorPayService) {}

  @Get('products')
  @Public()
  getProducts() {
    return this.xorPayService.getProducts()
  }

  @Post('create')
  @UseGuards(PaymentCreateThrottleGuard)
  @Throttle({
    paymentCreate: {
      limit: 5,
      ttl: 60_000,
    },
  })
  async createOrder(
    @GetToken() user: AuthenticatedPaymentUser,
    @Body()
    body: {
      productId: string
      paymentMethod: PaymentMethod
      quantity?: number
      productType?: PaymentProductType
      openId?: string
      clientIp?: string
    },
    @Headers('x-forwarded-for') forwardedFor?: string,
    @Headers('x-real-ip') realIp?: string,
  ) {
    return this.xorPayService.createOrder({
      orgId: user.orgId || null,
      userId: user.id,
      productId: body.productId,
      paymentMethod: body.paymentMethod,
      productType: body.productType,
      quantity: body.quantity,
      openId: body.openId,
      clientIp: body.clientIp || forwardedFor?.split(',')[0]?.trim() || realIp,
    })
  }

  @Post('callback')
  @Public()
  async callback(
    @Body() body: Record<string, any>,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const signature = this.pickFirstHeaderValue(
      headers['x-xorpay-signature'],
      headers['x-signature'],
      headers['xorpay-signature'],
    )

    return this.xorPayService.handleCallback(body, signature)
  }

  @Get('status/:orderId')
  async getStatus(@Param('orderId') orderId: string) {
    return this.xorPayService.getOrderStatus(orderId)
  }

  @Get('orders')
  async listOrders(
    @GetToken() user: AuthenticatedPaymentUser,
    @Query('status') status?: PaymentStatus,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('scope') scope?: 'user' | 'org',
  ) {
    const canReadOrgScope = scope === 'org' && user.role === UserRole.ADMIN && user.orgId

    return this.xorPayService.listOrders(
      user.orgId || '',
      {
        status,
        userId: canReadOrgScope ? undefined : user.id,
      },
      {
        page: this.parsePositiveInt(page, 1),
        limit: this.parsePositiveInt(limit, 20),
      },
    )
  }

  private parsePositiveInt(rawValue: string | undefined, fallback: number) {
    const parsed = Number.parseInt(rawValue || '', 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  }

  private pickFirstHeaderValue(...values: Array<string | string[] | undefined>) {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) {
        return value
      }
      if (Array.isArray(value) && value[0]?.trim()) {
        return value[0]
      }
    }

    return undefined
  }
}
