import { Types } from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@yikart/mongodb', () => {
  class ApiUsage {}
  class Brand {}
  class Organization {}
  class Subscription {}
  class UsageHistory {}
  class VideoPack {}
  class VideoTask {}

  return {
    ApiUsage,
    Brand,
    Organization,
    Subscription,
    UsageHistory,
    VideoPack,
    VideoTask,
    PackStatus: {
      ACTIVE: 'ACTIVE',
      DEPLETED: 'DEPLETED',
      EXPIRED: 'EXPIRED',
      REFUNDED: 'REFUNDED',
    },
    SubscriptionStatus: {
      ACTIVE: 'ACTIVE',
    },
    UsageHistoryType: {
      VIDEO_CHARGE: 'video_charge',
      VIDEO_REFUND: 'video_refund',
      TOKEN_USAGE: 'token_usage',
      COPY_GENERATION: 'copy_generation',
      VIRAL_ANALYSIS: 'viral_analysis',
      REMIX_BRIEF: 'remix_brief',
    },
  }
})

import { PackStatus, UsageHistoryType } from '@yikart/mongodb'
import { InsufficientCreditsError, UsageService } from './usage.service'

function createQuery<T>(value: T) {
  const query = {
    lean: vi.fn(),
    limit: vi.fn(),
    select: vi.fn(),
    skip: vi.fn(),
    sort: vi.fn(),
    exec: vi.fn().mockResolvedValue(value),
  }

  query.lean.mockReturnValue(query)
  query.limit.mockReturnValue(query)
  query.select.mockReturnValue(query)
  query.skip.mockReturnValue(query)
  query.sort.mockReturnValue(query)

  return query
}

describe('UsageService', () => {
  const userId = '507f1f77bcf86cd799439011'
  const orgId = '507f1f77bcf86cd799439012'
  const taskId = '507f1f77bcf86cd799439013'

  let service: UsageService
  let usageHistoryModel: Record<string, any>
  let videoPackModel: Record<string, any>

  beforeEach(() => {
    usageHistoryModel = {
      countDocuments: vi.fn().mockResolvedValue(0),
      create: vi.fn(),
      find: vi.fn(),
      findById: vi.fn(),
      findByIdAndDelete: vi.fn(),
      findByIdAndUpdate: vi.fn(),
      findOne: vi.fn(),
      findOneAndUpdate: vi.fn(),
    }

    videoPackModel = {
      find: vi.fn(),
      findById: vi.fn(),
      findByIdAndUpdate: vi.fn(),
      findOneAndUpdate: vi.fn(),
    }

    service = new UsageService(
      {} as any,
      {} as any,
      {} as any,
      usageHistoryModel as any,
      videoPackModel as any,
      {} as any,
      {} as any,
    )
  })

  it('应按 FIFO 跨多个套餐扣减视频 credits 并记录分摊明细', async () => {
    const packIdA = '507f1f77bcf86cd799439014'
    const packIdB = '507f1f77bcf86cd799439015'
    const usageHistoryIdA = '507f1f77bcf86cd799439016'
    const usageHistoryIdB = '507f1f77bcf86cd799439017'

    const packs = [
      {
        _id: new Types.ObjectId(packIdA),
        remainingCredits: 1,
        totalCredits: 2,
        status: PackStatus.ACTIVE,
        purchasedAt: new Date('2026-03-01T00:00:00.000Z'),
        expiresAt: null,
      },
      {
        _id: new Types.ObjectId(packIdB),
        remainingCredits: 5,
        totalCredits: 5,
        status: PackStatus.ACTIVE,
        purchasedAt: new Date('2026-03-05T00:00:00.000Z'),
        expiresAt: null,
      },
    ]

    usageHistoryModel.find.mockReturnValueOnce(createQuery([]))
    videoPackModel.find.mockReturnValueOnce(createQuery(packs))
    videoPackModel.findOneAndUpdate
      .mockReturnValueOnce(createQuery({
        _id: new Types.ObjectId(packIdA),
        remainingCredits: 0,
        totalCredits: 2,
        status: PackStatus.DEPLETED,
        expiresAt: null,
      }))
      .mockReturnValueOnce(createQuery({
        _id: new Types.ObjectId(packIdB),
        remainingCredits: 4,
        totalCredits: 5,
        status: PackStatus.ACTIVE,
        expiresAt: null,
      }))
    usageHistoryModel.create
      .mockResolvedValueOnce({ _id: new Types.ObjectId(usageHistoryIdA) })
      .mockResolvedValueOnce({ _id: new Types.ObjectId(usageHistoryIdB) })
    videoPackModel.findById
      .mockReturnValueOnce(createQuery({
        _id: new Types.ObjectId(packIdA),
        remainingCredits: 0,
        totalCredits: 2,
        status: PackStatus.DEPLETED,
        expiresAt: null,
      }))
      .mockReturnValueOnce(createQuery({
        _id: new Types.ObjectId(packIdB),
        remainingCredits: 4,
        totalCredits: 5,
        status: PackStatus.ACTIVE,
        expiresAt: null,
      }))

    const result = await service.chargeVideo(userId, orgId, 30, {
      videoTaskId: taskId,
      metadata: { sourceType: 'url' },
    })

    expect(result).toEqual({
      usageHistoryId: usageHistoryIdA,
      usageHistoryIds: [usageHistoryIdA, usageHistoryIdB],
      packId: packIdA,
      packIds: [packIdA, packIdB],
      units: 2,
      allocations: [
        { packId: packIdA, usageHistoryId: usageHistoryIdA, units: 1 },
        { packId: packIdB, usageHistoryId: usageHistoryIdB, units: 1 },
      ],
    })
    expect(videoPackModel.find).toHaveBeenCalledWith(expect.objectContaining({
      orgId: expect.any(Types.ObjectId),
      status: { $in: [PackStatus.ACTIVE, PackStatus.DEPLETED] },
      remainingCredits: { $gt: 0 },
    }))
    expect(videoPackModel.findOneAndUpdate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        _id: packs[0]._id,
        remainingCredits: { $gte: 1 },
      }),
      { $inc: { remainingCredits: -1 } },
      { new: true },
    )
    expect(videoPackModel.findOneAndUpdate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        _id: packs[1]._id,
        remainingCredits: { $gte: 1 },
      }),
      { $inc: { remainingCredits: -1 } },
      { new: true },
    )
    expect(usageHistoryModel.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: UsageHistoryType.VIDEO_CHARGE,
        creditsConsumed: 1,
        packId: expect.any(Types.ObjectId),
      }),
    )
    expect(usageHistoryModel.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: UsageHistoryType.VIDEO_CHARGE,
        creditsConsumed: 1,
        packId: expect.any(Types.ObjectId),
      }),
    )
  })

  it('应在 credits 不足时抛出 InsufficientCreditsError', async () => {
    usageHistoryModel.find.mockReturnValueOnce(createQuery([]))
    videoPackModel.find.mockReturnValueOnce(createQuery([]))

    await expect(service.chargeVideo(userId, orgId, 60, { videoTaskId: taskId }))
      .rejects
      .toBeInstanceOf(InsufficientCreditsError)
    expect(usageHistoryModel.create).not.toHaveBeenCalled()
  })

  it('应为单条扣费记录创建退款记录并恢复套餐余额', async () => {
    const packId = '507f1f77bcf86cd799439018'
    const chargeUsageHistoryId = '507f1f77bcf86cd799439019'
    const refundUsageHistoryId = '507f1f77bcf86cd799439020'

    usageHistoryModel.findById.mockReturnValueOnce(createQuery({
      _id: new Types.ObjectId(chargeUsageHistoryId),
      userId: new Types.ObjectId(userId),
      orgId: new Types.ObjectId(orgId),
      videoTaskId: new Types.ObjectId(taskId),
      type: UsageHistoryType.VIDEO_CHARGE,
      creditsConsumed: 2,
      packId: new Types.ObjectId(packId),
      metadata: { sourceType: 'url' },
    }))
    usageHistoryModel.findOne.mockReturnValueOnce(createQuery(null))
    videoPackModel.findByIdAndUpdate.mockReturnValueOnce(createQuery({
      _id: new Types.ObjectId(packId),
      remainingCredits: 3,
      totalCredits: 5,
      status: PackStatus.ACTIVE,
      expiresAt: null,
    }))
    videoPackModel.findById
      .mockReturnValueOnce(createQuery({
        _id: new Types.ObjectId(packId),
        remainingCredits: 3,
        totalCredits: 5,
        status: PackStatus.ACTIVE,
        expiresAt: null,
      }))
      .mockReturnValueOnce(createQuery({
        _id: new Types.ObjectId(packId),
        remainingCredits: 3,
        totalCredits: 5,
        status: PackStatus.ACTIVE,
        expiresAt: null,
      }))
    usageHistoryModel.create.mockResolvedValueOnce({
      _id: new Types.ObjectId(refundUsageHistoryId),
    })

    const result = await service.refundVideo(chargeUsageHistoryId, {
      reason: 'task_failed',
    })

    expect(result).toEqual({
      refunded: true,
      usageHistoryId: chargeUsageHistoryId,
      refundUsageHistoryId,
      packId,
      units: 2,
    })
    expect(videoPackModel.findByIdAndUpdate).toHaveBeenCalledWith(
      expect.any(Types.ObjectId),
      { $inc: { remainingCredits: 2 } },
      { new: true },
    )
    expect(usageHistoryModel.create).toHaveBeenCalledWith(expect.objectContaining({
      type: UsageHistoryType.VIDEO_REFUND,
      creditsConsumed: 2,
      metadata: expect.objectContaining({
        reason: 'task_failed',
        chargeUsageHistoryId,
        refundedAt: expect.any(String),
      }),
    }))
  })
})
