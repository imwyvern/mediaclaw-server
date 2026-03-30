import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  Brand, BrandSchema,
  Organization, OrganizationSchema,
  MediaClawUser, MediaClawUserSchema,
  VideoPack, VideoPackSchema,
  VideoTask, VideoTaskSchema,
  Pipeline, PipelineSchema,
  PaymentOrder, PaymentOrderSchema,
  Subscription, SubscriptionSchema,
  Invoice, InvoiceSchema,
} from '@yikart/mongodb'

import { BrandModule } from './brand/brand.module'
import { OrgModule } from './org/org.module'
import { BillingModule } from './billing/billing.module'
import { HealthModule } from './health/health.module'
import { McAuthModule } from './auth/auth.module'
import { VideoModule } from './video/video.module'
import { PaymentModule } from './payment/payment.module'
import { PipelineModule } from './pipeline/pipeline.module'
import { McAccountModule } from './account/account.module'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Organization.name, schema: OrganizationSchema },
      { name: Brand.name, schema: BrandSchema },
      { name: MediaClawUser.name, schema: MediaClawUserSchema },
      { name: VideoPack.name, schema: VideoPackSchema },
      { name: VideoTask.name, schema: VideoTaskSchema },
      { name: Pipeline.name, schema: PipelineSchema },
      { name: PaymentOrder.name, schema: PaymentOrderSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: Invoice.name, schema: InvoiceSchema },
    ]),
    BrandModule,
    OrgModule,
    BillingModule,
    HealthModule,
    McAuthModule,
    VideoModule,
    PaymentModule,
    PipelineModule,
    McAccountModule,
  ],
  exports: [MongooseModule],
})
export class MediaClawModule {}
