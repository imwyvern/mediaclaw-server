import { Get, Query } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { BillingService } from './billing.service'

@MediaClawApiController('api/v1/billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get('balance')
  async getBalance(@GetToken() user: any) {
    return this.billingService.getBalance(user.id)
  }

  @Get('orders')
  async getOrders(
    @GetToken() user: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.billingService.getOrders(
      user.id,
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 20,
    )
  }
}
