import axios from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TtsService } from './tts.service'

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}))

describe('ttsService', () => {
  let service: TtsService
  let configService: Record<string, any>

  beforeEach(() => {
    vi.clearAllMocks()
    configService = {
      getNumber: vi.fn((keys: string | string[], fallback: number) => fallback),
      getString: vi.fn((keys: string | string[], fallback = '') => {
        const candidates = Array.isArray(keys) ? keys : [keys]
        if (candidates.includes('MINIMAX_API_KEY')) {
          return 'minimax-key-123456'
        }

        return fallback
      }),
      has: vi.fn().mockReturnValue(true),
    }

    service = new TtsService(configService as any)
  })

  it('应解码 MiniMax 返回的十六进制音频数据', async () => {
    vi.mocked(axios.post).mockResolvedValue({
      data: {
        base_resp: {
          status_code: 0,
        },
        data: {
          audio: '48656c6c6f',
          duration: 1800,
        },
      },
    } as any)

    const result = await service.generateVoiceover({
      text: '  爆款  文案  ',
      voiceId: 'unsupported',
    })

    expect(axios.post).toHaveBeenCalledWith(
      'https://api.minimax.chat/v1/t2a_v2',
      expect.objectContaining({
        model: 'speech-02-hd',
        text: '爆款 文案',
        voice_setting: expect.objectContaining({
          voice_id: 'Chinese_Female_Gentle',
        }),
      }),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer minimax-key-123456',
        }),
      }),
    )
    expect(result.buffer.toString()).toBe('Hello')
    expect(result.durationMs).toBe(1800)
  })

  it('应在返回音频链接时下载二进制内容', async () => {
    vi.mocked(axios.post).mockResolvedValue({
      data: {
        base_resp: {
          status_code: 0,
        },
        data: {
          audio_url: 'https://cdn.example.com/voice.mp3',
        },
      },
    } as any)
    vi.mocked(axios.get).mockResolvedValue({
      data: Uint8Array.from([1, 2, 3, 4]).buffer,
    } as any)

    const result = await service.generateVoiceover({
      text: '评论区告诉我你最想看的版本',
      voiceId: 'Chinese_Male_Warm',
      speed: 1.2,
    })

    expect(axios.get).toHaveBeenCalledWith(
      'https://cdn.example.com/voice.mp3',
      expect.objectContaining({
        responseType: 'arraybuffer',
      }),
    )
    expect(result.voiceId).toBe('Chinese_Male_Warm')
    expect(result.buffer).toEqual(Buffer.from([1, 2, 3, 4]))
  })
})
