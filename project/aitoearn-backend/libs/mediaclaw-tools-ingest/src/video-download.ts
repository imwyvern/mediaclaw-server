import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { writeFile, stat, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

import type {
  VideoDownloadInput,
  VideoDownloadOutput,
  VideoAssetRef,
  ToolResponseMeta,
} from '@yikart/mediaclaw-shared-kernel'

const execFileAsync = promisify(execFile)

/** TikHub API 基地址 */
const TIKHUB_BASE_URL = process.env['TIKHUB_BASE_URL'] ?? 'https://api.tikhub.io'

/** 临时文件目录 */
const MEDIA_TEMP_DIR = process.env['MEDIA_TEMP_DIR'] ?? '/tmp/mediaclaw'

/**
 * 视频下载 Tool
 *
 * 先尝试 TikHub API 获取无水印视频链接并下载，
 * 失败后回退到 yt-dlp 命令行工具。
 */
export async function videoDownload(
  input: VideoDownloadInput,
): Promise<VideoDownloadOutput> {
  const startMs = Date.now()
  let fallbackAttempts = 0

  await mkdir(MEDIA_TEMP_DIR, { recursive: true })

  // 尝试 TikHub
  try {
    const result = await downloadViaTikhub(input.sourceUrl)
    return buildOutput(result.filePath, 'tikhub', fallbackAttempts, startMs)
  } catch {
    fallbackAttempts++
  }

  // 回退 yt-dlp
  try {
    const result = await downloadViaYtDlp(input.sourceUrl, input.maxDurationSec)
    return buildOutput(result.filePath, 'yt-dlp', fallbackAttempts, startMs)
  } catch (err) {
    fallbackAttempts++
    const meta = buildMeta('failed', 'DOWNLOAD_FAILED', false, 0, startMs)
    throw Object.assign(new Error(`下载失败: ${String(err)}`), { meta })
  }
}

/** 通过 TikHub API 下载 */
async function downloadViaTikhub(sourceUrl: string): Promise<{ filePath: string }> {
  const apiKey = process.env['TIKHUB_API_KEY']
  if (!apiKey) throw new Error('TIKHUB_API_KEY 未配置')

  // 按平台选择端点（参考 aitoearn-server/acquisition/tikhub.service.ts）
  const platform = detectPlatform(sourceUrl)
  const endpoint = platform === 'douyin'
    ? `${TIKHUB_BASE_URL}/api/v1/douyin/web/fetch_one_video_by_share_url`
    : platform === 'xhs'
      ? `${TIKHUB_BASE_URL}/api/v1/xiaohongshu/app/get_video_note_info`
      : platform === 'kuaishou'
        ? `${TIKHUB_BASE_URL}/api/v1/kuaishou/web/get_video_info`
        : `${TIKHUB_BASE_URL}/api/v1/bilibili/web/fetch_one_video`

  const queryParam = platform === 'douyin' ? 'share_url'
    : platform === 'xhs' ? 'share_text'
    : platform === 'kuaishou' ? 'share_url'
    : 'bv_id'

  const url = `${endpoint}?${queryParam}=${encodeURIComponent(sourceUrl)}`
  const resp = await fetch(url, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${apiKey}` },
  })

  if (!resp.ok) {
    throw new Error(`TikHub API ${resp.status}: ${resp.statusText}`)
  }

  const data = (await resp.json()) as Record<string, unknown>
  const videoData = (data['data'] ?? data) as Record<string, unknown>
  // 尝试多种字段名提取视频 URL
  const videoUrl = extractVideoUrl(videoData)

  if (!videoUrl) {
    throw new Error('TikHub 返回无视频链接')
  }

  // 下载视频文件
  const fileName = `tikhub_${Date.now()}.mp4`
  const filePath = join(MEDIA_TEMP_DIR, fileName)
  const videoResp = await fetch(videoUrl)
  if (!videoResp.ok) throw new Error(`视频下载失败: ${videoResp.status}`)

  const buffer = Buffer.from(await videoResp.arrayBuffer())
  await writeFile(filePath, buffer)

  return { filePath }
}

/** 检测平台 */
function detectPlatform(url: string): 'douyin' | 'xhs' | 'kuaishou' | 'bilibili' {
  if (url.includes('douyin') || url.includes('iesdouyin')) return 'douyin'
  if (url.includes('xiaohongshu') || url.includes('xhslink')) return 'xhs'
  if (url.includes('kuaishou') || url.includes('gifshow')) return 'kuaishou'
  return 'bilibili'
}

/** 从响应中提取视频 URL（兼容多平台格式） */
function extractVideoUrl(data: Record<string, unknown>): string | undefined {
  // 直接字段
  if (typeof data['video_url'] === 'string') return data['video_url']
  if (typeof data['play_url'] === 'string') return data['play_url']
  if (typeof data['content_url'] === 'string') return data['content_url']

  // 嵌套结构
  const video = data['video'] as Record<string, unknown> | undefined
  if (video) {
    if (typeof video['play_addr'] === 'string') return video['play_addr']
    const playAddr = video['play_addr'] as Record<string, unknown> | undefined
    const urlList = playAddr?.['url_list'] as string[] | undefined
    if (urlList?.[0]) return urlList[0]
  }

  // 深度搜索
  for (const key of Object.keys(data)) {
    const val = data[key]
    if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      const nested = extractVideoUrl(val as Record<string, unknown>)
      if (nested) return nested
    }
  }

  return undefined
}

/** 通过 yt-dlp 命令行下载 */
async function downloadViaYtDlp(
  sourceUrl: string,
  maxDurationSec?: number,
): Promise<{ filePath: string }> {
  const fileName = `ytdlp_${Date.now()}.mp4`
  const filePath = join(MEDIA_TEMP_DIR, fileName)

  const args = [
    '-f', 'best[ext=mp4]/best',
    '-o', filePath,
    '--no-playlist',
    '--no-warnings',
  ]

  if (maxDurationSec) {
    args.push('--match-filter', `duration<=${maxDurationSec}`)
  }

  args.push(sourceUrl)

  await execFileAsync('yt-dlp', args, { timeout: 120_000 })

  return { filePath }
}

/** 构建输出 */
async function buildOutput(
  filePath: string,
  sourceUsed: 'tikhub' | 'yt-dlp',
  fallbackAttempts: number,
  startMs: number,
): Promise<VideoDownloadOutput> {
  const fileInfo = await stat(filePath)
  const sha256 = await computeSha256(filePath)

  // 用 ffprobe 获取视频元信息
  const probe = await probeVideo(filePath)

  const video: VideoAssetRef = {
    assetId: `dl_${Date.now()}`,
    storageKey: filePath,
    sha256,
    mimeType: 'video/mp4',
    durationSec: probe.durationSec,
    width: probe.width,
    height: probe.height,
    fps: probe.fps,
    hasAudio: probe.hasAudio,
  }

  return {
    video,
    sourceUsed,
    fallbackAttempts,
    meta: buildMeta('success', 'NONE', false, 0, startMs),
  }
}

/** ffprobe 获取视频信息 */
async function probeVideo(filePath: string): Promise<{
  durationSec: number
  width: number
  height: number
  fps: number
  hasAudio: boolean
}> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath,
    ])

    const info = JSON.parse(stdout) as {
      format?: { duration?: string }
      streams?: Array<{
        codec_type?: string
        width?: number
        height?: number
        r_frame_rate?: string
      }>
    }

    const videoStream = info.streams?.find((s) => s.codec_type === 'video')
    const hasAudio = info.streams?.some((s) => s.codec_type === 'audio') ?? false
    const durationSec = parseFloat(info.format?.duration ?? '0')
    const width = videoStream?.width ?? 0
    const height = videoStream?.height ?? 0

    let fps = 30
    if (videoStream?.r_frame_rate) {
      const [num, den] = videoStream.r_frame_rate.split('/')
      if (num && den && parseInt(den) > 0) {
        fps = Math.round(parseInt(num) / parseInt(den))
      }
    }

    return { durationSec, width, height, fps, hasAudio }
  } catch {
    // ffprobe 不可用时返回默认值
    return { durationSec: 0, width: 0, height: 0, fps: 30, hasAudio: false }
  }
}

/** 计算文件 SHA256 */
async function computeSha256(filePath: string): Promise<string> {
  const { readFile } = await import('node:fs/promises')
  const buf = await readFile(filePath)
  return createHash('sha256').update(buf).digest('hex')
}

/** 构建 ToolResponseMeta */
function buildMeta(
  status: 'success' | 'failed' | 'partial',
  errorCode: string,
  humanReviewRequired: boolean,
  costYuan: number,
  startMs: number,
): ToolResponseMeta {
  return {
    status,
    errorCode: errorCode as ToolResponseMeta['errorCode'],
    retryable: errorCode === 'DOWNLOAD_FAILED' || errorCode === 'API_DOWN',
    confidence: status === 'success' ? 1 : 0,
    costYuan,
    humanReviewRequired,
    sideEffects: [`耗时 ${((Date.now() - startMs) / 1000).toFixed(1)}s`],
  }
}
