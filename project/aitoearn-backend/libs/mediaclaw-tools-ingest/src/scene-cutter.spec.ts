import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock node:child_process — promisify 兼容
const mockExecFile = vi.fn()
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => {
    const lastArg = args[args.length - 1]
    if (typeof lastArg === 'function') {
      return mockExecFile(...args)
    }
    return new Promise((resolve, reject) => {
      const cb = (err: unknown, stdout: string, stderr: string) => {
        if (err) reject(err)
        else resolve({ stdout, stderr })
      }
      mockExecFile(...args, cb)
    })
  },
}))

// Mock node:fs/promises
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(Buffer.from('fake-frame')),
}))

import { sceneCutter } from './scene-cutter'
import type { SceneCutterInput, VideoAssetRef } from '@yikart/mediaclaw-shared-kernel'

const makeVideo = (overrides?: Partial<VideoAssetRef>): VideoAssetRef => ({
  assetId: 'v1',
  storageKey: '/tmp/test.mp4',
  sha256: 'abc',
  mimeType: 'video/mp4',
  durationSec: 30,
  width: 1080,
  height: 1920,
  fps: 30,
  hasAudio: true,
  ...overrides,
})

describe('sceneCutter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env['MEDIA_TEMP_DIR'] = '/tmp/mediaclaw-test'
  })

  it('检测到多个场景切换时返回对应镜头', async () => {
    mockExecFile.mockImplementation((cmd: string, args: unknown, _opts: unknown, cb?: unknown) => {
      if (typeof _opts === 'function') { cb = _opts }
      if (typeof cb === 'function') {
        if (cmd === 'ffmpeg' && Array.isArray(args) && args.includes('-f')) {
          // scene detect — ffmpeg 输出 showinfo 到 stderr，exit code 非 0
          const err = Object.assign(new Error('exit 1'), {
            stderr: [
              '[Parsed_showinfo_1] n:0 pts:0 pts_time:0.000',
              '[Parsed_showinfo_1] n:150 pts:150 pts_time:5.000',
              '[Parsed_showinfo_1] n:300 pts:300 pts_time:10.000',
              '[Parsed_showinfo_1] n:600 pts:600 pts_time:20.000',
            ].join('\n'),
          })
          cb(err, '', '')
        } else if (cmd === 'ffmpeg') {
          // frame extraction
          cb(null, '', '')
        } else if (cmd === 'ffprobe') {
          cb(null, JSON.stringify({
            streams: [{ width: 1080, height: 1920 }],
          }), '')
        }
      }
    })

    const input: SceneCutterInput = {
      video: makeVideo({ durationSec: 30 }),
      threshold: 0.3,
      extractFirstFrame: true,
    }

    const result = await sceneCutter(input)

    expect(result.cuts.length).toBe(4)
    expect(result.cuts[0]!.cutId).toBe('cut_0')
    expect(result.cuts[0]!.startSec).toBe(0)
    expect(result.cuts[1]!.startSec).toBe(5)
    expect(result.cuts[2]!.startSec).toBe(10)
    expect(result.cuts[3]!.startSec).toBe(20)
    expect(result.cuts[3]!.endSec).toBe(30)
    expect(result.thresholdUsed).toBe(0.3)
    expect(result.meta.status).toBe('success')
  }, 15_000)

  it('无场景切换时返回整个视频作为一个镜头', async () => {
    mockExecFile.mockImplementation((cmd: string, args: unknown, _opts: unknown, cb?: unknown) => {
      if (typeof _opts === 'function') { cb = _opts }
      if (typeof cb === 'function') {
        if (cmd === 'ffmpeg' && Array.isArray(args) && args.includes('-f')) {
          const err = Object.assign(new Error('exit 1'), { stderr: '' })
          cb(err, '', '')
        } else if (cmd === 'ffmpeg') {
          cb(null, '', '')
        } else if (cmd === 'ffprobe') {
          cb(null, JSON.stringify({ streams: [{ width: 720, height: 1280 }] }), '')
        }
      }
    })

    const input: SceneCutterInput = {
      video: makeVideo({ durationSec: 15 }),
      extractFirstFrame: false,
    }

    const result = await sceneCutter(input)

    expect(result.cuts.length).toBe(1)
    expect(result.cuts[0]!.startSec).toBe(0)
    expect(result.cuts[0]!.endSec).toBe(15)
    expect(result.meta.status).toBe('success')
  }, 15_000)

  it('maxCuts 限制镜头数量', async () => {
    mockExecFile.mockImplementation((cmd: string, args: unknown, _opts: unknown, cb?: unknown) => {
      if (typeof _opts === 'function') { cb = _opts }
      if (typeof cb === 'function') {
        if (cmd === 'ffmpeg' && Array.isArray(args) && args.includes('-f')) {
          const err = Object.assign(new Error('exit 1'), {
            stderr: Array.from({ length: 20 }, (_, i) =>
              `[Parsed_showinfo_1] pts_time:${i * 2}.000`,
            ).join('\n'),
          })
          cb(err, '', '')
        } else {
          cb(null, '', '')
        }
      }
    })

    const input: SceneCutterInput = {
      video: makeVideo({ durationSec: 60 }),
      extractFirstFrame: false,
      maxCuts: 5,
    }

    const result = await sceneCutter(input)

    expect(result.cuts.length).toBeLessThanOrEqual(5)
  }, 15_000)
})
