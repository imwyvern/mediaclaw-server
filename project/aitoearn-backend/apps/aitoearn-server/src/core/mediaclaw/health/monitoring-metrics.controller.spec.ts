import { GUARDS_METADATA } from '@nestjs/common/constants'
import { ThrottlerGuard } from '@nestjs/throttler'
import { describe, expect, it, vi } from 'vitest'
import { MonitoringMetricsController } from './monitoring-metrics.controller'

describe('monitoringMetricsController', () => {
  it('应为 metrics 端点启用节流保护', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, MonitoringMetricsController) as Array<unknown>

    expect(guards).toContain(ThrottlerGuard)
  })

  it('应返回 Prometheus metrics 文本', async () => {
    const service = {
      renderPrometheusMetrics: vi.fn().mockResolvedValue('http_requests_total 1'),
    }

    const controller = new MonitoringMetricsController(service as any)
    await expect(controller.getMetrics()).resolves.toBe('http_requests_total 1')
    expect(service.renderPrometheusMetrics).toHaveBeenCalledTimes(1)
  })
})
