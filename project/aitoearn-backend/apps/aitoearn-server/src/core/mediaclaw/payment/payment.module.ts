import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  Invoice,
  InvoiceSchema,
  Organization,
  OrganizationSchema,
  PaymentOrder,
  PaymentOrderSchema,
  RefundRequest,
  RefundRequestSchema,
  Subscription,
  SubscriptionSchema,
  VideoPack,
  VideoPackSchema,
} from '@yikart/mongodb'
import { DistributionModule } from '../distribution/distribution.module'
import { NotificationModule } from '../notification/notification.module'
import { PaymentCreateThrottleGuard } from './payment-create-throttle.guard'
import { RefundRequestService } from './refund-request.service'
import { XorPayController } from './xorpay.controller'
import { XorPayService } from './xorpay.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PaymentOrder.name, schema: PaymentOrderSchema },
      { name: RefundRequest.name, schema: RefundRequestSchema },
      { name: VideoPack.name, schema: VideoPackSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: Invoice.name, schema: InvoiceSchema },
      { name: Organization.name, schema: OrganizationSchema },
    ]),
    DistributionModule,
    NotificationModule,
  ],
  controllers: [XorPayController],
  providers: [XorPayService, RefundRequestService, PaymentCreateThrottleGuard],
  exports: [XorPayService, RefundRequestService],
})
export class PaymentModule {}
