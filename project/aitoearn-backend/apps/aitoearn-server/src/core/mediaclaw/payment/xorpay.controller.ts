import {
  BadRequestException,
  Body,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { GetToken, Public } from '@yikart/aitoearn-auth'
import {
  PaymentStatus,
  UserRole,
  userRoleSatisfies,
} from '@yikart/mongodb'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { PaymentCreateThrottleGuard } from './payment-create-throttle.guard'
import { CreatePaymentOrderDto } from './payment.dto'
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
  @ApiOperation({ summary: '获取可购买的支付商品列表' })
  @ApiOkResponse({ description: '返回当前可售的视频包和订阅商品' })
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
  @ApiOperation({ summary: '创建 XorPay 支付订单' })
  @ApiBody({ type: CreatePaymentOrderDto })
  @ApiCreatedResponse({ description: '支付订单创建成功，并返回支付链接信息' })
  async createOrder(
    @GetToken() user: AuthenticatedPaymentUser,
    @Body() body: CreatePaymentOrderDto,
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
      invoiceId: body.invoiceId,
      subscriptionPlan: body.subscriptionPlan,
      billingMode: body.billingMode,
      monthlyFeeCents: body.monthlyFeeCents,
      clientIp: body.clientIp || forwardedFor?.split(',')[0]?.trim() || realIp,
    })
  }

  @Post(['callback', 'notify'])
  @Public()
  @ApiOperation({ summary: '接收 XorPay 支付回调' })
  @ApiCreatedResponse({ description: '回调验签并更新订单支付状态' })
  async callback(
    @Body() body: Record<string, any>,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('callback body must be an object')
    }

    const signature = this.pickFirstHeaderValue(
      headers['x-xorpay-signature'],
      headers['x-signature'],
      headers['xorpay-signature'],
    )

    return this.xorPayService.handleCallback(body, signature)
  }

  @Get('status/:orderId')
  @ApiOperation({ summary: '查询单个订单支付状态' })
  @ApiParam({ name: 'orderId', description: '支付订单号' })
  @ApiOkResponse({ description: '返回订单支付状态和权益发放结果' })
  async getStatus(
    @GetToken() user: AuthenticatedPaymentUser,
    @Param('orderId') orderId: string,
  ) {
    return this.xorPayService.getOrderStatus(orderId, user)
  }

  @Get('orders')
  @ApiOperation({ summary: '查询支付订单列表' })
  @ApiQuery({ name: 'status', required: false, description: '支付状态过滤' })
  @ApiQuery({ name: 'page', required: false, description: '页码，默认 1' })
  @ApiQuery({ name: 'limit', required: false, description: '每页条数，默认 20' })
  @ApiQuery({ name: 'scope', required: false, description: '查询范围，user 或 org' })
  @ApiOkResponse({ description: '返回订单列表及分页结果' })
  async listOrders(
    @GetToken() user: AuthenticatedPaymentUser,
    @Query('status') status?: PaymentStatus,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('scope') scope?: 'user' | 'org',
  ) {
    const canReadOrgScope = scope === 'org'
      && userRoleSatisfies(user.role, UserRole.ENTERPRISE_ADMIN)
      && user.orgId

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
