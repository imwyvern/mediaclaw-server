import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  Invoice,
  InvoiceSchema,
  Organization,
  OrganizationSchema,
  PaymentOrder,
  PaymentOrderSchema,
  Subscription,
  SubscriptionSchema,
  VideoPack,
  VideoPackSchema,
} from '@yikart/mongodb'
import { PaymentModule } from '../payment/payment.module'
import { UsageModule } from '../usage/usage.module'
import { BillingController } from './billing.controller'
import { BillingService } from './billing.service'

@Module({
  imports: [
    UsageModule,
    PaymentModule,
    MongooseModule.forFeature([
      { name: VideoPack.name, schema: VideoPackSchema },
      { name: PaymentOrder.name, schema: PaymentOrderSchema },
      { name: Invoice.name, schema: InvoiceSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: Organization.name, schema: OrganizationSchema },
    ]),
  ],
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
