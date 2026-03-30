import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { VideoPack, PackStatus } from '@yikart/mongodb'
import { PaymentOrder, PaymentStatus } from '@yikart/mongodb'

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name)

  constructor(
    @InjectModel(VideoPack.name) private readonly videoPackModel: Model<VideoPack>,
    @InjectModel(PaymentOrder.name) private readonly paymentOrderModel: Model<PaymentOrder>,
  ) {}

  /**
   * Create trial pack for new user (1 free video)
   */
  async createTrialPack(userId: string) {
    const existing = await this.videoPackModel.findOne({
      userId,
      packType: 'trial_free',
    }).exec()

    if (existing) return existing

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

  /**
   * FIFO credit deduction: consume from oldest active pack first
   * Returns true if deduction succeeded
   */
  async deductCredit(userId: string, taskId: string, credits: number = 1): Promise<boolean> {
    // Idempotent: check if already charged for this task
    const existingCharge = await this.videoPackModel.findOne({
      userId,
      'metadata.taskId': taskId,
    }).exec()

    if (existingCharge) {
      this.logger.warn(`Credit already charged for task ${taskId}`)
      return true
    }

    // FIFO: find oldest active pack with remaining credits
    // Also skip expired packs (P0-1 fix from review)
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
    .sort({ purchasedAt: 1 }) // FIFO: oldest first
    .exec()

    if (!pack) {
      return false // No credits available
    }

    // Atomic deduction
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

    if (!result) return false

    // Mark depleted
    if (result.remainingCredits <= 0) {
      await this.videoPackModel.findByIdAndUpdate(result._id, {
        status: PackStatus.DEPLETED,
      }).exec()
    }

    return true
  }

  /**
   * Restore consumed credits when a task is cancelled before processing.
   */
  async refundCredit(userId: string, credits: number = 1): Promise<boolean> {
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

  /**
   * Get user's credit balance
   */
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

  /**
   * Get user's payment orders
   */
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

  /**
   * Generate unique order number: MC + timestamp + random
   */
  generateOrderNo(): string {
    const ts = Math.floor(Date.now() / 1000).toString()
    const rand = Math.random().toString(36).substring(2, 5).toUpperCase()
    return `MC${ts}${rand}`
  }
}
