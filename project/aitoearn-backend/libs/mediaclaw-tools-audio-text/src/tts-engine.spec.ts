import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(Buffer.from('fake-audio')),
}))

import { ttsEngine } from './tts-engine'
import type { TTSEngineInput } from '@yikart/mediaclaw-shared-kernel'

describe('ttsEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env['DOUBAO_TTS_API_KEY'] = 'test-key'
    process.env['DOUBAO_TTS_APP_ID'] = '123'
    process.env['MEDIA_TEMP_DIR'] = '/tmp/mediaclaw-test'
  })

  it('成功合成多句音频', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: Buffer.from('audio').toString('base64') }),
    })

    const input: TTSEngineInput = {
      lines: [
        { lineId: 'l1', text: '果泥入口即化', durationSec: 2 },
        { lineId: 'l2', text: '低度微醺刚好', durationSec: 2 },
      ],
      voiceId: 'zh_male_liufei',
      payloadFormat: 'req_params',
    }

    const result = await ttsEngine(input)
    expect(result.meta.status).toBe('success')
    expect(result.mergedAudio.mimeType).toBe('audio/mpeg')
    expect(result.audioSegments).toHaveLength(2)
  })
})
