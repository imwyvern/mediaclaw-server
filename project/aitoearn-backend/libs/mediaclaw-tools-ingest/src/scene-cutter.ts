import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

import type {
  SceneCutterInput,
  SceneCutterOutput,
  SceneCut,
  ImageAssetRef,
  ToolResponseMeta,
} from '@yikart/mediaclaw-shared-kernel'

const execFileAsync = promisify(execFile)

const MEDIA_TEMP_DIR = process.env['MEDIA_TEMP_DIR'] ?? '/tmp/mediaclaw'

/**
 * 场景切割 Tool
 *
 * 使用 ffmpeg 的 scene detect filter 按镜头变化切片，
 * 可选抽取每个镜头的首帧图片。
 */
export async function sceneCutter(
  input: SceneCutterInput,
): Promise<SceneCutterOutput> {
  const startMs = Date.now()
  const threshold = input.threshold ?? 0.35
  const videoPath = input.video.storageKey

  const cutsDir = join(MEDIA_TEMP_DIR, `cuts_${Date.now()}`)
  await mkdir(cutsDir, { recursive: true })

  // 用 ffmpeg scene detect 获取场景切换时间点
  const timestamps = await detectScenes(videoPath, threshold)

  // 限制最大镜头数
  const maxCuts = input.maxCuts ?? 100
  const limitedTimestamps = timestamps.slice(0, maxCuts)

  // 构建 SceneCut 列表
  const videoDuration = input.video.durationSec
  const cuts: SceneCut[] = []

  for (let i = 0; i < limitedTimestamps.length; i++) {
    const startSec = limitedTimestamps[i]!
    const endSec = limitedTimestamps[i + 1] ?? videoDuration
    const cutId = `cut_${i}`

    let firstFrame: ImageAssetRef | undefined
    if (input.extractFirstFrame) {
      firstFrame = await extractFrame(videoPath, startSec, cutsDir, cutId)
    }

    cuts.push({
      cutId,
      startSec,
      endSec,
      firstFrame: firstFrame ?? buildPlaceholderFrame(cutId),
    })
  }

  // 如果没检测到场景切换，把整个视频当一个镜头
  if (cuts.length === 0) {
    let firstFrame: ImageAssetRef | undefined
    if (input.extractFirstFrame) {
      firstFrame = await extractFrame(videoPath, 0, cutsDir, 'cut_0')
    }
    cuts.push({
      cutId: 'cut_0',
      startSec: 0,
      endSec: videoDuration,
      firstFrame: firstFrame ?? buildPlaceholderFrame('cut_0'),
    })
  }

  const meta: ToolResponseMeta = {
    status: 'success',
    errorCode: 'NONE',
    retryable: false,
    confidence: 0.9,
    costYuan: 0,
    humanReviewRequired: false,
    sideEffects: [
      `检测到 ${cuts.length} 个镜头`,
      `耗时 ${((Date.now() - startMs) / 1000).toFixed(1)}s`,
    ],
  }

  return {
    cuts,
    thresholdUsed: threshold,
    meta,
  }
}

/**
 * 使用 ffmpeg scene filter 检测场景切换时间点
 */
async function detectScenes(
  videoPath: string,
  threshold: number,
): Promise<number[]> {
  try {
    const { stdout } = await execFileAsync('ffmpeg', [
      '-i', videoPath,
      '-filter:v', `select='gt(scene,${threshold})',showinfo`,
      '-f', 'null',
      '-',
    ], {
      timeout: 120_000,
      // ffmpeg 输出 showinfo 到 stderr
      maxBuffer: 10 * 1024 * 1024,
    })

    // showinfo 输出在 stderr，但 execFile 可能合并
    // 解析 pts_time 字段
    return parseSceneTimestamps(stdout)
  } catch (err) {
    // ffmpeg 把 showinfo 输出到 stderr
    const stderr = (err as { stderr?: string }).stderr ?? ''
    const timestamps = parseSceneTimestamps(stderr)
    if (timestamps.length > 0) return timestamps

    // 真正的错误
    if (!stderr.includes('pts_time')) throw err
    return parseSceneTimestamps(stderr)
  }
}

/** 从 ffmpeg showinfo 输出解析时间戳 */
function parseSceneTimestamps(output: string): number[] {
  const timestamps: number[] = [0] // 始终包含 0 秒作为第一个镜头起点
  const regex = /pts_time:\s*([\d.]+)/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(output)) !== null) {
    const t = parseFloat(match[1]!)
    if (t > 0) timestamps.push(t)
  }

  return timestamps
}

/** 抽取指定时间点的帧 */
async function extractFrame(
  videoPath: string,
  timeSec: number,
  outputDir: string,
  cutId: string,
): Promise<ImageAssetRef> {
  const framePath = join(outputDir, `${cutId}.jpg`)

  await execFileAsync('ffmpeg', [
    '-ss', String(timeSec),
    '-i', videoPath,
    '-frames:v', '1',
    '-q:v', '2',
    '-y',
    framePath,
  ], { timeout: 30_000 })

  const { readFile } = await import('node:fs/promises')
  const buf = await readFile(framePath)
  const sha256 = createHash('sha256').update(buf).digest('hex')

  // 用 ffprobe 获取图片尺寸
  let width = 0
  let height = 0
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      framePath,
    ])
    const info = JSON.parse(stdout) as {
      streams?: Array<{ width?: number; height?: number }>
    }
    width = info.streams?.[0]?.width ?? 0
    height = info.streams?.[0]?.height ?? 0
  } catch {
    // 忽略
  }

  return {
    assetId: `frame_${cutId}`,
    storageKey: framePath,
    sha256,
    mimeType: 'image/jpeg',
    width,
    height,
  }
}

/** 占位帧（extractFirstFrame=false 时使用） */
function buildPlaceholderFrame(cutId: string): ImageAssetRef {
  return {
    assetId: `placeholder_${cutId}`,
    storageKey: '',
    sha256: '',
    mimeType: 'image/jpeg',
    width: 0,
    height: 0,
  }
}
