import type { PaymentProductDefinition } from './payment-products'
import { createHash } from 'node:crypto'
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
  OrgStatus,
  PackStatus,
  PaymentMethod,
  PaymentOrder,
  PaymentProductType,
  PaymentStatus,
  Subscription,
  SubscriptionPlan,
  SubscriptionStatus,
  UserRole,
  userRoleSatisfies,
  VideoPack,
} from '@yikart/mongodb'
import axios from 'axios'
import { Model, Types } from 'mongoose'
import { DistributionService } from '../distribution/distribution.service'
import {
  getPaymentProduct,
  listPaymentProducts,
  resolveSubscriptionOrgType,
  resolveSubscriptionProduct,
} from './payment-products'

export interface CreateXorPayOrderParams {
  orgId?: string | null
  userId: string
  productId?: string
  productType?: PaymentProductType
  paymentMethod: PaymentMethod
  quantity?: number
  clientIp?: string
  openId?: string
  invoiceId?: string
  subscriptionPlan?: SubscriptionPlan
  billingMode?: BillingMode
  monthlyFeeCents?: number
}

interface PaymentOrderSnapshot {
  _id?: unknown
  orderId?: string
  orgId?: unknown
  userId?: string
  amount?: number
  currency?: string
  paymentMethod?: PaymentMethod
  status?: PaymentStatus
  callbackData?: Record<string, unknown> | null
  payResult?: Record<string, unknown> | null
  metadata?: Record<string, unknown> | null
  productType?: PaymentProductType
  productId?: string
  productName?: string
  quantity?: number
  payChannel?: string
  xorpayOrderId?: string | null
  xorpayPayUrl?: string | null
  benefitGranted?: boolean
  benefitGrantedAt?: Date | null
  paidAt?: Date | null
  expiredAt?: Date | null
  createdAt?: Date | null
  updatedAt?: Date | null
}

interface OrderResolution {
  product: PaymentProductDefinition
  orgId: Types.ObjectId | null
  amount: number
  quantity: number
  productId: string
  productName: string
  metadata: Record<string, unknown>
}

export interface PaymentOrderListFilters {
  status?: PaymentStatus
  userId?: string
}

export interface PaymentOrderPagination {
  page?: number
  limit?: number
}

interface NormalizedGatewayResponse {
  raw: Record<string, any> | null
  payUrl: string | null
  tradeNo: string | null
}

interface PaymentOrderAccessUser {
  id: string
  orgId?: string | null
  role?: UserRole
}

@Injectable()
export class XorPayService {
  private readonly logger = new Logger(XorPayService.name)

  constructor(
    @InjectModel(PaymentOrder.name)
    private readonly orderModel: Model<PaymentOrder>,
    @InjectModel(VideoPack.name)
    private readonly videoPackModel: Model<VideoPack>,
    @InjectModel(Subscription.name)
    private readonly subscriptionModel: Model<Subscription>,
    @InjectModel(Invoice.name)
    private readonly invoiceModel: Model<Invoice>,
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<Organization>,
    private readonly distributionService: DistributionService,
  ) {}

  getProducts() {
    return listPaymentProducts().map(product => ({
      id: product.id,
      name: product.name,
      description: product.description,
      productType: product.productType,
      currency: product.currency,
      unitAmount: product.unitAmount,
      price: Number((product.unitAmount / 100).toFixed(2)),
      unitCredits: product.unitCredits || 0,
      subscriptionPlan: product.subscriptionPlan || null,
      monthlyFeeCents: product.monthlyFeeCents || null,
      perVideoCents: product.perVideoCents || null,
      defaultBillingMode: product.defaultBillingMode || null,
    }))
  }

  async createOrder(params: CreateXorPayOrderParams) {
    const quantity = this.normalizeQuantity(params.quantity)
    const resolution = await this.resolveOrderContext(params, quantity)
    const existingPendingOrder = await this.findReusablePendingOrder({
      orgId: resolution.orgId,
      userId: params.userId,
      paymentMethod: params.paymentMethod,
      status: PaymentStatus.PENDING,
      productType: resolution.product.productType,
      productId: resolution.productId,
      quantity: resolution.quantity,
      expiredAt: { $gt: new Date() },
    })

    if (existingPendingOrder) {
      return this.toOrderResponse(existingPendingOrder)
    }

    const order = await this.orderModel.create({
      orgId: resolution.orgId,
      userId: params.userId,
      amount: resolution.amount,
      currency: resolution.product.currency,
      paymentMethod: params.paymentMethod,
      status: PaymentStatus.PENDING,
      callbackData: {},
      payResult: null,
      metadata: resolution.metadata,
      productType: resolution.product.productType,
      productId: resolution.productId,
      productName: resolution.productName,
      quantity: resolution.quantity,
      payChannel: 'xorpay',
      xorpayOrderId: null,
      xorpayPayUrl: null,
      benefitGranted: false,
      benefitGrantedAt: null,
    })

    try {
      const gateway = await this.createGatewayOrder(order, resolution.product, params)
      const callbackData = {
        ...this.toPlainObject(order.callbackData),
        createResponse: gateway.raw,
        tradeNo: gateway.tradeNo,
        payUrl: gateway.payUrl,
      }

      await this.orderModel.findByIdAndUpdate(order._id, {
        $set: {
          callbackData,
          xorpayOrderId: gateway.tradeNo,
          xorpayPayUrl: gateway.payUrl,
        },
      }).exec()

      return this.toOrderResponse({
        ...order.toObject(),
        callbackData,
        xorpayOrderId: gateway.tradeNo,
        xorpayPayUrl: gateway.payUrl,
      })
    }
    catch (error) {
      await this.orderModel.findByIdAndUpdate(order._id, {
        $set: {
          status: PaymentStatus.FAILED,
          callbackData: {
            ...this.toPlainObject(order.callbackData),
            createError: error instanceof Error ? error.message : String(error),
          },
        },
      }).exec()

      throw error
    }
  }

  async handleCallback(body: Record<string, any>, signature?: string) {
    const signedValue = signature || body['sign'] || body['signature']
    if (!signedValue || !this.verifyCallbackSignature(body, signedValue)) {
      throw new BadRequestException('Invalid callback signature')
    }

    const orderId = this.resolveOrderId(body)
    if (!orderId) {
      throw new BadRequestException('orderId is required')
    }

    const order = await this.orderModel.findOne({ orderId }).exec()
    if (!order) {
      throw new NotFoundException('Order not found')
    }

    if (order.status === PaymentStatus.PAID && order.benefitGranted) {
      return this.toOrderResponse(order.toObject())
    }

    const callbackAmount = body['amount'] ?? body['pay_price'] ?? body['total_fee']
    if (callbackAmount !== undefined) {
      const isConsistent = await this.checkAmountConsistency(orderId, callbackAmount)
      if (!isConsistent) {
        throw new BadRequestException('Amount mismatch')
      }
    }

    if (order.status === PaymentStatus.PAID) {
      const granted = await this.grantOrderBenefits(order)
      return this.toOrderResponse(this.asOrderSnapshot(granted))
    }

    const nextStatus = this.resolveCallbackStatus(body)
    const updatePayload: Partial<PaymentOrder> & Record<string, any> = {
      status: nextStatus,
      payResult: body,
      callbackData: {
        ...this.toPlainObject(order.callbackData),
        callbackBody: body,
        signature: signedValue,
      },
      xorpayOrderId: body['trade_no'] || body['tradeNo'] || order.xorpayOrderId || null,
      xorpayPayUrl: body['pay_url'] || body['payUrl'] || order.xorpayPayUrl || null,
    }

    if (nextStatus === PaymentStatus.PAID) {
      updatePayload.paidAt = this.extractPaidAt(body) || new Date()
    }

    const updatedOrder = await this.orderModel.findByIdAndUpdate(order._id, {
      $set: updatePayload,
    }, { new: true }).exec()

    if (!updatedOrder) {
      throw new NotFoundException('Order not found')
    }

    if (nextStatus !== PaymentStatus.PAID) {
      return this.toOrderResponse(updatedOrder.toObject())
    }

    const grantedOrder = await this.grantOrderBenefits(updatedOrder)
    await this.distributionService.notifyPaymentSuccess(grantedOrder)

    return this.toOrderResponse(this.asOrderSnapshot(grantedOrder))
  }

  async getOrderStatus(orderId: string, user: PaymentOrderAccessUser) {
    const order = await this.orderModel.findOne({ orderId }).lean().exec()
    if (!order) {
      throw new NotFoundException('Order not found')
    }
    if (!this.canAccessOrder(order, user)) {
      throw new NotFoundException('Order not found')
    }

    return this.toOrderResponse(order)
  }

  async listOrders(
    orgId: string,
    filters: PaymentOrderListFilters,
    pagination: PaymentOrderPagination,
  ) {
    const page = pagination.page && pagination.page > 0 ? pagination.page : 1
    const limit = Math.min(pagination.limit && pagination.limit > 0 ? pagination.limit : 20, 100)
    const skip = (page - 1) * limit
    const query: Record<string, unknown> = {}

    const normalizedOrgId = this.toObjectId(orgId)
    if (normalizedOrgId) {
      query['orgId'] = normalizedOrgId
    }

    if (filters.userId) {
      query['userId'] = filters.userId
    }

    if (filters.status) {
      query['status'] = filters.status
    }

    const [items, total] = await Promise.all([
      this.orderModel.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.orderModel.countDocuments(query).exec(),
    ])

    return {
      items: items.map(order => this.toOrderResponse(order)),
      pagination: {
        page,
        limit,
        total,
        totalPages: total > 0 ? Math.ceil(total / limit) : 0,
      },
    }
  }

  async checkAmountConsistency(orderId: string, callbackAmount: unknown) {
    const order = await this.orderModel.findOne({ orderId }).lean().exec()
    if (!order) {
      throw new NotFoundException('Order not found')
    }

    const normalizedCallbackAmount = this.normalizeAmount(callbackAmount, order.amount)
    return Math.abs(normalizedCallbackAmount - order.amount) <= 1
  }

  async reconcilePaidOrders(input: { orgId?: string, orderId?: string } = {}) {
    const query: Record<string, unknown> = {
      status: PaymentStatus.PAID,
      benefitGranted: { $ne: true },
    }

    const normalizedOrgId = this.toObjectId(input.orgId)
    if (normalizedOrgId) {
      query['orgId'] = normalizedOrgId
    }
    if (input.orderId) {
      query['orderId'] = input.orderId
    }

    const orders = await this.orderModel.find(query).sort({ createdAt: 1 }).exec()
    const failures: Array<{ orderId: string | undefined, error: string }> = []
    let restored = 0

    for (const order of orders) {
      try {
        await this.grantOrderBenefits(order)
        restored += 1
      }
      catch (error) {
        failures.push({
          orderId: order.orderId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    return {
      checked: orders.length,
      restored,
      failed: failures.length,
      failures,
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async cancelExpiredOrders() {
    const now = new Date()
    const result = await this.orderModel.updateMany(
      {
        status: PaymentStatus.PENDING,
        expiredAt: { $lte: now },
      },
      {
        $set: {
          status: PaymentStatus.EXPIRED,
        },
      },
    ).exec()

    if (result.modifiedCount > 0) {
      this.logger.warn(`Marked ${result.modifiedCount} payment orders as expired`)
    }

    return result.modifiedCount
  }

  private async resolveOrderContext(
    params: CreateXorPayOrderParams,
    quantity: number,
  ): Promise<OrderResolution> {
    const directProduct = params.productId ? getPaymentProduct(params.productId) : null

    if (params.invoiceId) {
      return this.resolveInvoiceOrderContext(params)
    }

    if (params.subscriptionPlan || directProduct?.productType === PaymentProductType.SUBSCRIPTION) {
      return this.resolveSubscriptionOrderContext(params, directProduct || undefined)
    }

    if (!params.productId) {
      throw new BadRequestException('productId is required')
    }

    const product = this.resolveProduct(params.productId, params.productType)
    return {
      product,
      orgId: this.toObjectId(params.orgId),
      amount: product.unitAmount * quantity,
      quantity,
      productId: product.id,
      productName: product.name,
      metadata: {},
    }
  }

  private async resolveInvoiceOrderContext(
    params: CreateXorPayOrderParams,
  ): Promise<OrderResolution> {
    const invoiceId = params.invoiceId || ''
    if (!Types.ObjectId.isValid(invoiceId)) {
      throw new BadRequestException('invoiceId is invalid')
    }

    const invoice = await this.invoiceModel.findById(invoiceId).lean().exec()
    if (!invoice) {
      throw new NotFoundException('Invoice not found')
    }
    if (invoice.status === InvoiceStatus.PAID) {
      throw new BadRequestException('Invoice already paid')
    }

    const invoiceOrgId = this.stringifyId(invoice.orgId)
    if (params.orgId && invoiceOrgId && params.orgId !== invoiceOrgId) {
      throw new BadRequestException('Invoice does not belong to current org')
    }

    return {
      product: {
        id: `invoice_${invoice._id.toString()}`,
        name: `企业账单 ${invoice.invoiceNo}`,
        description: '企业月账单支付',
        productType: PaymentProductType.ADDON,
        unitAmount: Number(invoice.totalCents || 0),
        currency: 'CNY',
      },
      orgId: this.toObjectId(invoiceOrgId),
      amount: Number(invoice.totalCents || 0),
      quantity: 1,
      productId: `invoice_${invoice._id.toString()}`,
      productName: `企业账单 ${invoice.invoiceNo}`,
      metadata: {
        invoiceId: invoice._id.toString(),
        invoiceNo: invoice.invoiceNo,
        invoiceStatus: invoice.status,
      },
    }
  }

  private async resolveSubscriptionOrderContext(
    params: CreateXorPayOrderParams,
    directProduct?: PaymentProductDefinition,
  ): Promise<OrderResolution> {
    const normalizedOrgId = this.toObjectId(params.orgId)
    if (!normalizedOrgId) {
      throw new BadRequestException('orgId is required for subscription payment')
    }

    const organization = await this.organizationModel.findById(normalizedOrgId).lean().exec()
    if (!organization) {
      throw new NotFoundException('Organization not found')
    }

    const currentSubscription = await this.subscriptionModel.findOne({
      orgId: normalizedOrgId,
    }).sort({ createdAt: -1 }).lean().exec()

    const plan = params.subscriptionPlan || directProduct?.subscriptionPlan
    if (!plan) {
      throw new BadRequestException('subscriptionPlan is required')
    }

    const billingMode = params.billingMode
      || currentSubscription?.billingMode
      || organization.billingMode
      || BillingMode.QUOTA

    let product: PaymentProductDefinition
    try {
      product = resolveSubscriptionProduct(plan, {
        monthlyFeeCents: params.monthlyFeeCents || currentSubscription?.monthlyFeeCents,
        billingMode,
      })
    }
    catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Invalid subscription plan')
    }

    const monthlyQuota = Math.max(
      0,
      Number(currentSubscription?.monthlyQuota || organization.monthlyQuota || 0),
    )
    const action = !currentSubscription
      ? 'activate'
      : currentSubscription.plan === plan
        ? 'renew'
        : 'upgrade'

    const effectivePerVideoCents = billingMode === BillingMode.BYOK
      ? 0
      : Number(product.perVideoCents || currentSubscription?.perVideoCents || 0)

    return {
      product,
      orgId: normalizedOrgId,
      amount: product.unitAmount,
      quantity: 1,
      productId: directProduct?.id || product.id,
      productName: product.name,
      metadata: {
        subscriptionPlan: plan,
        billingMode,
        monthlyFeeCents: Number(product.monthlyFeeCents || product.unitAmount || 0),
        perVideoCents: effectivePerVideoCents,
        monthlyQuota,
        action,
      },
    }
  }

  private async createGatewayOrder(
    order: PaymentOrder,
    product: PaymentProductDefinition,
    params: CreateXorPayOrderParams,
  ): Promise<NormalizedGatewayResponse> {
    const apiUrl = process.env['XORPAY_API_URL'] || process.env['XORPAY_CREATE_ORDER_URL']
    if (!apiUrl) {
      throw new BadRequestException('XorPay create-order endpoint is not configured')
    }

    const payload = {
      app_id: process.env['XORPAY_APP_ID'] || '',
      order_id: order.orderId,
      name: product.name,
      pay_price: Number((order.amount / 100).toFixed(2)),
      currency: order.currency,
      type: this.resolveGatewayPayType(order.paymentMethod),
      product_id: product.id,
      product_type: product.productType,
      quantity: order.quantity,
      notify_url: process.env['XORPAY_NOTIFY_URL'] || '',
      return_url: process.env['XORPAY_RETURN_URL'] || '',
      client_ip: params.clientIp || '',
      openid: params.openId || '',
    }

    const signedPayload = {
      ...payload,
      sign: this.buildSignature(payload),
    }

    const response = await axios.post(apiUrl, signedPayload, {
      timeout: 10_000,
      headers: {
        'content-type': 'application/json',
      },
    })

    const payUrl = response.data?.pay_url || response.data?.payUrl || response.data?.code_url || null
    if (!payUrl) {
      throw new BadRequestException('XorPay response missing pay URL')
    }

    return {
      raw: response.data || null,
      payUrl,
      tradeNo: response.data?.trade_no || response.data?.tradeNo || null,
    }
  }

  private async grantOrderBenefits(order: PaymentOrder) {
    if (order.benefitGranted) {
      return order
    }

    if (order.productType === PaymentProductType.VIDEO_PACK) {
      await this.ensureVideoPackCreated(order)
    }
    else if (order.productType === PaymentProductType.SUBSCRIPTION) {
      await this.ensureSubscriptionActivated(order)
    }
    else if (order.productType === PaymentProductType.ADDON) {
      await this.ensureInvoicePaid(order)
    }

    const benefitGrantedAt = order.paidAt || new Date()
    const updated = await this.orderModel.findByIdAndUpdate(order._id, {
      $set: {
        benefitGranted: true,
        benefitGrantedAt,
      },
    }, { new: true }).exec()

    return updated || order
  }

  private async ensureVideoPackCreated(order: PaymentOrder) {
    const product = getPaymentProduct(order.productId)
    if (
      !product
      || product.productType !== PaymentProductType.VIDEO_PACK
      || !product.packType
      || !product.unitCredits
    ) {
      return
    }

    const existingPack = await this.videoPackModel.findOne({
      paymentOrderId: order.orderId,
    }).lean().exec()

    if (existingPack) {
      return
    }

    const credits = product.unitCredits * order.quantity

    await this.videoPackModel.create({
      userId: order.userId,
      orgId: order.orgId,
      packType: product.packType,
      totalCredits: credits,
      remainingCredits: credits,
      priceCents: order.amount,
      status: PackStatus.ACTIVE,
      purchasedAt: order.paidAt || new Date(),
      expiresAt: null,
      paymentOrderId: order.orderId,
    })
  }

  private async ensureSubscriptionActivated(order: PaymentOrder) {
    const normalizedOrgId = this.toObjectId(this.stringifyId(order.orgId))
    if (!normalizedOrgId) {
      throw new BadRequestException('Subscription order orgId is required')
    }

    const metadata = this.toPlainObject(order.metadata)
    const plan = this.normalizeSubscriptionPlan(metadata['subscriptionPlan'])
    if (!plan) {
      throw new BadRequestException('Subscription plan metadata is missing')
    }

    const organization = await this.organizationModel.findById(normalizedOrgId).lean().exec()
    if (!organization) {
      throw new NotFoundException('Organization not found')
    }

    const currentSubscription = await this.subscriptionModel.findOne({
      orgId: normalizedOrgId,
    }).sort({ createdAt: -1 }).exec()

    const billingMode = this.normalizeBillingMode(metadata['billingMode'])
      || currentSubscription?.billingMode
      || organization.billingMode
      || BillingMode.QUOTA
    const monthlyFeeCents = Math.max(
      0,
      Number(metadata['monthlyFeeCents'] || currentSubscription?.monthlyFeeCents || order.amount || 0),
    )
    const baseProduct = resolveSubscriptionProduct(plan, { monthlyFeeCents, billingMode })
    const perVideoCents = billingMode === BillingMode.BYOK
      ? 0
      : Math.max(
          0,
          Number(metadata['perVideoCents'] || currentSubscription?.perVideoCents || baseProduct.perVideoCents || 0),
        )
    const monthlyQuota = Math.max(
      0,
      Number(metadata['monthlyQuota'] || currentSubscription?.monthlyQuota || organization.monthlyQuota || 0),
    )
    const periodStart = order.paidAt || new Date()
    const periodEnd = this.addMonths(periodStart, 1)

    if (currentSubscription) {
      await this.subscriptionModel.findByIdAndUpdate(currentSubscription._id, {
        $set: {
          plan,
          status: SubscriptionStatus.ACTIVE,
          billingMode,
          monthlyFeeCents,
          perVideoCents,
          monthlyQuota,
          monthlyUsed: 0,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          autoRenew: true,
        },
      }).exec()
    }
    else {
      await this.subscriptionModel.create({
        orgId: normalizedOrgId,
        plan,
        status: SubscriptionStatus.ACTIVE,
        billingMode,
        monthlyFeeCents,
        perVideoCents,
        monthlyQuota,
        monthlyUsed: 0,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        autoRenew: true,
        encryptedApiKey: '',
      })
    }

    const existingVideoCredits = this.toPlainObject(
      (organization as unknown as { videoCredits?: Record<string, unknown> }).videoCredits,
    )
    const nextVideoCredits = {
      ...existingVideoCredits,
      quota: monthlyQuota,
      remaining: billingMode === BillingMode.QUOTA
        ? monthlyQuota
        : Number(existingVideoCredits['remaining'] || 0),
      used: 0,
      monthlyUsage: 0,
      unitPrice: perVideoCents,
      overagePrice: perVideoCents,
    }

    await this.organizationModel.findByIdAndUpdate(normalizedOrgId, {
      $set: {
        billingMode,
        planId: plan,
        type: resolveSubscriptionOrgType(plan),
        status: OrgStatus.ACTIVE,
        monthlyQuota,
        monthlyUsed: 0,
        subscriptionExpiresAt: periodEnd,
        videoCredits: nextVideoCredits,
      },
    }).exec()
  }

  private async ensureInvoicePaid(order: PaymentOrder) {
    const metadata = this.toPlainObject(order.metadata)
    const invoiceId = typeof metadata['invoiceId'] === 'string' ? metadata['invoiceId'] : ''
    if (!Types.ObjectId.isValid(invoiceId)) {
      throw new BadRequestException('Invoice metadata is missing')
    }

    const invoice = await this.invoiceModel.findById(invoiceId).exec()
    if (!invoice) {
      throw new NotFoundException('Invoice not found')
    }

    if (invoice.status !== InvoiceStatus.PAID) {
      await this.invoiceModel.findByIdAndUpdate(invoice._id, {
        $set: {
          status: InvoiceStatus.PAID,
          paidAt: order.paidAt || new Date(),
        },
      }).exec()
    }

    if (invoice.subscriptionId) {
      await this.subscriptionModel.findByIdAndUpdate(invoice.subscriptionId, {
        $set: {
          status: SubscriptionStatus.ACTIVE,
        },
      }).exec()
    }

    await this.organizationModel.findByIdAndUpdate(invoice.orgId, {
      $set: {
        status: OrgStatus.ACTIVE,
      },
    }).exec()
  }

  private resolveProduct(productId: string, productType?: PaymentProductType) {
    const product = getPaymentProduct(productId)
    if (!product) {
      throw new BadRequestException(`Unknown product: ${productId}`)
    }

    if (productType && product.productType !== productType) {
      throw new BadRequestException('Product type mismatch')
    }

    return product
  }

  private normalizeQuantity(quantity?: number) {
    const normalized = quantity || 1
    if (!Number.isInteger(normalized) || normalized <= 0) {
      throw new BadRequestException('quantity must be a positive integer')
    }

    return normalized
  }

  private resolveCallbackStatus(body: Record<string, any>) {
    const rawStatus = String(
      body['status']
      || body['trade_status']
      || body['pay_status']
      || body['result']
      || 'paid',
    ).toLowerCase()

    if (['paid', 'success', 'succeeded', 'trade_success', 'completed', '1'].includes(rawStatus)) {
      return PaymentStatus.PAID
    }

    if (['refund', 'refunded'].includes(rawStatus)) {
      return PaymentStatus.REFUNDED
    }

    if (['expired', 'timeout'].includes(rawStatus)) {
      return PaymentStatus.EXPIRED
    }

    if (['failed', 'fail', 'closed', 'cancelled'].includes(rawStatus)) {
      return PaymentStatus.FAILED
    }

    return PaymentStatus.PAID
  }

  private resolveOrderId(body: Record<string, any>) {
    return body['orderId'] || body['order_id'] || body['out_trade_no'] || null
  }

  private verifyCallbackSignature(body: Record<string, any>, signature: string) {
    const normalizedSignature = signature.toLowerCase()
    const candidates = new Set<string>([
      this.buildSignature(body),
      this.buildLegacyCallbackSignature(body),
    ].filter(Boolean))

    return [...candidates].some(candidate => candidate.toLowerCase() === normalizedSignature)
  }

  private buildSignature(payload: Record<string, any>) {
    const secret = process.env['XORPAY_SECRET'] || process.env['XORPAY_MD5_KEY'] || ''
    if (!secret) {
      return ''
    }

    const serialized = Object.entries(payload)
      .filter(([key, value]) => !['sign', 'signature'].includes(key) && value !== undefined && value !== null && value !== '')
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`)
      .join('&')

    return createHash('md5').update(`${serialized}${secret}`).digest('hex')
  }

  private buildLegacyCallbackSignature(body: Record<string, any>) {
    const secret = process.env['XORPAY_SECRET'] || process.env['XORPAY_MD5_KEY'] || ''
    const aoid = body['aoid']
    const orderId = this.resolveOrderId(body)
    const payPrice = body['pay_price']
    const payTime = body['pay_time']

    if (!secret || !aoid || !orderId || payPrice === undefined || !payTime) {
      return ''
    }

    return createHash('md5').update(`${aoid}${orderId}${payPrice}${payTime}${secret}`).digest('hex')
  }

  private normalizeAmount(callbackAmount: unknown, expectedAmount: number) {
    if (typeof callbackAmount === 'number') {
      if (Number.isInteger(callbackAmount)) {
        return callbackAmount === expectedAmount ? callbackAmount : Math.round(callbackAmount * 100)
      }

      return Math.round(callbackAmount * 100)
    }

    if (typeof callbackAmount === 'string') {
      const trimmed = callbackAmount.trim()
      if (!trimmed) {
        throw new BadRequestException('callback amount is empty')
      }

      const parsed = Number(trimmed)
      if (Number.isNaN(parsed)) {
        throw new BadRequestException('callback amount is invalid')
      }

      if (trimmed.includes('.')) {
        return Math.round(parsed * 100)
      }

      if (parsed === expectedAmount) {
        return parsed
      }

      const scaled = Math.round(parsed * 100)
      return scaled === expectedAmount ? scaled : parsed
    }

    throw new BadRequestException('callback amount is invalid')
  }

  private toOrderResponse(order: PaymentOrderSnapshot) {
    const callbackData = this.sanitizeCallbackData(order.callbackData)
    const orderId = this.stringifyId(order._id)
    const orgId = this.stringifyId(order.orgId)

    return {
      id: orderId || undefined,
      orderId: order.orderId,
      orgId,
      userId: order.userId,
      amount: order.amount,
      currency: order.currency,
      paymentMethod: order.paymentMethod,
      status: order.status,
      productType: order.productType,
      productId: order.productId,
      productName: order.productName || null,
      quantity: order.quantity,
      payChannel: order.payChannel || 'xorpay',
      xorpayOrderId: order.xorpayOrderId || callbackData.tradeNo,
      xorpayPayUrl: order.xorpayPayUrl || callbackData.payUrl,
      payResult: this.toPlainObject(order.payResult),
      metadata: this.toPlainObject(order.metadata),
      benefitGranted: Boolean(order.benefitGranted),
      benefitGrantedAt: order.benefitGrantedAt || null,
      paidAt: order.paidAt || null,
      expiredAt: order.expiredAt || null,
      callbackData,
      createdAt: order.createdAt || null,
      updatedAt: order.updatedAt || null,
    }
  }

  private sanitizeCallbackData(callbackData?: Record<string, unknown> | null) {
    const data = this.toPlainObject(callbackData)
    const callbackBody = this.toPlainObject(data['callbackBody'] as Record<string, unknown> | undefined)

    return {
      payUrl: typeof data['payUrl'] === 'string' ? data['payUrl'] : null,
      tradeNo: typeof data['tradeNo'] === 'string' ? data['tradeNo'] : null,
      createError: typeof data['createError'] === 'string' ? data['createError'] : null,
      createResponse: this.toPlainObject(data['createResponse'] as Record<string, unknown> | undefined),
      callbackBody,
      callbackStatus: this.extractCallbackStatus(callbackBody),
    }
  }

  private extractCallbackStatus(callbackBody: Record<string, unknown>) {
    const candidate = callbackBody['status']
      || callbackBody['trade_status']
      || callbackBody['pay_status']
      || callbackBody['result']

    return typeof candidate === 'string' && candidate.trim()
      ? candidate.trim()
      : null
  }

  private canAccessOrder(
    order: PaymentOrderSnapshot & { userId?: string },
    user: PaymentOrderAccessUser,
  ) {
    if (order.userId && user.id === order.userId) {
      return true
    }

    if (!userRoleSatisfies(user.role, UserRole.ENTERPRISE_ADMIN)) {
      return false
    }

    const orderOrgId = this.stringifyId(order.orgId)
    return Boolean(orderOrgId && user.orgId && orderOrgId === user.orgId)
  }

  private toObjectId(value?: string | null) {
    if (!value || !Types.ObjectId.isValid(value)) {
      return null
    }

    return new Types.ObjectId(value)
  }

  private toPlainObject(value: Record<string, unknown> | undefined | null) {
    return value ? { ...value } : {}
  }

  private asOrderSnapshot(order: PaymentOrder | PaymentOrderSnapshot) {
    const maybeDocument = order as PaymentOrder & { toObject?: () => PaymentOrderSnapshot }
    return typeof maybeDocument.toObject === 'function'
      ? maybeDocument.toObject()
      : (order as PaymentOrderSnapshot)
  }

  private stringifyId(value: unknown): string | null {
    if (typeof value === 'string' && value.trim()) {
      return value
    }

    if (value && typeof value === 'object' && typeof (value as { toString?: () => string }).toString === 'function') {
      const serialized = (value as { toString: () => string }).toString()
      return serialized && serialized !== '[object Object]' ? serialized : null
    }

    return null
  }

  private async findReusablePendingOrder(query: Record<string, any>) {
    const orderModel = this.orderModel as unknown as {
      findOne?: (input: Record<string, any>) => any
    }

    if (typeof orderModel.findOne !== 'function') {
      return null
    }

    const pendingQuery = orderModel.findOne(query)
    if (!pendingQuery) {
      return null
    }

    if (typeof pendingQuery.sort === 'function') {
      pendingQuery.sort({ createdAt: -1 })
    }

    return this.resolveQueryResult(pendingQuery)
  }

  private async resolveQueryResult<T>(queryOrValue: T) {
    if (!queryOrValue) {
      return queryOrValue
    }

    const maybeQuery = queryOrValue as T & {
      lean?: () => unknown
      exec?: () => Promise<unknown>
    }

    if (typeof maybeQuery.lean === 'function') {
      const leaned = maybeQuery.lean()
      if (leaned && typeof (leaned as { exec?: () => Promise<unknown> }).exec === 'function') {
        return (leaned as { exec: () => Promise<T> }).exec()
      }
    }

    if (typeof maybeQuery.exec === 'function') {
      return maybeQuery.exec() as Promise<T>
    }

    return queryOrValue
  }

  private resolveGatewayPayType(paymentMethod: PaymentMethod) {
    if (paymentMethod === PaymentMethod.WECHAT_NATIVE) {
      return 'native'
    }
    if (paymentMethod === PaymentMethod.WECHAT_JSAPI) {
      return 'jsapi'
    }

    return 'alipay'
  }

  private extractPaidAt(body: Record<string, any>) {
    const payTime = body['pay_time']
    if (typeof payTime === 'number') {
      const date = new Date(payTime > 10_000_000_000 ? payTime : payTime * 1000)
      return Number.isNaN(date.getTime()) ? null : date
    }

    if (typeof payTime === 'string' && payTime.trim()) {
      const numeric = Number(payTime)
      if (!Number.isNaN(numeric) && payTime.trim() === `${numeric}`) {
        const date = new Date(numeric > 10_000_000_000 ? numeric : numeric * 1000)
        return Number.isNaN(date.getTime()) ? null : date
      }

      const date = new Date(payTime)
      return Number.isNaN(date.getTime()) ? null : date
    }

    return null
  }

  private addMonths(date: Date, months: number) {
    const next = new Date(date)
    next.setUTCMonth(next.getUTCMonth() + months)
    return next
  }

  private normalizeSubscriptionPlan(value: unknown) {
    if (value === SubscriptionPlan.TEAM || value === SubscriptionPlan.PRO || value === SubscriptionPlan.FLAGSHIP) {
      return value
    }

    return null
  }

  private normalizeBillingMode(value: unknown) {
    if (value === BillingMode.QUOTA || value === BillingMode.POSTPAID || value === BillingMode.BYOK) {
      return value
    }

    return null
  }
}
