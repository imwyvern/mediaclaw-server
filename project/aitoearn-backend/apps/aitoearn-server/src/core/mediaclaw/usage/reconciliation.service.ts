import { Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Cron } from '@nestjs/schedule'
import { UsageHistory, UsageHistoryType, VideoPack } from '@yikart/mongodb'
import { Model, Types } from 'mongoose'

@Injectable()
export class UsageReconciliationService {
  private readonly logger = new Logger(UsageReconciliationService.name)

  constructor(
    @InjectModel(UsageHistory.name)
    private readonly usageHistoryModel: Model<UsageHistory>,
    @InjectModel(VideoPack.name)
    private readonly videoPackModel: Model<VideoPack>,
  ) {}

  @Cron('0 2 * * *')
  async reconcileDailyUsage() {
    const targetDate = new Date()
    targetDate.setUTCDate(targetDate.getUTCDate() - 1)
    await this.reconcileForDate(targetDate)
  }

  async reconcileForDate(date: Date) {
    const start = new Date(Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      0,
      0,
      0,
      0,
    ))
    const end = new Date(Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      23,
      59,
      59,
      999,
    ))

    const dailyHistories = await this.usageHistoryModel.find({
      type: { $in: [UsageHistoryType.VIDEO_CHARGE, UsageHistoryType.VIDEO_REFUND] },
      packId: { $ne: null },
      createdAt: { $gte: start, $lte: end },
    }).lean().exec()

    const packIds = [...new Set(
      dailyHistories
        .map(history => history.packId?.toString?.() || null)
        .filter((value): value is string => Boolean(value && Types.ObjectId.isValid(value))),
    )]

    if (packIds.length === 0) {
      return {
        date: start.toISOString().slice(0, 10),
        checkedPacks: 0,
        mismatches: 0,
      }
    }

    const objectIds = packIds.map(id => new Types.ObjectId(id))
    const [histories, packs] = await Promise.all([
      this.usageHistoryModel.find({
        type: { $in: [UsageHistoryType.VIDEO_CHARGE, UsageHistoryType.VIDEO_REFUND] },
        packId: { $in: objectIds },
      }).lean().exec(),
      this.videoPackModel.find({
        _id: { $in: objectIds },
      }).lean().exec(),
    ])

    const consumedByPack = new Map<string, number>()
    for (const history of histories) {
      if (!history['packId']) {
        continue
      }

      const packId = history['packId'].toString()
      const credits = Number(history['creditsConsumed'] || 0)
      const signedCredits = history['type'] === UsageHistoryType.VIDEO_REFUND ? -credits : credits
      consumedByPack.set(packId, (consumedByPack.get(packId) || 0) + signedCredits)
    }

    let mismatches = 0
    for (const pack of packs) {
      const packId = pack._id.toString()
      const consumed = Math.max(consumedByPack.get(packId) || 0, 0)
      const expectedRemaining = Math.max(Number(pack.totalCredits || 0) - consumed, 0)
      const actualRemaining = Number(pack.remainingCredits || 0)
      const diff = Math.abs(expectedRemaining - actualRemaining)

      if (diff > 1) {
        mismatches += 1
        this.logger.warn(JSON.stringify({
          message: 'Usage reconciliation mismatch detected',
          date: start.toISOString().slice(0, 10),
          packId,
          expectedRemaining,
          actualRemaining,
          diff,
        }))
      }
    }

    return {
      date: start.toISOString().slice(0, 10),
      checkedPacks: packs.length,
      mismatches,
    }
  }
}
