import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MonitoringTracingService } from './monitoring-tracing.service'

describe('monitoringTracingService behavior', () => {
  let appMock: Record<string, any>
  let configService: Record<string, any>
  let service: MonitoringTracingService
  let middleware: ((request: any, response: any, next: () => void) => void) | undefined

  beforeEach(() => {
    appMock = {
      use: vi.fn((handler: (request: any, response: any, next: () => void) => void) => {
        middleware = handler
      }),
    }
    configService = {
      getString: vi.fn((key: string | string[], fallback = '') => {
        const normalizedKey = Array.isArray(key) ? key[0] : key
        if (normalizedKey === 'MEDIACLAW_OTEL_SERVICE_NAME') {
          return 'mediaclaw-api'
        }
        if (normalizedKey === 'NODE_ENV') {
          return 'test'
        }
        return fallback
      }),
    }

    service = new MonitoringTracingService(
      {
        httpAdapter: {
          getInstance: () => appMock,
        },
      } as any,
      configService as any,
    )
  })

  afterEach(async () => {
    await service.onModuleDestroy()
    vi.restoreAllMocks()
  })

  it('应挂载 tracing middleware 并回传 traceparent 响应头', () => {
    service.onApplicationBootstrap()

    expect(appMock.use).toHaveBeenCalledTimes(1)
    expect(middleware).toBeTypeOf('function')

    let finishHandler: (() => void) | undefined
    const headers: Record<string, string> = {}
    middleware?.(
      {
        method: 'GET',
        baseUrl: '',
        path: '/api/v1/discovery/pool',
        originalUrl: '/api/v1/discovery/pool?limit=2',
        headers: {
          traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
        },
      },
      {
        statusCode: 200,
        setHeader: vi.fn((key: string, value: string) => {
          headers[key] = value
        }),
        on: vi.fn((event: string, handler: () => void) => {
          if (event === 'finish') {
            finishHandler = handler
          }
        }),
      },
      () => undefined,
    )

    finishHandler?.()

    expect(headers['traceparent']).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/)
    expect(headers['x-trace-id']).toHaveLength(32)
  })
})
