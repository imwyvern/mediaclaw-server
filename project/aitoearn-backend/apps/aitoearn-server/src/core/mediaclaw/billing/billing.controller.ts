import { Body, Get, Param, Post, Query } from '@nestjs/common'
import { GetToken } from '@yikart/aitoearn-auth'
import { MediaClawApiController } from '../mediaclaw-api.decorator'
import { MediaClawAuthUser } from '../mediaclaw-auth.types'
import {
  CreateInvoicePaymentDto,
  CreateSubscriptionCheckoutDto,
  ExportInvoicesDto,
  GenerateInvoiceDto,
  ReconcileBillingDto,
} from './billing.dto'
import { BillingService } from './billing.service'

@MediaClawApiController('api/v1/billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get('usage-summary')
  async getUsageSummary(
    @GetToken() user: { id: string, orgId?: string | null },
    @Query('start') start?: string,
    @Query('end') end?: string,
  ) {
    return this.billingService.getUsageSummary(user.id, user.orgId || null, start, end)
  }

  @Get('balance')
  async getBalance(@GetToken() user: MediaClawAuthUser) {
    return this.billingService.getBalance(user.id)
  }

  @Get('orders')
  async getOrders(
    @GetToken() user: MediaClawAuthUser,
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

  @Get('subscription')
  async getSubscription(@GetToken() user: { id: string, orgId?: string | null }) {
    return this.billingService.getCurrentSubscription(user.orgId || user.id)
  }

  @Post('subscription/checkout')
  async createSubscriptionCheckout(
    @GetToken() user: MediaClawAuthUser,
    @Body() body: CreateSubscriptionCheckoutDto,
  ) {
    return this.billingService.createSubscriptionCheckout(
      user.id,
      user.orgId || user.id,
      body,
    )
  }

  @Post('invoices/generate')
  async generateInvoice(
    @GetToken() user: { id: string, orgId?: string | null },
    @Body() body: GenerateInvoiceDto,
  ) {
    return this.billingService.generateMonthlyInvoice(user.orgId || user.id, body)
  }

  @Post('invoices/:invoiceId/pay-link')
  async createInvoicePaymentLink(
    @GetToken() user: MediaClawAuthUser,
    @Param('invoiceId') invoiceId: string,
    @Body() body: CreateInvoicePaymentDto,
  ) {
    return this.billingService.createInvoicePaymentLink(
      user.id,
      user.orgId || user.id,
      invoiceId,
      body,
    )
  }

  @Post('export')
  async exportInvoices(
    @GetToken() user: { id: string, orgId?: string | null },
    @Body() body: ExportInvoicesDto,
  ) {
    return this.billingService.exportInvoices(user.orgId || user.id, body)
  }

  @Post('reconcile')
  async reconcileBilling(@Body() body: ReconcileBillingDto) {
    return this.billingService.reconcileBilling(body.orgId)
  }
}
