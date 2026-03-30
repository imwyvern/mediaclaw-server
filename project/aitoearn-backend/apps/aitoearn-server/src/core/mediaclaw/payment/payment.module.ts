import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { ThrottlerModule } from '@nestjs/throttler'
import {
  PaymentOrder,
  PaymentOrderSchema,
  VideoPack,
  VideoPackSchema,
} from '@yikart/mongodb'
import { DistributionModule } from '../distribution/distribution.module'
import { PaymentCreateThrottleGuard } from './payment-create-throttle.guard'
import { XorPayController } from './xorpay.controller'
import { XorPayService } from './xorpay.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PaymentOrder.name, schema: PaymentOrderSchema },
      { name: VideoPack.name, schema: VideoPackSchema },
    ]),
    DistributionModule,
    ThrottlerModule.forRoot([
      {
        name: 'paymentCreate',
        ttl: 60_000,
        limit: 5,
      },
    ]),
  ],
  controllers: [XorPayController],
  providers: [XorPayService, PaymentCreateThrottleGuard],
  exports: [XorPayService],
})
export class PaymentModule {}
