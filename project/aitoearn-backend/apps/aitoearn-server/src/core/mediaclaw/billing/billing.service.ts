import { randomInt } from 'node:crypto'
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Cron, CronExpression } from '@nestjs/schedule'
import {
  BillingMode,
  Invoice,
  InvoiceStatus,
  Organization,
  PackStatus,
  PaymentMethod,
  PaymentOrder,
  PaymentProductType,
  Subscription,
  SubscriptionPlan,
  SubscriptionStatus,
  VideoPack,
} from '@yikart/mongodb'
import { Model, Types } from 'mongoose'
import { XorPayService } from '../payment/xorpay.service'
import { UsageService } from '../usage/usage.service'

interface InvoicePeriod {
  period: string
  start: Date
  end: Date
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name)

  constructor(
    @InjectModel(VideoPack.name) private readonly videoPackModel: Model<VideoPack>,
    @InjectModel(PaymentOrder.name) private readonly paymentOrderModel: Model<PaymentOrder>,
    @InjectModel(Invoice.name) private readonly invoiceModel: Model<Invoice>,
    @InjectModel(Subscription.name) private readonly subscriptionModel: Model<Subscription>,
    @InjectModel(Organization.name) private readonly organizationModel: Model<Organization>,
    private readonly usageService: UsageService,
    private readonly xorPayService: XorPayService,
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
      this.logger.warn(`Credit already charged for task ${taskId}`)
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
      this.logger.warn(`No credit pack found for refund, userId=${userId}`)
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

  async getUsageSummary(
    userId: string,
    orgId?: string | null,
    startDate?: string,
    endDate?: string,
  ) {
    const monthStart = new Date()
    monthStart.setUTCDate(1)
    monthStart.setUTCHours(0, 0, 0, 0)

    return this.usageService.getUsageSummary(
      {
        userId,
        orgId: orgId || null,
      },
      startDate || monthStart,
      endDate || new Date(),
    )
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
        .map(item => `${item['description']} x${item['quantity']}=${(Number(item['amountCents'] || 0) / 100).toFixed(2)}`)
        .join(' | '),
    ]))

    const csv = [header, ...rows]
      .map(columns => columns.map(value => this.escapeCsv(value)).join(','))
      .join('\n')

    return {
      orgId,
      filename: `billing-invoices-${orgId}-${Date.now()}.csv`,
      contentType: 'text/csv; charset=utf-8',
      total: invoices.length,
      csv,
    }
  }

  async getCurrentSubscription(orgId: string) {
    const normalizedOrgId = this.toObjectId(orgId, 'orgId')
    const [organization, subscription] = await Promise.all([
      this.organizationModel.findById(normalizedOrgId).lean().exec(),
      this.subscriptionModel.findOne({ orgId: normalizedOrgId }).sort({ createdAt: -1 }).lean().exec(),
    ])

    if (!organization) {
      throw new NotFoundException('Organization not found')
    }

    return {
      orgId,
      organization: {
        id: organization._id.toString(),
        planId: organization.planId || null,
        billingMode: organization.billingMode,
        monthlyQuota: organization.monthlyQuota,
        monthlyUsed: organization.monthlyUsed,
        subscriptionExpiresAt: organization.subscriptionExpiresAt,
      },
      subscription: subscription ? this.serializeSubscription(subscription) : null,
    }
  }

  async createSubscriptionCheckout(
    userId: string,
    orgId: string,
    input: {
      plan: SubscriptionPlan
      paymentMethod: PaymentMethod
      billingMode?: BillingMode
      monthlyFeeCents?: number
      openId?: string
      clientIp?: string
    },
  ) {
    await this.ensureOrgExists(this.toObjectId(orgId, 'orgId'))

    return this.xorPayService.createOrder({
      orgId,
      userId,
      paymentMethod: input.paymentMethod,
      productType: PaymentProductType.SUBSCRIPTION,
      subscriptionPlan: input.plan,
      billingMode: input.billingMode,
      monthlyFeeCents: input.monthlyFeeCents,
      openId: input.openId,
      clientIp: input.clientIp,
    })
  }

  async generateMonthlyInvoice(
    orgId: string,
    input: { period?: string } = {},
  ) {
    const normalizedOrgId = this.toObjectId(orgId, 'orgId')
    const period = this.resolveInvoicePeriod(input.period)
    const [organization, subscription, existing] = await Promise.all([
      this.organizationModel.findById(normalizedOrgId).lean().exec(),
      this.subscriptionModel.findOne({
        orgId: normalizedOrgId,
        status: { $in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE] },
      }).sort({ createdAt: -1 }).lean().exec(),
      this.invoiceModel.findOne({
        orgId: normalizedOrgId,
        periodStart: period.start,
        periodEnd: period.end,
      }).lean().exec(),
    ])

    if (!organization) {
      throw new NotFoundException('Organization not found')
    }
    if (!subscription) {
      throw new BadRequestException('Active subscription not found')
    }
    if (existing) {
      return this.serializeInvoice(existing)
    }

    const usageSummary = await this.usageService.getUsageSummary(
      { userId: userIdFallback(orgId), orgId },
      period.start,
      period.end,
    )
    const totalUnits = Math.max(0, Number(usageSummary.totals?.creditsConsumed || 0))
    const monthlyQuota = Math.max(0, Number(subscription.monthlyQuota || organization.monthlyQuota || 0))
    const platformFeeCents = Math.max(0, Number(subscription.monthlyFeeCents || 0))
    const perVideoCents = subscription.billingMode === BillingMode.BYOK
      ? 0
      : Math.max(0, Number(subscription.perVideoCents || 0))
    const billableUnits = subscription.billingMode === BillingMode.POSTPAID
      ? totalUnits
      : subscription.billingMode === BillingMode.QUOTA
        ? Math.max(totalUnits - monthlyQuota, 0)
        : 0
    const videoChargesCents = billableUnits * perVideoCents
    const totalCents = platformFeeCents + videoChargesCents
    const dueDate = new Date(period.end)
    dueDate.setUTCDate(dueDate.getUTCDate() + 7)

    const lineItems = [
      {
        description: `${subscription.plan} 平台月费`,
        quantity: 1,
        unitPriceCents: platformFeeCents,
        amountCents: platformFeeCents,
      },
    ]

    if (billableUnits > 0 || subscription.billingMode !== BillingMode.BYOK) {
      lineItems.push({
        description: subscription.billingMode === BillingMode.QUOTA
          ? '视频超额按条计费'
          : subscription.billingMode === BillingMode.POSTPAID
            ? '视频按条后付费'
            : 'BYOK 视频用量',
        quantity: billableUnits,
        unitPriceCents: perVideoCents,
        amountCents: videoChargesCents,
      })
    }

    const created = await this.invoiceModel.create({
      invoiceNo: this.generateInvoiceNo(period.period),
      orgId: normalizedOrgId,
      subscriptionId: subscription._id,
      status: InvoiceStatus.ISSUED,
      lineItems,
      totalCents,
      periodStart: period.start,
      periodEnd: period.end,
      paidAt: null,
      dueDate,
    })

    return {
      ...this.serializeInvoice(created.toObject()),
      usage: {
        totalUnits,
        billableUnits,
        monthlyQuota,
        platformFeeCents,
        videoChargesCents,
      },
    }
  }

  async createInvoicePaymentLink(
    userId: string,
    orgId: string,
    invoiceId: string,
    input: {
      paymentMethod: PaymentMethod
      openId?: string
      clientIp?: string
    },
  ) {
    const normalizedOrgId = this.toObjectId(orgId, 'orgId')
    const normalizedInvoiceId = this.toObjectId(invoiceId, 'invoiceId')
    const invoice = await this.invoiceModel.findOne({
      _id: normalizedInvoiceId,
      orgId: normalizedOrgId,
    }).exec()

    if (!invoice) {
      throw new NotFoundException('Invoice not found')
    }
    if (invoice.status === InvoiceStatus.PAID) {
      throw new BadRequestException('Invoice already paid')
    }
    if (invoice.status === InvoiceStatus.DRAFT) {
      await this.invoiceModel.findByIdAndUpdate(invoice._id, {
        $set: { status: InvoiceStatus.ISSUED },
      }).exec()
    }

    return this.xorPayService.createOrder({
      orgId,
      userId,
      paymentMethod: input.paymentMethod,
      productType: PaymentProductType.ADDON,
      invoiceId,
      openId: input.openId,
      clientIp: input.clientIp,
    })
  }

  async reconcileBilling(orgId?: string) {
    return this.xorPayService.reconcilePaidOrders({ orgId })
  }

  @Cron('0 1 1 * *')
  async generateMonthlyInvoicesJob() {
    const subscriptions = await this.subscriptionModel.find({
      status: { $in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE] },
    }).lean().exec()
    const orgIds = [...new Set(
      subscriptions
        .map(item => item.orgId?.toString?.() || null)
        .filter((value): value is string => Boolean(value)),
    )]

    let created = 0
    for (const orgId of orgIds) {
      try {
        await this.generateMonthlyInvoice(orgId)
        created += 1
      }
      catch (error) {
        this.logger.warn(`Generate monthly invoice skipped for org ${orgId}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    return { checked: orgIds.length, created }
  }

  @Cron(CronExpression.EVERY_6_HOURS)
  async reconcileBillingJob() {
    return this.reconcileBilling()
  }

  generateOrderNo(): string {
    const ts = Math.floor(Date.now() / 1000).toString()
    const rand = randomInt(0, 36 ** 3).toString(36).toUpperCase().padStart(3, '0')
    return `MC${ts}${rand}`
  }

  private generateInvoiceNo(period: string) {
    return `INV-${period.replace('-', '')}-${randomInt(0, 36 ** 3).toString(36).toUpperCase().padStart(3, '0')}`
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

  private serializeSubscription(subscription: Subscription | Record<string, any>) {
    return {
      id: subscription._id.toString(),
      plan: subscription.plan,
      status: subscription.status,
      billingMode: subscription.billingMode,
      monthlyFeeCents: Number(subscription.monthlyFeeCents || 0),
      perVideoCents: Number(subscription.perVideoCents || 0),
      monthlyQuota: Number(subscription.monthlyQuota || 0),
      monthlyUsed: Number(subscription.monthlyUsed || 0),
      currentPeriodStart: subscription.currentPeriodStart || null,
      currentPeriodEnd: subscription.currentPeriodEnd || null,
      autoRenew: Boolean(subscription.autoRenew),
    }
  }

  private ensureOrgExists(orgId: Types.ObjectId) {
    return this.organizationModel.findById(orgId).exec().then((organization) => {
      if (!organization) {
        throw new NotFoundException('Organization not found')
      }

      return organization
    })
  }

  private resolveInvoicePeriod(rawPeriod?: string): InvoicePeriod {
    if (rawPeriod) {
      if (!/^\d{4}-\d{2}$/.test(rawPeriod)) {
        throw new BadRequestException('period is invalid')
      }

      const [yearText, monthText] = rawPeriod.split('-')
      const year = Number(yearText)
      const month = Number(monthText)
      const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0))
      const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999))

      return {
        period: rawPeriod,
        start,
        end,
      }
    }

    const now = new Date()
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 0, 0, 0, 0))
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999))
    const period = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`

    return { period, start, end }
  }

  private toObjectId(value: string, field: string) {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`${field} is invalid`)
    }

    return new Types.ObjectId(value)
  }

  private toDate(value: string, field: string) {
    const normalized = new Date(value)
    if (Number.isNaN(normalized.getTime())) {
      throw new BadRequestException(`${field} is invalid`)
    }

    return normalized
  }

  private escapeCsv(value: string) {
    const normalized = String(value ?? '')
    if (!/[",\n]/.test(normalized)) {
      return normalized
    }

    return `"${normalized.replace(/"/g, '""')}"`
  }
}

function userIdFallback(orgId: string) {
  return orgId
}
