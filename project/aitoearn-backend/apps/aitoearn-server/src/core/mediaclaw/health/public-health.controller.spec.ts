import { GUARDS_METADATA } from '@nestjs/common/constants'
import { ThrottlerGuard } from '@nestjs/throttler'
import { describe, expect, it, vi } from 'vitest'
import { PublicHealthController } from './public-health.controller'

describe('publicHealthController', () => {
  it('应为公开健康检查启用节流保护', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, PublicHealthController) as Array<unknown>

    expect(guards).toContain(ThrottlerGuard)
  })

  it('应返回公开健康状态', async () => {
    const service = {
      getPublicStatus: vi.fn().mockResolvedValue({ status: 'ok' }),
    }

    const controller = new PublicHealthController(service as any)
    await expect(controller.check()).resolves.toEqual({ status: 'ok' })
    expect(service.getPublicStatus).toHaveBeenCalledTimes(1)
  })
})
