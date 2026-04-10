import client from 'prom-client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MonitoringMetricsService } from './monitoring-metrics.service'

describe('monitoringMetricsService behavior', () => {
  let appMock: Record<string, any>
  let queue: Record<string, any>
  let service: MonitoringMetricsService
  let middleware: ((request: any, response: any, next: () => void) => void) | undefined

  beforeEach(() => {
    client.register.clear()

    appMock = {
      use: vi.fn((handler: (request: any, response: any, next: () => void) => void) => {
        middleware = handler
      }),
    }
    queue = {
      getJobCounts: vi.fn().mockResolvedValue({
        waiting: 3,
        active: 1,
        delayed: 2,
        prioritized: 0,
      }),
      getJobs: vi.fn().mockResolvedValue([
        {
          timestamp: Date.now() - 15_000,
        },
        {
          timestamp: Date.now() - 5_000,
        },
      ]),
    }

    service = new MonitoringMetricsService(
      {
        httpAdapter: {
          getInstance: () => appMock,
        },
      } as any,
      queue as any,
    )
  })

  afterEach(() => {
    client.register.clear()
    vi.restoreAllMocks()
  })

  it('应采集 HTTP 请求、视频产出和队列指标', async () => {
    service.onApplicationBootstrap()

    expect(appMock.use).toHaveBeenCalledTimes(1)
    expect(middleware).toBeTypeOf('function')

    let finishHandler: (() => void) | undefined
    const response = {
      statusCode: 503,
      on: vi.fn((event: string, handler: () => void) => {
        if (event === 'finish') {
          finishHandler = handler
        }
      }),
    }

    middleware?.(
      {
        method: 'GET',
        baseUrl: '',
        path: '/api/v1/discovery/pool',
        originalUrl: '/api/v1/discovery/pool?limit=2',
      },
      response,
      () => undefined,
    )
    finishHandler?.()

    service.recordVideoProductionCompleted()
    service.recordVideoProductionFailed('quality-check')
    service.recordMongoSlowQuery({
      modelName: 'VideoTask',
      collectionName: 'video_tasks',
      operation: 'find',
      durationMs: 640,
      timestamp: new Date().toISOString(),
    })
    await service.captureQueueMetrics()

    const snapshot = service.getOperationalSnapshot()

    expect(snapshot.http.totalRequests).toBe(1)
    expect(snapshot.http.serverErrors).toBe(1)
    expect(snapshot.http.errorRate).toBe(1)
    expect(snapshot.video.total).toBe(2)
    expect(snapshot.video.failed).toBe(1)
    expect(snapshot.video.failureRate).toBe(0.5)
    expect(snapshot.queue.depth).toBe(6)
    expect(snapshot.queue.latency).toBeGreaterThanOrEqual(15_000)
    expect(snapshot.database.slowQueries).toBe(1)
  })
})
