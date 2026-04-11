import { Prop, Schema } from '@nestjs/mongoose'
import { UserRole } from './mediaclaw-user.schema'

export enum LayerBillingModel {
  FREE = 'free',
  QUOTA = 'quota',
  SUBSCRIPTION = 'subscription',
  USAGE = 'usage',
  POSTPAID = 'postpaid',
}

@Schema({ _id: false })
export class LayerQuotaPolicy {
  @Prop({ type: Boolean, default: true })
  enabled: boolean

  @Prop({ type: Number, default: 0 })
  monthlyLimit: number

  @Prop({ type: Number, default: 0 })
  dailyLimit: number

  @Prop({ type: Number, default: 0 })
  concurrencyLimit: number

  @Prop({ type: Number, default: 0 })
  storageLimitGb: number

  @Prop({ type: Number, default: 0 })
  seatLimit: number

  @Prop({ type: Object, default: {} })
  extras: Record<string, unknown>
}

@Schema({ _id: false })
export class LayerBillingPolicy {
  @Prop({ type: String, enum: Object.values(LayerBillingModel), default: LayerBillingModel.QUOTA })
  mode: LayerBillingModel

  @Prop({ type: Number, default: 0 })
  baseFeeCents: number

  @Prop({ type: Number, default: 0 })
  includedUnits: number

  @Prop({ type: Number, default: 0 })
  overageUnitPriceCents: number

  @Prop({ type: String, default: 'CNY' })
  currency: string

  @Prop({ type: String, default: 'request' })
  billableUnit: string

  @Prop({ type: Object, default: {} })
  extras: Record<string, unknown>
}

@Schema({ _id: false })
export class LayerPermissionPolicy {
  @Prop({ type: [String], default: [UserRole.SUPER_ADMIN, UserRole.ENTERPRISE_ADMIN] })
  adminRoles: string[]

  @Prop({ type: [String], default: [UserRole.OPERATOR] })
  operatorRoles: string[]

  @Prop({ type: [String], default: [UserRole.EMPLOYEE] })
  viewerRoles: string[]

  @Prop({ type: Boolean, default: false })
  requiresApproval: boolean

  @Prop({ type: Boolean, default: true })
  allowMarketplaceInstall: boolean

  @Prop({ type: Boolean, default: true })
  allowCrossInstanceAnalytics: boolean

  @Prop({ type: Object, default: {} })
  extras: Record<string, unknown>
}
