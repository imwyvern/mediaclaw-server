import { createHash } from 'node:crypto'
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import {
  Invoice,
  InvoiceStatus,
  NotificationEvent,
  PackStatus,
  PaymentOrder,
  PaymentProductType,
  PaymentStatus,
  RefundExecutionMode,
  RefundRequest,
  RefundRequestStatus,
  Subscription,
  SubscriptionStatus,
  UserRole,
  userRoleSatisfies,
  VideoPack,
} from '@yikart/mongodb'
import axios from 'axios'
import { Model, Types } from 'mongoose'
import { NotificationService } from '../notification/notification.service'
import {
  CreateRefundRequestDto,
  ListRefundRequestQueryDto,
  ReviewRefundRequestDto,
} from './payment.dto'

interface RefundActor {
  id: string
  orgId?: string | null
  role?: UserRole
}

interface PaymentOrderRecord {
  _id: unknown
  orderId: string
  orgId?: unknown
  userId: string
  amount: number
  currency?: string
  status: PaymentStatus
  productType: PaymentProductType
  xorpayOrderId?: string | null
  metadata?: Record<string, unknown> | null
}

interface RefundRequestRecord {
  _id: unknown
  requestId: string
  paymentOrderId: unknown
  orderId: string
  orgId?: unknown
  userId: string
  amount: number
  currency?: string
  reason: string
  description?: string
  status: RefundRequestStatus
  requestedBy: string
  requestedAt: Date
  reviewedBy?: string | null
  reviewedAt?: Date | null
  reviewComment?: string
  executedBy?: string | null
  executedAt?: Date | null
  executionMode?: RefundExecutionMode | null
  executionResult?: Record<string, unknown> | null
  executionError?: string
  notifiedAt?: Date | null
  notificationEvent?: string
  notificationError?: string
  metadata?: Record<string, unknown> | null
  createdAt?: Date | null
  updatedAt?: Date | null
}

@Injectable()
export class RefundRequestService {
  constructor(
    @InjectModel(PaymentOrder.name)
    private readonly orderModel: Model<PaymentOrder>,
    @InjectModel(RefundRequest.name)
    private readonly refundRequestModel: Model<RefundRequest>,
    @InjectModel(VideoPack.name)
    private readonly videoPackModel: Model<VideoPack>,
    @InjectModel(Subscription.name)
    private readonly subscriptionModel: Model<Subscription>,
    @InjectModel(Invoice.name)
    private readonly invoiceModel: Model<Invoice>,
    private readonly notificationService: NotificationService,
  ) {}

  async create(user: RefundActor, body: CreateRefundRequestDto) {
    const order = await this.findOrderOrFail(body.orderId)
    if (!this.canAccessOrder(order, user)) {
      throw new NotFoundException('Order not found')
    }
    if (order.status === PaymentStatus.REFUNDED) {
      throw new BadRequestException('Order already refunded')
    }
    if (order.status !== PaymentStatus.PAID) {
      throw new BadRequestException('Only paid orders can request refund')
    }

    const amount = Number(body.amount || 0)
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new BadRequestException('amount must be a positive integer')
    }
    if (amount > Number(order.amount || 0)) {
      throw new BadRequestException('refund amount cannot exceed order amount')
    }

    const existing = await this.refundRequestModel.findOne({
      orderId: order.orderId,
      status: { $in: [RefundRequestStatus.PENDING, RefundRequestStatus.APPROVED, RefundRequestStatus.PROCESSING] },
    }).lean().exec()
    if (existing) {
      throw new BadRequestException('A refund request is already in progress for this order')
    }

    const created = await this.refundRequestModel.create({
      paymentOrderId: order._id,
      orderId: order.orderId,
      orgId: this.toObjectId(this.stringifyId(order.orgId)),
      userId: order.userId,
      amount,
      currency: order.currency || 'CNY',
      reason: body.reason.trim(),
      description: body.description?.trim() || '',
      status: RefundRequestStatus.PENDING,
      requestedBy: user.id,
      requestedAt: new Date(),
      metadata: {
        source: 'api',
      },
    })

    const payload = this.buildNotificationPayload(order, created.toObject())
    await this.safeNotify(this.stringifyId(order.orgId), NotificationEvent.PAYMENT_REFUND_REQUESTED, payload)

    return this.toResponse(created.toObject())
  }

  async list(user: RefundActor, query: ListRefundRequestQueryDto) {
    const page = query.page && query.page > 0 ? query.page : 1
    const limit = Math.min(query.limit && query.limit > 0 ? query.limit : 20, 100)
    const skip = (page - 1) * limit
    const filters: Record<string, unknown> = {}

    if (query.status) {
      filters['status'] = query.status
    }

    const canReadOrgScope = userRoleSatisfies(user.role, UserRole.ENTERPRISE_ADMIN) && user.orgId
    if (canReadOrgScope) {
      filters['orgId'] = this.toObjectId(user.orgId)
    }
    else {
      filters['userId'] = user.id
    }

    const [items, total] = await Promise.all([
      this.refundRequestModel.find(filters)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.refundRequestModel.countDocuments(filters).exec(),
    ])

    return {
      items: items.map(item => this.toResponse(item)),
      pagination: {
        page,
        limit,
        total,
        totalPages: total > 0 ? Math.ceil(total / limit) : 0,
      },
    }
  }

  async review(user: RefundActor, requestId: string, body: ReviewRefundRequestDto) {
    if (!userRoleSatisfies(user.role, UserRole.ENTERPRISE_ADMIN)) {
      throw new ForbiddenException('Only admins can review refund requests')
    }

    const request = await this.findRefundRequestOrFail(requestId)
    const requestOrgId = this.stringifyId(request.orgId)
    if (!requestOrgId || !user.orgId || requestOrgId !== user.orgId) {
      throw new NotFoundException('Refund request not found')
    }
    if (request.status !== RefundRequestStatus.PENDING) {
      throw new BadRequestException('Refund request is not pending review')
    }

    const reviewedAt = new Date()
    const reviewComment = body.comment?.trim() || ''

    if (body.action === 'reject') {
      const rejected = await this.refundRequestModel.findByIdAndUpdate(
        request._id,
        {
          $set: {
            status: RefundRequestStatus.REJECTED,
            reviewedBy: user.id,
            reviewedAt,
            reviewComment,
          },
        },
        { new: true },
      ).lean().exec()

      if (!rejected) {
        throw new NotFoundException('Refund request not found')
      }

      await this.notifyRequester(rejected, NotificationEvent.PAYMENT_REFUND_REJECTED)
      return this.toResponse(rejected)
    }

    const approved = await this.refundRequestModel.findByIdAndUpdate(
      request._id,
      {
        $set: {
          status: RefundRequestStatus.APPROVED,
          reviewedBy: user.id,
          reviewedAt,
          reviewComment,
        },
      },
      { new: true },
    ).lean().exec()

    if (!approved) {
      throw new NotFoundException('Refund request not found')
    }

    return this.executeApprovedRequest(approved, user.id)
  }

  private async executeApprovedRequest(request: RefundRequestRecord, executedBy: string) {
    const order = await this.orderModel.findOne({ orderId: request.orderId }).lean().exec()
    if (!order) {
      throw new NotFoundException('Order not found')
    }

    await this.refundRequestModel.findByIdAndUpdate(request._id, {
      $set: {
        status: RefundRequestStatus.PROCESSING,
      },
    }).exec()

    const executedAt = new Date()

    try {
      const execution = await this.executeRefund(order, request)
      await this.revokeOrderBenefits(order)
      await this.markOrderRefunded(order, request, execution, executedAt)

      const refunded = await this.refundRequestModel.findByIdAndUpdate(
        request._id,
        {
          $set: {
            status: RefundRequestStatus.REFUNDED,
            executedBy,
            executedAt,
            executionMode: execution.mode,
            executionResult: execution.result,
            executionError: '',
          },
        },
        { new: true },
      ).lean().exec()

      if (!refunded) {
        throw new NotFoundException('Refund request not found')
      }

      await this.notifyRequester(refunded, NotificationEvent.PAYMENT_REFUNDED)
      return this.toResponse(refunded)
    }
    catch (error) {
      await this.refundRequestModel.findByIdAndUpdate(
        request._id,
        {
          $set: {
            status: RefundRequestStatus.FAILED,
            executedBy,
            executedAt,
            executionError: error instanceof Error ? error.message : String(error),
          },
        },
      ).exec()

      throw error
    }
  }

  private async executeRefund(order: PaymentOrderRecord, request: RefundRequestRecord) {
    const refundUrl = process.env['XORPAY_REFUND_URL'] || ''
    if (!refundUrl) {
      return {
        mode: RefundExecutionMode.MANUAL,
        result: {
          provider: 'manual',
          reason: 'xorpay_refund_endpoint_not_configured',
          refundedAt: new Date().toISOString(),
        },
      }
    }

    const payload = {
      app_id: process.env['XORPAY_APP_ID'] || '',
      order_id: order.orderId,
      trade_no: order.xorpayOrderId || '',
      refund_amount: Number((request.amount / 100).toFixed(2)),
      reason: request.reason,
    }

    const response = await axios.post(refundUrl, {
      ...payload,
      sign: this.buildSignature(payload),
    }, {
      timeout: 10_000,
      headers: {
        'content-type': 'application/json',
      },
    })

    return {
      mode: RefundExecutionMode.GATEWAY,
      result: response.data || {},
    }
  }

  private async revokeOrderBenefits(order: PaymentOrderRecord) {
    if (order.productType === PaymentProductType.VIDEO_PACK) {
      await this.videoPackModel.updateMany(
        { paymentOrderId: order.orderId },
        {
          $set: {
            status: PackStatus.REFUNDED,
            remainingCredits: 0,
          },
        },
      ).exec()
      return
    }

    if (order.productType === PaymentProductType.SUBSCRIPTION) {
      const orgId = this.toObjectId(this.stringifyId(order.orgId))
      if (!orgId) {
        return
      }

      const currentSubscription = await this.subscriptionModel.findOne({ orgId })
        .sort({ createdAt: -1 })
        .lean()
        .exec()
      if (!currentSubscription) {
        return
      }

      await this.subscriptionModel.findByIdAndUpdate(currentSubscription._id, {
        $set: {
          status: SubscriptionStatus.CANCELLED,
          autoRenew: false,
        },
      }).exec()
      return
    }

    if (order.productType === PaymentProductType.ADDON) {
      const metadata = this.toPlainObject(order.metadata)
      const invoiceId = typeof metadata['invoiceId'] === 'string' ? metadata['invoiceId'] : ''
      if (!Types.ObjectId.isValid(invoiceId)) {
        return
      }

      await this.invoiceModel.findByIdAndUpdate(invoiceId, {
        $set: {
          status: InvoiceStatus.VOID,
        },
      }).exec()
    }
  }

  private async markOrderRefunded(
    order: PaymentOrderRecord,
    request: RefundRequestRecord,
    execution: {
      mode: RefundExecutionMode
      result: Record<string, unknown>
    },
    executedAt: Date,
  ) {
    const metadata = this.toPlainObject(order.metadata)
    await this.orderModel.findByIdAndUpdate(order._id, {
      $set: {
        status: PaymentStatus.REFUNDED,
        benefitGranted: false,
        metadata: {
          ...metadata,
          refund: {
            requestId: request.requestId,
            amount: request.amount,
            reason: request.reason,
            reviewedBy: request.reviewedBy || '',
            reviewedAt: request.reviewedAt || null,
            executedAt: executedAt.toISOString(),
            executionMode: execution.mode,
            executionResult: execution.result,
          },
        },
      },
    }).exec()
  }

  private async notifyRequester(
    request: RefundRequestRecord,
    event: NotificationEvent.PAYMENT_REFUNDED | NotificationEvent.PAYMENT_REFUND_REJECTED,
  ) {
    const payload = this.buildNotificationPayload(undefined, request)
    const targetId = request.userId

    try {
      await this.notificationService.send(targetId, event, payload)
      await this.refundRequestModel.findByIdAndUpdate(request._id, {
        $set: {
          notifiedAt: new Date(),
          notificationEvent: event,
          notificationError: '',
        },
      }).exec()
    }
    catch (error) {
      await this.refundRequestModel.findByIdAndUpdate(request._id, {
        $set: {
          notificationEvent: event,
          notificationError: error instanceof Error ? error.message : String(error),
        },
      }).exec()
    }
  }

  private async safeNotify(orgId: string | null, event: NotificationEvent, payload: Record<string, unknown>) {
    if (!orgId) {
      return
    }

    try {
      await this.notificationService.send(orgId, event, payload)
    }
    catch {

    }
  }

  private async findOrderOrFail(orderId: string) {
    const order = await this.orderModel.findOne({ orderId: orderId.trim() }).lean().exec()
    if (!order) {
      throw new NotFoundException('Order not found')
    }

    return order as PaymentOrderRecord
  }

  private async findRefundRequestOrFail(requestId: string) {
    const query = Types.ObjectId.isValid(requestId)
      ? {
          $or: [
            { _id: new Types.ObjectId(requestId) },
            { requestId },
          ],
        }
      : { requestId }

    const request = await this.refundRequestModel.findOne(query).lean().exec()
    if (!request) {
      throw new NotFoundException('Refund request not found')
    }

    return request as RefundRequestRecord
  }

  private canAccessOrder(order: PaymentOrderRecord, user: RefundActor) {
    if (order.userId === user.id) {
      return true
    }

    if (!userRoleSatisfies(user.role, UserRole.ENTERPRISE_ADMIN)) {
      return false
    }

    const orderOrgId = this.stringifyId(order.orgId)
    return Boolean(orderOrgId && user.orgId && orderOrgId === user.orgId)
  }

  private buildNotificationPayload(
    order: PaymentOrderRecord | undefined,
    request: RefundRequestRecord,
  ) {
    return {
      relatedId: request.requestId,
      requestId: request.requestId,
      orderId: request.orderId,
      amount: request.amount,
      currency: request.currency || order?.currency || 'CNY',
      reason: request.reason,
      reviewComment: request.reviewComment || '',
      status: request.status,
      requestedAt: request.requestedAt,
      reviewedAt: request.reviewedAt || null,
      executedAt: request.executedAt || null,
    }
  }

  private toResponse(request: RefundRequestRecord) {
    return {
      id: this.stringifyId(request._id) || '',
      requestId: request.requestId,
      orderId: request.orderId,
      orgId: this.stringifyId(request.orgId),
      userId: request.userId,
      amount: request.amount,
      currency: request.currency || 'CNY',
      reason: request.reason,
      description: request.description || '',
      status: request.status,
      requestedBy: request.requestedBy,
      requestedAt: request.requestedAt,
      approval: {
        reviewedBy: request.reviewedBy || null,
        reviewedAt: request.reviewedAt || null,
        comment: request.reviewComment || '',
      },
      execution: {
        executedBy: request.executedBy || null,
        executedAt: request.executedAt || null,
        mode: request.executionMode || null,
        result: this.toPlainObject(request.executionResult),
        error: request.executionError || '',
      },
      notification: {
        event: request.notificationEvent || '',
        notifiedAt: request.notifiedAt || null,
        error: request.notificationError || '',
      },
      metadata: this.toPlainObject(request.metadata),
      createdAt: request.createdAt || null,
      updatedAt: request.updatedAt || null,
    }
  }

  private buildSignature(payload: Record<string, unknown>) {
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

  private toObjectId(value?: string | null) {
    if (!value || !Types.ObjectId.isValid(value)) {
      return null
    }

    return new Types.ObjectId(value)
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

  private toPlainObject(value: Record<string, unknown> | undefined | null) {
    return value ? { ...value } : {}
  }
}
