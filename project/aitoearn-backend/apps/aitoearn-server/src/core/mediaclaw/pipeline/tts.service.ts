import { Injectable } from '@nestjs/common'
import axios from 'axios'
import { MediaclawConfigService } from '../mediaclaw-config.service'

export const MINIMAX_TTS_VOICE_IDS = [
  'Chinese_Female_Gentle',
  'Chinese_Male_Warm',
  'Chinese_Female_Energetic',
] as const

export type MinimaxTtsVoiceId = typeof MINIMAX_TTS_VOICE_IDS[number]

interface GenerateVoiceoverInput {
  text: string
  voiceId?: string
  speed?: number
}

interface MinimaxTtsResponse {
  base_resp?: {
    status_code?: number
    status_msg?: string
  }
  data?: {
    audio?: string
    audio_url?: string
    duration?: number
  }
}

export interface VoiceoverArtifact {
  buffer: Buffer
  provider: 'minimax'
  voiceId: MinimaxTtsVoiceId
  format: 'mp3'
  sampleRate: number
  durationMs: number | null
}

@Injectable()
export class TtsService {
  constructor(private readonly configService: MediaclawConfigService) {}

  isConfigured() {
    return this.configService.has([
      'MINIMAX_API_KEY',
      'MEDIACLAW_MINIMAX_API_KEY',
    ])
  }

  async generateVoiceover(input: GenerateVoiceoverInput): Promise<VoiceoverArtifact> {
    const apiKey = this.configService.getString(
      ['MINIMAX_API_KEY', 'MEDIACLAW_MINIMAX_API_KEY'],
      '',
    )
    if (!apiKey) {
      throw new Error('MINIMAX_API_KEY is not configured')
    }

    const text = this.normalizeText(input.text)
    if (!text) {
      throw new Error('Voiceover text is required')
    }

    const voiceId = this.resolveVoiceId(input.voiceId)
    const speed = this.resolveSpeed(input.speed)
    const sampleRate = this.configService.getNumber(
      ['MINIMAX_TTS_SAMPLE_RATE', 'MEDIACLAW_MINIMAX_TTS_SAMPLE_RATE'],
      32000,
    )
    const timeout = this.configService.getNumber(
      ['MINIMAX_TTS_TIMEOUT_MS', 'MEDIACLAW_MINIMAX_TTS_TIMEOUT_MS'],
      30000,
    )
    const baseUrl = this.configService.getString(
      ['MINIMAX_TTS_BASE_URL', 'MEDIACLAW_MINIMAX_TTS_BASE_URL'],
      'https://api.minimax.chat',
    ).replace(/\/+$/, '')

    const response = await axios.post<MinimaxTtsResponse>(
      `${baseUrl}/v1/t2a_v2`,
      {
        model: 'speech-02-hd',
        text,
        voice_setting: {
          voice_id: voiceId,
          speed,
        },
        audio_setting: {
          format: 'mp3',
          sample_rate: sampleRate,
        },
      },
      {
        timeout,
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      },
    )

    if ((response.data?.base_resp?.status_code || 0) > 0) {
      throw new Error(response.data?.base_resp?.status_msg || 'MiniMax TTS request failed')
    }

    const audioValue = response.data?.data?.audio?.trim()
    const audioUrl = response.data?.data?.audio_url?.trim()
    if (!audioValue && !audioUrl) {
      throw new Error('MiniMax TTS response did not include audio data')
    }

    const buffer = audioValue
      ? this.decodeAudioPayload(audioValue)
      : await this.downloadAudio(audioUrl!)

    return {
      buffer,
      provider: 'minimax',
      voiceId,
      format: 'mp3',
      sampleRate,
      durationMs: this.resolveDuration(response.data?.data?.duration),
    }
  }

  private normalizeText(value: string) {
    return value
      .replace(/[#*_`]/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/[。.!?]{2,}/g, '。')
      .trim()
      .slice(0, 1200)
  }

  private resolveVoiceId(value?: string): MinimaxTtsVoiceId {
    const normalizedValue = value?.trim()
    if (normalizedValue && (MINIMAX_TTS_VOICE_IDS as readonly string[]).includes(normalizedValue)) {
      return normalizedValue as MinimaxTtsVoiceId
    }

    return 'Chinese_Female_Gentle'
  }

  private resolveSpeed(value?: number) {
    if (!Number.isFinite(value)) {
      return 1
    }

    return Math.min(Math.max(Number(value), 0.5), 2)
  }

  private decodeAudioPayload(value: string) {
    const compact = value.replace(/\s+/g, '')
    if (/^[0-9a-f]+$/i.test(compact) && compact.length % 2 === 0) {
      return Buffer.from(compact, 'hex')
    }

    return Buffer.from(compact, 'base64')
  }

  private async downloadAudio(url: string) {
    const response = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: this.configService.getNumber(
        ['MINIMAX_TTS_DOWNLOAD_TIMEOUT_MS', 'MEDIACLAW_MINIMAX_TTS_DOWNLOAD_TIMEOUT_MS'],
        30000,
      ),
    })

    return Buffer.from(response.data)
  }

  private resolveDuration(value: unknown) {
    if (!Number.isFinite(Number(value))) {
      return null
    }

    return Math.max(0, Number(value))
  }
}
