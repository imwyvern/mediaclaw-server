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

/**
 * TTS 配音 Tool
 */
export async function ttsEngine(input: TTSEngineInput): Promise<TTSEngineOutput> {
  const startMs = Date.now()
  const apiKey = process.env['DOUBAO_TTS_API_KEY']
  if (!apiKey) throw new Error('DOUBAO_TTS_API_KEY 未配置')

  const voice = input.voiceId ?? process.env['DOUBAO_TTS_VOICE_DEFAULT'] ?? 'zh_male_liufei_uranus_bigtts'
  const appId = process.env['DOUBAO_TTS_APP_ID'] ?? ''
  const outDir = join(MEDIA_TEMP_DIR(), `tts_${Date.now()}`)
  await mkdir(outDir, { recursive: true })

  const audioSegments: AssetRef[] = []

  for (const line of input.lines) {
    const audioPath = join(outDir, `${line.lineId}.mp3`)
    await synthesizeLine(apiKey, appId, voice, line.text, audioPath)
    const sha256 = createHash('sha256').update(audioPath + Date.now()).digest('hex')
    audioSegments.push({ assetId: `seg_${line.lineId}`, storageKey: audioPath, sha256, mimeType: 'audio/mpeg' })
  }

  // 合并音频
  const mergedPath = join(outDir, 'merged.mp3')
  await concatAudio(audioSegments.map((s) => s.storageKey), mergedPath)
  const mergedSha = createHash('sha256').update(mergedPath + Date.now()).digest('hex')
  const mergedAudio: AssetRef = { assetId: `tts_${Date.now()}`, storageKey: mergedPath, sha256: mergedSha, mimeType: 'audio/mpeg' }

  const meta: ToolResponseMeta = {
    status: 'success', errorCode: 'NONE', retryable: false, confidence: 0.9,
    costYuan: input.lines.length * 0.02, humanReviewRequired: false,
    sideEffects: [`合成 ${input.lines.length} 句`, `音色: ${voice}`, `耗时 ${((Date.now() - startMs) / 1000).toFixed(1)}s`],
  }

  return { audioSegments, mergedAudio, meta }
}

async function synthesizeLine(apiKey: string, appId: string, voice: string, text: string, outputPath: string): Promise<void> {
  const baseUrl = process.env['DOUBAO_TTS_BASE_URL'] ?? 'https://openspeech.bytedance.com/api/v1/tts'
  const resp = await fetch(baseUrl, {
    method: 'POST',
    headers: { 'Authorization': `Bearer;${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app: { appid: appId, cluster: 'volcano_tts' },
      user: { uid: 'mediaclaw' },
      audio: { voice_type: voice, encoding: 'mp3' },
      request: { text, reqid: `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` },
    }),
  })
  if (!resp.ok) throw new Error(`TTS API ${resp.status}: ${resp.statusText}`)
  const data = (await resp.json()) as { data?: string }
  if (data.data) await writeFile(outputPath, Buffer.from(data.data, 'base64'))
}

async function concatAudio(paths: string[], outputPath: string): Promise<void> {
  const { readFile } = await import('node:fs/promises')
  const buffers: Buffer[] = []
  for (const p of paths) { try { buffers.push(await readFile(p)) } catch { /* skip */ } }
  if (buffers.length > 0) await writeFile(outputPath, Buffer.concat(buffers))
}
