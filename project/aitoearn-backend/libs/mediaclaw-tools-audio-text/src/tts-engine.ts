import { createHash } from 'node:crypto'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import type {
  TTSEngineInput,
  TTSEngineOutput,
  AssetRef,
  ToolResponseMeta,
} from '@yikart/mediaclaw-shared-kernel'

const MEDIA_TEMP_DIR = () => process.env['MEDIA_TEMP_DIR'] ?? '/tmp/mediaclaw'

/** MiniMax TTS voice IDs（参考 tts.service.ts） */
const VOICE_IDS = [
  'Chinese_Female_Gentle',
  'Chinese_Male_Warm',
  'Chinese_Female_Energetic',
] as const

/**
 * TTS 配音 Tool
 *
 * 优先 MiniMax TTS（参考 aitoearn-server/pipeline/tts.service.ts），
 * 回退到火山 TTS。
 */
export async function ttsEngine(input: TTSEngineInput): Promise<TTSEngineOutput> {
  const startMs = Date.now()

  const minimaxKey = process.env['MINIMAX_API_KEY'] ?? process.env['MEDIACLAW_MINIMAX_API_KEY']
  const doubaoKey = process.env['DOUBAO_TTS_API_KEY']
  if (!minimaxKey && !doubaoKey) throw new Error('MINIMAX_API_KEY 或 DOUBAO_TTS_API_KEY 未配置')

  const voice = resolveVoice(input.voiceId)
  const outDir = join(MEDIA_TEMP_DIR(), `tts_${Date.now()}`)
  await mkdir(outDir, { recursive: true })

  const audioSegments: AssetRef[] = []

  for (const line of input.lines) {
    const audioPath = join(outDir, `${line.lineId}.mp3`)

    if (minimaxKey) {
      await synthesizeWithMinimax(minimaxKey, voice, line.text, audioPath)
    } else {
      await synthesizeWithDoubao(doubaoKey!, line.text, audioPath)
    }

    const sha256 = createHash('sha256').update(audioPath + Date.now()).digest('hex')
    audioSegments.push({ assetId: `seg_${line.lineId}`, storageKey: audioPath, sha256, mimeType: 'audio/mpeg' })
  }

  // 合并音频
  const mergedPath = join(outDir, 'merged.mp3')
  await concatAudio(audioSegments.map((s) => s.storageKey), mergedPath)
  const mergedSha = createHash('sha256').update(mergedPath + Date.now()).digest('hex')
  const mergedAudio: AssetRef = { assetId: `tts_${Date.now()}`, storageKey: mergedPath, sha256: mergedSha, mimeType: 'audio/mpeg' }

  const provider = minimaxKey ? 'minimax' : 'doubao'
  const meta: ToolResponseMeta = {
    status: 'success', errorCode: 'NONE', retryable: false, confidence: 0.9,
    costYuan: input.lines.length * (minimaxKey ? 0.03 : 0.02), humanReviewRequired: false,
    sideEffects: [`合成 ${input.lines.length} 句`, `provider: ${provider}`, `音色: ${voice}`, `耗时 ${((Date.now() - startMs) / 1000).toFixed(1)}s`],
  }

  return { audioSegments, mergedAudio, meta }
}

/** MiniMax TTS（参考 tts.service.ts） */
async function synthesizeWithMinimax(apiKey: string, voice: string, text: string, outputPath: string): Promise<void> {
  const baseUrl = (process.env['MINIMAX_TTS_BASE_URL'] ?? process.env['MEDIACLAW_MINIMAX_TTS_BASE_URL'] ?? 'https://api.minimax.chat').replace(/\/+$/, '')
  const sampleRate = Number(process.env['MINIMAX_TTS_SAMPLE_RATE'] ?? '32000')

  const resp = await fetch(`${baseUrl}/v1/t2a_v2`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'speech-02-hd',
      text: normalizeText(text),
      voice_setting: { voice_id: voice, speed: 1 },
      audio_setting: { format: 'mp3', sample_rate: sampleRate },
    }),
  })

  if (!resp.ok) throw new Error(`MiniMax TTS ${resp.status}: ${resp.statusText}`)

  const data = (await resp.json()) as {
    base_resp?: { status_code?: number; status_msg?: string }
    data?: { audio?: string; audio_url?: string }
  }

  if ((data.base_resp?.status_code ?? 0) > 0) {
    throw new Error(data.base_resp?.status_msg ?? 'MiniMax TTS failed')
  }

  const audioValue = data.data?.audio?.trim()
  const audioUrl = data.data?.audio_url?.trim()

  if (audioValue) {
    // hex 或 base64 编码（参考 tts.service.ts decodeAudioPayload）
    const compact = audioValue.replace(/\s+/g, '')
    const buffer = /^[0-9a-f]+$/i.test(compact) && compact.length % 2 === 0
      ? Buffer.from(compact, 'hex')
      : Buffer.from(compact, 'base64')
    await writeFile(outputPath, buffer)
  } else if (audioUrl) {
    const audioResp = await fetch(audioUrl)
    if (!audioResp.ok) throw new Error(`Audio download failed: ${audioResp.status}`)
    await writeFile(outputPath, Buffer.from(await audioResp.arrayBuffer()))
  } else {
    throw new Error('MiniMax TTS 返回无音频数据')
  }
}

/** 火山 TTS 回退 */
async function synthesizeWithDoubao(apiKey: string, text: string, outputPath: string): Promise<void> {
  const baseUrl = process.env['DOUBAO_TTS_BASE_URL'] ?? 'https://openspeech.bytedance.com/api/v1/tts'
  const appId = process.env['DOUBAO_TTS_APP_ID'] ?? ''
  const voice = process.env['DOUBAO_TTS_VOICE_DEFAULT'] ?? 'zh_male_liufei_uranus_bigtts'

  const resp = await fetch(baseUrl, {
    method: 'POST',
    headers: { 'Authorization': `Bearer;${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app: { appid: appId, cluster: 'volcano_tts' },
      user: { uid: 'mediaclaw' },
      audio: { voice_type: voice, encoding: 'mp3' },
      request: { text: normalizeText(text), reqid: `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` },
    }),
  })
  if (!resp.ok) throw new Error(`Doubao TTS ${resp.status}: ${resp.statusText}`)
  const data = (await resp.json()) as { data?: string }
  if (data.data) await writeFile(outputPath, Buffer.from(data.data, 'base64'))
}

function resolveVoice(voiceId?: string): string {
  if (voiceId && (VOICE_IDS as readonly string[]).includes(voiceId)) return voiceId
  return 'Chinese_Female_Gentle'
}

function normalizeText(text: string): string {
  return text.replace(/[#*_`]/g, ' ').replace(/\s+/g, ' ').replace(/[。.!?]{2,}/g, '。').trim().slice(0, 1200)
}

async function concatAudio(paths: string[], outputPath: string): Promise<void> {
  const { readFile } = await import('node:fs/promises')
  const buffers: Buffer[] = []
  for (const p of paths) { try { buffers.push(await readFile(p)) } catch { /* skip */ } }
  if (buffers.length > 0) await writeFile(outputPath, Buffer.concat(buffers))
}
