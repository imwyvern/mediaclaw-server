import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  Invoice,
  InvoiceSchema,
  PaymentOrder,
  PaymentOrderSchema,
  VideoPack,
  VideoPackSchema,
} from '@yikart/mongodb'
import { BillingController } from './billing.controller'
import { BillingService } from './billing.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: VideoPack.name, schema: VideoPackSchema },
      { name: PaymentOrder.name, schema: PaymentOrderSchema },
      { name: Invoice.name, schema: InvoiceSchema },
    ]),
  ],
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
