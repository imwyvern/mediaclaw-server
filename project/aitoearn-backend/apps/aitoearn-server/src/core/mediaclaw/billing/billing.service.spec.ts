import { PackStatus } from '@yikart/mongodb'
import { vi } from 'vitest'
import { BillingService } from './billing.service'

vi.mock('@yikart/mongodb', () => {
  class PaymentOrder {}
  class VideoPack {}

  return {
    PackStatus: {
      ACTIVE: 'active',
      DEPLETED: 'depleted',
      EXPIRED: 'expired',
      REFUNDED: 'refunded',
    },
    PaymentOrder,
    VideoPack,
  }
})

function createQuery<T>(value: T) {
  const query = {
    sort: vi.fn(),
    exec: vi.fn().mockResolvedValue(value),
  }

  query.sort.mockReturnValue(query)

  return query
}

describe('billingService', () => {
  let service: BillingService
  let videoPackModel: Record<string, any>
  let paymentOrderModel: Record<string, any>

  beforeEach(() => {
    videoPackModel = {
      findOne: vi.fn(),
      findOneAndUpdate: vi.fn(),
      findByIdAndUpdate: vi.fn(),
    }

    paymentOrderModel = {}

    service = new BillingService(
      videoPackModel as any,
      paymentOrderModel as any,
    )
  })

  it('应按 FIFO 从最早可用套餐扣减 credits', async () => {
    const availablePack = {
      _id: 'pack-oldest',
      remainingCredits: 4,
      purchasedAt: new Date('2026-03-01T00:00:00.000Z'),
      status: PackStatus.ACTIVE,
    }
    const existingChargeQuery = createQuery(null)
    const availablePackQuery = createQuery(availablePack)

    videoPackModel.findOne
      .mockReturnValueOnce(existingChargeQuery)
      .mockReturnValueOnce(availablePackQuery)
    videoPackModel.findOneAndUpdate.mockReturnValue(createQuery({
      ...availablePack,
      remainingCredits: 3,
    }))

    await expect(service.deductCredit('user-1', 'task-1')).resolves.toBe(true)
    expect(availablePackQuery.sort).toHaveBeenCalledWith({ purchasedAt: 1 })
    expect(videoPackModel.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: 'pack-oldest',
        remainingCredits: { $gte: 1 },
      },
      {
        $inc: { remainingCredits: -1 },
      },
      { new: true },
    )
  })

  it('应保证同一任务重复扣费时幂等', async () => {
    videoPackModel.findOne.mockReturnValue(createQuery({
      _id: 'existing-charge',
      metadata: { taskId: 'task-1' },
    }))

    await expect(service.deductCredit('user-1', 'task-1')).resolves.toBe(true)
    expect(videoPackModel.findOneAndUpdate).not.toHaveBeenCalled()
  })

  it('应在 credits 不足时返回失败', async () => {
    videoPackModel.findOne
      .mockReturnValueOnce(createQuery(null))
      .mockReturnValueOnce(createQuery(null))

    await expect(service.deductCredit('user-1', 'task-1', 2)).resolves.toBe(false)
    expect(videoPackModel.findOneAndUpdate).not.toHaveBeenCalled()
  })
})
