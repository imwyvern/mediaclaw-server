import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  Brand,
  BrandSchema,
  Invoice,
  InvoiceSchema,
  MediaClawUser,
  MediaClawUserSchema,
  Organization,
  OrganizationSchema,
  Subscription,
  SubscriptionSchema,
  VideoTask,
  VideoTaskSchema,
} from '@yikart/mongodb'
import { McAuthModule } from '../auth/auth.module'
import { ClientMgmtController } from './client-mgmt.controller'
import { ClientMgmtService } from './client-mgmt.service'

@Module({
  imports: [
    McAuthModule,
    MongooseModule.forFeature([
      { name: Organization.name, schema: OrganizationSchema },
      { name: MediaClawUser.name, schema: MediaClawUserSchema },
      { name: Brand.name, schema: BrandSchema },
      { name: VideoTask.name, schema: VideoTaskSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: Invoice.name, schema: InvoiceSchema },
    ]),
  ],
  controllers: [ClientMgmtController],
  providers: [ClientMgmtService],
  exports: [ClientMgmtService],
})
export class ClientMgmtModule {}
