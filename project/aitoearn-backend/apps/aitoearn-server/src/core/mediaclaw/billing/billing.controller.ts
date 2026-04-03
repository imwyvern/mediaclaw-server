import { Body, Get, Post, Query } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { InvoiceStatus } from '@yikart/mongodb'
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
      page ? Number.parseInt(page, 10) : 1,
      limit ? Number.parseInt(limit, 10) : 20,
    )
  }

  @Get('invoices')
  async getInvoices(
    @GetToken() user: { id: string, orgId?: string | null },
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.billingService.getInvoices(
      user.orgId || user.id,
      page ? Number.parseInt(page, 10) : 1,
      limit ? Number.parseInt(limit, 10) : 20,
    )
  }

  @Post('export')
  async exportInvoices(
    @GetToken() user: { id: string, orgId?: string | null },
    @Body() body: {
      startDate?: string
      endDate?: string
      status?: InvoiceStatus
    },
  ) {
    return this.billingService.exportInvoices(user.orgId || user.id, body)
  }
}
