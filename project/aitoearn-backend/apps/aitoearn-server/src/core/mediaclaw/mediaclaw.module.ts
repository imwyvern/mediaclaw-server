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
} from '@yikart/mongodb'

import { BrandModule } from './brand/brand.module'
import { OrgModule } from './org/org.module'
import { BillingModule } from './billing/billing.module'
import { HealthModule } from './health/health.module'

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
    ]),
    BrandModule,
    OrgModule,
    BillingModule,
    HealthModule,
  ],
  exports: [MongooseModule],
})
export class MediaClawModule {}
