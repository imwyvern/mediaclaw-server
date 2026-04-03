import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Invoice, InvoiceStatus, PackStatus, PaymentOrder, VideoPack } from '@yikart/mongodb'
import { Model, Types } from 'mongoose'

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name)

  constructor(
    @InjectModel(VideoPack.name) private readonly videoPackModel: Model<VideoPack>,
    @InjectModel(PaymentOrder.name) private readonly paymentOrderModel: Model<PaymentOrder>,
    @InjectModel(Invoice.name) private readonly invoiceModel: Model<Invoice>,
  ) {}

  async createTrialPack(userId: string) {
    const existing = await this.videoPackModel.findOne({
      userId,
      packType: 'trial_free',
    }).exec()

    if (existing) {
      return existing
    }

    return this.videoPackModel.create({
      userId,
      packType: 'trial_free',
      totalCredits: 1,
      remainingCredits: 1,
      priceCents: 0,
      status: PackStatus.ACTIVE,
      purchasedAt: new Date(),
      expiresAt: null,
    })
  }

  async deductCredit(userId: string, taskId: string, credits = 1): Promise<boolean> {
    const existingCharge = await this.videoPackModel.findOne({
      userId,
      'metadata.taskId': taskId,
    }).exec()

    if (existingCharge) {
      this.logger.warn('Credit already charged for task ' + taskId)
      return true
    }

    const now = new Date()
    const pack = await this.videoPackModel.findOne({
      userId,
      status: PackStatus.ACTIVE,
      remainingCredits: { $gte: credits },
      $or: [
        { expiresAt: null },
        { expiresAt: { $gt: now } },
      ],
    })
      .sort({ purchasedAt: 1 })
      .exec()

    if (!pack) {
      return false
    }

    const result = await this.videoPackModel.findOneAndUpdate(
      {
        _id: pack._id,
        remainingCredits: { $gte: credits },
      },
      {
        $inc: { remainingCredits: -credits },
      },
      { new: true },
    ).exec()

    if (!result) {
      return false
    }

    if (result.remainingCredits <= 0) {
      await this.videoPackModel.findByIdAndUpdate(result._id, {
        status: PackStatus.DEPLETED,
      }).exec()
    }

    return true
  }

  async refundCredit(userId: string, credits = 1): Promise<boolean> {
    const pack = await this.videoPackModel.findOne({
      userId,
      status: { $in: [PackStatus.ACTIVE, PackStatus.DEPLETED] },
    })
      .sort({ purchasedAt: 1 })
      .exec()

    if (!pack) {
      this.logger.warn('No credit pack found for refund, userId=' + userId)
      return false
    }

    await this.videoPackModel.findByIdAndUpdate(pack._id, {
      $inc: { remainingCredits: credits },
      $set: { status: PackStatus.ACTIVE },
    }).exec()

    return true
  }

  async getBalance(userId: string) {
    const now = new Date()
    const packs = await this.videoPackModel.find({
      userId,
      status: PackStatus.ACTIVE,
      $or: [
        { expiresAt: null },
        { expiresAt: { $gt: now } },
      ],
    }).exec()

    const totalRemaining = packs.reduce((sum, p) => sum + p.remainingCredits, 0)

    return {
      totalRemaining,
      packs: packs.map(p => ({
        id: p._id,
        type: p.packType,
        remaining: p.remainingCredits,
        total: p.totalCredits,
        expiresAt: p.expiresAt,
      })),
    }
  }

  async getOrders(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit
    const [orders, total] = await Promise.all([
      this.paymentOrderModel.find({ userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.paymentOrderModel.countDocuments({ userId }),
    ])

    return { orders, total, page, limit }
  }

  async getInvoices(orgId: string, page = 1, limit = 20) {
    const normalizedOrgId = this.toObjectId(orgId, 'orgId')
    const normalizedPage = Math.max(1, Math.trunc(Number(page) || 1))
    const normalizedLimit = Math.max(1, Math.min(Math.trunc(Number(limit) || 20), 100))
    const skip = (normalizedPage - 1) * normalizedLimit

    const [items, total] = await Promise.all([
      this.invoiceModel.find({ orgId: normalizedOrgId })
        .sort({ periodStart: -1, createdAt: -1 })
        .skip(skip)
        .limit(normalizedLimit)
        .lean()
        .exec(),
      this.invoiceModel.countDocuments({ orgId: normalizedOrgId }),
    ])

    return {
      orgId,
      page: normalizedPage,
      limit: normalizedLimit,
      total,
      items: items.map(item => this.serializeInvoice(item)),
    }
  }

  async exportInvoices(
    orgId: string,
    input: { startDate?: string, endDate?: string, status?: InvoiceStatus } = {},
  ) {
    const normalizedOrgId = this.toObjectId(orgId, 'orgId')
    const query: Record<string, any> = { orgId: normalizedOrgId }

    if (input.status) {
      query['status'] = input.status
    }

    if (input.startDate || input.endDate) {
      query['periodStart'] = {}
      if (input.startDate) {
        query['periodStart']['$gte'] = this.toDate(input.startDate, 'startDate')
      }
      if (input.endDate) {
        query['periodStart']['$lte'] = this.toDate(input.endDate, 'endDate')
      }
    }

    const invoices = await this.invoiceModel.find(query)
      .sort({ periodStart: -1, createdAt: -1 })
      .lean()
      .exec()

    const header = [
      'invoiceNo',
      'status',
      'totalCents',
      'totalAmount',
      'periodStart',
      'periodEnd',
      'dueDate',
      'paidAt',
      'lineItems',
    ]
    const rows = invoices.map(invoice => ([
      invoice.invoiceNo,
      invoice.status,
      String(invoice.totalCents || 0),
      (Number(invoice.totalCents || 0) / 100).toFixed(2),
      invoice.periodStart ? new Date(invoice.periodStart).toISOString() : '',
      invoice.periodEnd ? new Date(invoice.periodEnd).toISOString() : '',
      invoice.dueDate ? new Date(invoice.dueDate).toISOString() : '',
      invoice.paidAt ? new Date(invoice.paidAt).toISOString() : '',
      (invoice.lineItems || [])
        .map(item => item['description'] + ' x' + item['quantity'] + '=' + (Number(item['amountCents'] || 0) / 100).toFixed(2))
        .join(' | '),
    ]))

    const csv = [header, ...rows]
      .map(columns => columns.map(value => this.escapeCsv(value)).join(','))
      .join('\n')

    return {
      orgId,
      filename: 'billing-invoices-' + orgId + '-' + Date.now() + '.csv',
      contentType: 'text/csv; charset=utf-8',
      total: invoices.length,
      csv,
    }
  }

  generateOrderNo(): string {
    const ts = Math.floor(Date.now() / 1000).toString()
    const rand = Math.random().toString(36).substring(2, 5).toUpperCase()
    return 'MC' + ts + rand
  }

  private serializeInvoice(invoice: Invoice | Record<string, any>) {
    return {
      id: invoice._id.toString(),
      invoiceNo: invoice.invoiceNo,
      status: invoice.status,
      totalCents: Number(invoice.totalCents || 0),
      totalAmount: Number((Number(invoice.totalCents || 0) / 100).toFixed(2)),
      periodStart: invoice.periodStart || null,
      periodEnd: invoice.periodEnd || null,
      dueDate: invoice.dueDate || null,
      paidAt: invoice.paidAt || null,
      lineItems: (invoice.lineItems || []).map((item: Record<string, any>) => ({
        description: item['description'] || '',
        quantity: Number(item['quantity'] || 0),
        unitPriceCents: Number(item['unitPriceCents'] || 0),
        amountCents: Number(item['amountCents'] || 0),
      })),
      createdAt: invoice.createdAt || null,
      updatedAt: invoice.updatedAt || null,
    }
  }

  private toObjectId(value: string, field: string) {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(field + ' is invalid')
    }

    return new Types.ObjectId(value)
  }

  private toDate(value: string, field: string) {
    const normalized = new Date(value)
    if (Number.isNaN(normalized.getTime())) {
      throw new BadRequestException(field + ' is invalid')
    }

    return normalized
  }

  private escapeCsv(value: string) {
    const normalized = String(value ?? '')
    if (!/[",\n]/.test(normalized)) {
      return normalized
    }

    return '"' + normalized.replace(/"/g, '""') + '"'
  }
}
