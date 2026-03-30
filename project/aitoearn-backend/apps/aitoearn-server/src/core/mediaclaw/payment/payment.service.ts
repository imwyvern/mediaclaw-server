import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { createHash } from 'crypto'
import {
  PaymentOrder, PaymentStatus, PaymentChannel,
  VideoPack, PackType, PackStatus,
} from '@yikart/mongodb'
import { BillingService } from '../billing/billing.service'
import { DistributionService } from '../distribution/distribution.service'

// Product catalog: individual video packs
const PRODUCTS = {
  single: { name: '单条视频', credits: 1, priceCents: 2900, packType: PackType.SINGLE },
  pack_10: { name: '10条套餐', credits: 10, priceCents: 19900, packType: PackType.PACK_10 },
  pack_30: { name: '30条套餐', credits: 30, priceCents: 49900, packType: PackType.PACK_30 },
  pack_100: { name: '100条套餐', credits: 100, priceCents: 129900, packType: PackType.PACK_100 },
} as const

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name)

  constructor(
    @InjectModel(PaymentOrder.name) private readonly orderModel: Model<PaymentOrder>,
    @InjectModel(VideoPack.name) private readonly videoPackModel: Model<VideoPack>,
    private readonly billingService: BillingService,
    private readonly distributionService: DistributionService,
  ) {}

  /**
   * Get available products
   */
  getProducts() {
    return Object.entries(PRODUCTS).map(([key, p]) => ({
      id: key,
      name: p.name,
      credits: p.credits,
      price: p.priceCents / 100,
      priceCents: p.priceCents,
    }))
  }

  /**
   * Create payment order via XorPay
   */
  async createOrder(userId: string, productId: string, channel: PaymentChannel) {
    const product = PRODUCTS[productId as keyof typeof PRODUCTS]
    if (!product) {
      throw new BadRequestException(`Unknown product: ${productId}`)
    }

    const orderNo = this.billingService.generateOrderNo()

    const order = await this.orderModel.create({
      orderNo,
      userId,
      amountCents: product.priceCents,
      status: PaymentStatus.PENDING,
      channel,
      productName: product.name,
      productId,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 min expiry
    })

    // TODO: Call XorPay API to create payment
    // const xorpayResult = await this.callXorPay(order)
    // order.xorpayTradeNo = xorpayResult.trade_no
    // order.xorpayPayUrl = xorpayResult.pay_url
    // await order.save()

    this.logger.log(`Order created: ${orderNo}, product: ${productId}, amount: ¥${product.priceCents / 100}`)

    return {
      orderNo: order.orderNo,
      amount: product.priceCents / 100,
      productName: product.name,
      // payUrl: order.xorpayPayUrl, // TODO: from XorPay
      expiresAt: order.expiresAt,
    }
  }

  /**
   * XorPay payment callback
   * Verify signature, create video pack
   */
  async handleCallback(data: {
    aoid: string
    order_id: string
    pay_price: string
    sign: string
  }) {
    // Verify MD5 signature
    const secret = process.env['XORPAY_SECRET'] || ''
    const signStr = `${data.aoid}${data.order_id}${data.pay_price}${secret}`
    const expectedSign = createHash('md5').update(signStr).digest('hex')

    if (data.sign !== expectedSign) {
      this.logger.error(`Invalid callback signature for order ${data.order_id}`)
      throw new BadRequestException('Invalid signature')
    }

    // Find and validate order
    const order = await this.orderModel.findOne({ orderNo: data.order_id }).exec()
    if (!order) {
      throw new BadRequestException('Order not found')
    }

    if (order.status === PaymentStatus.PAID) {
      return { success: true, message: 'Already processed' } // Idempotent
    }

    // Verify amount consistency
    const paidCents = Math.round(parseFloat(data.pay_price) * 100)
    if (paidCents !== order.amountCents) {
      this.logger.error(`Amount mismatch: paid ${paidCents} vs expected ${order.amountCents}`)
      throw new BadRequestException('Amount mismatch')
    }

    // Update order status
    const paidOrder = await this.orderModel.findByIdAndUpdate(order._id, {
      status: PaymentStatus.PAID,
      paidAt: new Date(),
      xorpayTradeNo: data.aoid,
      callbackData: data,
    }, { new: true }).exec()

    // Create video pack
    const product = PRODUCTS[order.productId as keyof typeof PRODUCTS]
    if (product) {
      await this.videoPackModel.create({
        userId: order.userId,
        orgId: order.orgId,
        packType: product.packType,
        totalCredits: product.credits,
        remainingCredits: product.credits,
        priceCents: product.priceCents,
        status: PackStatus.ACTIVE,
        purchasedAt: new Date(),
        expiresAt: null, // Individual packs don't expire
        paymentOrderId: order.orderNo,
      })

      this.logger.log(`Video pack created for user ${order.userId}: ${product.credits} credits`)
    }

    if (paidOrder) {
      await this.distributionService.notifyPaymentSuccess(paidOrder)
    }

    return { success: true }
  }

  /**
   * Get order status
   */
  async getOrderStatus(orderNo: string) {
    const order = await this.orderModel.findOne({ orderNo }).exec()
    if (!order) throw new BadRequestException('Order not found')
    return {
      orderNo: order.orderNo,
      status: order.status,
      amount: order.amountCents / 100,
      productName: order.productName,
      paidAt: order.paidAt,
    }
  }
}
