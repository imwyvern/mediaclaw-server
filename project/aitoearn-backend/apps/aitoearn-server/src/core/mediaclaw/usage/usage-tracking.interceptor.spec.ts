import { describe, expect, it } from 'vitest'
import { UsageTrackingInterceptor } from './usage-tracking.interceptor'

describe('usageTrackingInterceptor', () => {
  it('应从 customer scoped api key 中提取稳定前缀用于用量归因', () => {
    const interceptor = new UsageTrackingInterceptor({ trackRequest: async () => undefined } as any)
    const apiKey = (interceptor as any).resolveApiKey({
      headers: {
        authorization: 'Bearer mc_beautybrand_abc123def456',
      },
    })

    expect(apiKey).toBe('mc_beautybrand_abc123de')
  })

  it('应保持 legacy live key 的前缀提取行为', () => {
    const interceptor = new UsageTrackingInterceptor({ trackRequest: async () => undefined } as any)
    const apiKey = (interceptor as any).resolveApiKey({
      headers: {
        authorization: 'Bearer mc_live_abc123def456',
      },
    })

    expect(apiKey).toBe('mc_live_abc123de')
  })
})
