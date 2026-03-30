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
  PackStatus,
  PaymentMethod,
  PaymentOrder,
  PaymentProductType,
  PaymentStatus,
  VideoPack,
} from '@yikart/mongodb'
import axios from 'axios'
import { Model, Types } from 'mongoose'
import { DistributionService } from '../distribution/distribution.service'
import {
  getPaymentProduct,
  listPaymentProducts,

} from './payment-products'

export interface CreateXorPayOrderParams {
  orgId?: string | null
  userId: string
  productId: string
  productType?: PaymentProductType
  paymentMethod: PaymentMethod
  quantity?: number
  clientIp?: string
  openId?: string
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
  mock: boolean
}

@Injectable()
export class XorPayService {
  private readonly logger = new Logger(XorPayService.name)

  constructor(
    @InjectModel(PaymentOrder.name)
    private readonly orderModel: Model<PaymentOrder>,
    @InjectModel(VideoPack.name)
    private readonly videoPackModel: Model<VideoPack>,
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
    }))
  }

  async createOrder(params: CreateXorPayOrderParams) {
    const product = this.resolveProduct(params.productId, params.productType)
    const quantity = this.normalizeQuantity(params.quantity)
    const amount = product.unitAmount * quantity

    const order = await this.orderModel.create({
      orgId: this.toObjectId(params.orgId),
      userId: params.userId,
      amount,
      currency: product.currency,
      paymentMethod: params.paymentMethod,
      status: PaymentStatus.PENDING,
      callbackData: {},
      productType: product.productType,
      productId: product.id,
      quantity,
    })

    try {
      const gateway = await this.createGatewayOrder(order, product, params)
      const callbackData = {
        ...this.toPlainObject(order.callbackData),
        createResponse: gateway.raw,
        gatewayMocked: gateway.mock,
        tradeNo: gateway.tradeNo,
        payUrl: gateway.payUrl,
      }

      await this.orderModel.findByIdAndUpdate(order._id, {
        $set: {
          callbackData,
        },
      }).exec()

      return this.toOrderResponse({
        ...order.toObject(),
        callbackData,
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

    if (order.status === PaymentStatus.PAID) {
      return this.toOrderResponse(order.toObject())
    }

    const callbackAmount = body['amount'] ?? body['pay_price'] ?? body['total_fee']
    if (callbackAmount !== undefined) {
      const isConsistent = await this.checkAmountConsistency(orderId, callbackAmount)
      if (!isConsistent) {
        throw new BadRequestException('Amount mismatch')
      }
    }

    const nextStatus = this.resolveCallbackStatus(body)
    const updatePayload: Partial<PaymentOrder> = {
      status: nextStatus,
      callbackData: {
        ...this.toPlainObject(order.callbackData),
        callbackBody: body,
        signature: signedValue,
      },
    }

    if (nextStatus === PaymentStatus.PAID) {
      updatePayload.paidAt = new Date()
    }

    const updatedOrder = await this.orderModel.findByIdAndUpdate(order._id, {
      $set: updatePayload,
    }, { new: true }).exec()

    if (!updatedOrder) {
      throw new NotFoundException('Order not found')
    }

    if (nextStatus === PaymentStatus.PAID) {
      await this.ensureVideoPackCreated(updatedOrder)
      await this.distributionService.notifyPaymentSuccess(updatedOrder)
    }

    return this.toOrderResponse(updatedOrder.toObject())
  }

  async getOrderStatus(orderId: string) {
    const order = await this.orderModel.findOne({ orderId }).lean().exec()
    if (!order) {
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
    return normalizedCallbackAmount === order.amount
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

  private async createGatewayOrder(
    order: PaymentOrder,
    product: PaymentProductDefinition,
    params: CreateXorPayOrderParams,
  ): Promise<NormalizedGatewayResponse> {
    const apiUrl = process.env['XORPAY_API_URL'] || process.env['XORPAY_CREATE_ORDER_URL']
    if (!apiUrl) {
      return {
        raw: {
          mocked: true,
          orderId: order.orderId,
        },
        payUrl: `xorpay://mock/${order.orderId}`,
        tradeNo: order.orderId,
        mock: true,
      }
    }

    const payload = {
      app_id: process.env['XORPAY_APP_ID'] || '',
      order_id: order.orderId,
      name: product.name,
      pay_price: Number((order.amount / 100).toFixed(2)),
      currency: order.currency,
      type: order.paymentMethod,
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

    return {
      raw: response.data || null,
      payUrl: response.data?.pay_url || response.data?.payUrl || response.data?.code_url || null,
      tradeNo: response.data?.trade_no || response.data?.tradeNo || null,
      mock: false,
    }
  }

  private async ensureVideoPackCreated(order: PaymentOrder) {
    const product = getPaymentProduct(order.productId)
    if (!product || product.productType !== PaymentProductType.VIDEO_PACK || !product.packType || !product.unitCredits) {
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
    return body['orderId'] || body['order_id'] || body['out_trade_no'] || body['trade_no'] || null
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

    if (!secret || !aoid || !orderId || payPrice === undefined) {
      return ''
    }

    return createHash('md5').update(`${aoid}${orderId}${payPrice}${secret}`).digest('hex')
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

  private toOrderResponse(order: Partial<PaymentOrder> & { _id?: any, callbackData?: Record<string, any> }) {
    return {
      id: order._id?.toString?.() || undefined,
      orderId: order.orderId,
      orgId: order.orgId?.toString?.() || null,
      userId: order.userId,
      amount: order.amount,
      currency: order.currency,
      paymentMethod: order.paymentMethod,
      status: order.status,
      productType: order.productType,
      productId: order.productId,
      quantity: order.quantity,
      paidAt: order.paidAt || null,
      expiredAt: order.expiredAt || null,
      callbackData: order.callbackData || {},
      createdAt: order.createdAt || null,
      updatedAt: order.updatedAt || null,
    }
  }

  private toObjectId(value?: string | null) {
    if (!value || !Types.ObjectId.isValid(value)) {
      return null
    }

    return new Types.ObjectId(value)
  }

  private toPlainObject(value: Record<string, any> | undefined | null) {
    return value ? { ...value } : {}
  }
}
