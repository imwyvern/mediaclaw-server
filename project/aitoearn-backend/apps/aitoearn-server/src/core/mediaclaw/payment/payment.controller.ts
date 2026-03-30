import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import { GetToken, Public } from '@yikart/aitoearn-auth'
import { PaymentChannel } from '@yikart/mongodb'
import { PaymentService } from './payment.service'

@Controller('api/v1/payment')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Get('products')
  @Public()
  getProducts() {
    return this.paymentService.getProducts()
  }

  @Post('create')
  async createOrder(
    @GetToken() user: any,
    @Body() body: { productId: string; channel: PaymentChannel },
  ) {
    return this.paymentService.createOrder(user.id, body.productId, body.channel)
  }

  @Post('callback')
  @Public()
  async callback(@Body() body: any) {
    return this.paymentService.handleCallback(body)
  }

  @Get('status/:orderNo')
  async getStatus(@Param('orderNo') orderNo: string) {
    return this.paymentService.getOrderStatus(orderNo)
  }
}
