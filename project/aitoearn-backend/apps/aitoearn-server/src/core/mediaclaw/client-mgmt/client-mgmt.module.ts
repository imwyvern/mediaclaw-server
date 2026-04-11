import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  Brand,
  BrandSchema,
  ClawHostInstance,
  ClawHostInstanceSchema,
  Invoice,
  InvoiceSchema,
  MediaClawUser,
  MediaClawUserSchema,
  Organization,
  OrganizationSchema,
  SkillMarketplaceEntry,
  SkillMarketplaceEntrySchema,
  Subscription,
  SubscriptionSchema,
  VideoTask,
  VideoTaskSchema,
} from '@yikart/mongodb'
import { McAuthModule } from '../auth/auth.module'
import { HealthModule } from '../health/health.module'
import { OrgModule } from '../org/org.module'
import { AdminDashboardController } from './admin-dashboard.controller'
import { ClientMgmtController } from './client-mgmt.controller'
import { ClientMgmtService } from './client-mgmt.service'

@Module({
  imports: [
    McAuthModule,
    HealthModule,
    OrgModule,
    MongooseModule.forFeature([
      { name: Organization.name, schema: OrganizationSchema },
      { name: MediaClawUser.name, schema: MediaClawUserSchema },
      { name: Brand.name, schema: BrandSchema },
      { name: VideoTask.name, schema: VideoTaskSchema },
      { name: ClawHostInstance.name, schema: ClawHostInstanceSchema },
      { name: SkillMarketplaceEntry.name, schema: SkillMarketplaceEntrySchema },
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: Invoice.name, schema: InvoiceSchema },
    ]),
  ],
  controllers: [ClientMgmtController, AdminDashboardController],
  providers: [ClientMgmtService],
  exports: [ClientMgmtService],
})
export class ClientMgmtModule {}
