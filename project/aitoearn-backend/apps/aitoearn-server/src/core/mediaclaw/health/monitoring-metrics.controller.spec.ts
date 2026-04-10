import { describe, expect, it, vi } from 'vitest'
import { MonitoringMetricsController } from './monitoring-metrics.controller'

describe('monitoringMetricsController', () => {
  it('应返回 Prometheus metrics 文本', async () => {
    const service = {
      renderPrometheusMetrics: vi.fn().mockResolvedValue('http_requests_total 1'),
    }

    const controller = new MonitoringMetricsController(service as any)
    await expect(controller.getMetrics()).resolves.toBe('http_requests_total 1')
    expect(service.renderPrometheusMetrics).toHaveBeenCalledTimes(1)
  })
})
