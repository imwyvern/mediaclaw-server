import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DISTRIBUTION_JOB_DISPATCH_COMPLETED,
  DISTRIBUTION_JOB_EXPIRE_STALE,
} from './distribution.queue.constants'
import { DistributionWorker } from './distribution.worker'

describe('distributionWorker', () => {
  let distributionService: Record<string, any>
  let worker: DistributionWorker

  beforeEach(() => {
    distributionService = {
      processCompletedTask: vi.fn().mockResolvedValue({
        taskId: 'task-1',
        notified: true,
      }),
      expireStaleDistributions: vi.fn().mockResolvedValue({
        total: 2,
      }),
    }

    worker = new DistributionWorker(distributionService as any)
  })

  it('应处理生产完成后的分发任务', async () => {
    const result = await worker.process({
      name: DISTRIBUTION_JOB_DISPATCH_COMPLETED,
      data: {
        taskId: 'task-1',
      },
    } as any)

    expect(distributionService.processCompletedTask).toHaveBeenCalledWith('task-1')
    expect(result).toEqual({
      taskId: 'task-1',
      notified: true,
    })
  })

  it('应处理过期分发巡检任务', async () => {
    const result = await worker.process({
      name: DISTRIBUTION_JOB_EXPIRE_STALE,
      data: {
        trigger: 'scheduled',
      },
    } as any)

    expect(distributionService.expireStaleDistributions).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      total: 2,
    })
  })

  it('应拒绝缺少 taskId 的完成任务', async () => {
    await expect(worker.process({
      name: DISTRIBUTION_JOB_DISPATCH_COMPLETED,
      data: {},
    } as any)).rejects.toThrow('distribution dispatch job requires taskId')
  })
})
