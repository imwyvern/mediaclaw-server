import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { scriptWriter } from './script-writer'
import type { ScriptWriterInput } from '@yikart/mediaclaw-shared-kernel'

describe('scriptWriter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env['GEMINI_API_KEY'] = 'test-key'
  })

  it('成功生成文案', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: '果泥入口即化\n低度微醺刚好\n国潮设计超好看\n聚会必备神器\n一口就爱上' }] } }],
      }),
    })

    const input: ScriptWriterInput = {
      style: 'seed',
      language: 'zh-CN',
      brand: { brandId: 'b1', brandName: '越小啤', industry: '啤酒' },
      product: { productId: 'p1', name: '陈皮柚子铺', features: ['果泥口感'], images: [] },
    }

    const result = await scriptWriter(input)
    expect(result.lines.length).toBeGreaterThan(0)
    expect(result.meta.status).toBe('success')
  })

  it('API 失败抛错', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Error' })

    const input: ScriptWriterInput = { style: 'seed', language: 'zh-CN' }
    await expect(scriptWriter(input)).rejects.toThrow('LLM API')
  })
})
