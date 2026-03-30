import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
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
    ]),
  ],
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
