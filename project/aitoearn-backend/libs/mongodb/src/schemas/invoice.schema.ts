import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Schema as MongooseSchema } from 'mongoose'

import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

export enum InvoiceStatus {
  DRAFT = 'draft',
  ISSUED = 'issued',
  PAID = 'paid',
  OVERDUE = 'overdue',
  VOID = 'void',
}

@Schema({ _id: false })
class InvoiceLineItem {
  @Prop({ type: String, required: true })
  description: string

  @Prop({ type: Number, required: true })
  quantity: number

  @Prop({ type: Number, required: true })
  unitPriceCents: number

  @Prop({ type: Number, required: true })
  amountCents: number
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'invoices' })
export class Invoice extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId

  @Prop({ required: true, type: String, unique: true })
  invoiceNo: string

  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, index: true })
  orgId: MongooseSchema.Types.ObjectId

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  subscriptionId: MongooseSchema.Types.ObjectId | null

  @Prop({ type: String, enum: InvoiceStatus, default: InvoiceStatus.DRAFT })
  status: InvoiceStatus

  @Prop({ type: [InvoiceLineItem], default: [] })
  lineItems: InvoiceLineItem[]

  @Prop({ required: true, type: Number })
  totalCents: number

  @Prop({ type: Date, required: true })
  periodStart: Date

  @Prop({ type: Date, required: true })
  periodEnd: Date

  @Prop({ type: Date, default: null })
  paidAt: Date | null

  @Prop({ type: Date, required: true })
  dueDate: Date
}

export const InvoiceSchema = SchemaFactory.createForClass(Invoice)
InvoiceSchema.index({ orgId: 1, status: 1, periodStart: -1 })
