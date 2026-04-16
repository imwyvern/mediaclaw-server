import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockExecFile = vi.fn()
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => {
    const lastArg = args[args.length - 1]
    if (typeof lastArg === 'function') return mockExecFile(...args)
    return new Promise((resolve, reject) => {
      const cb = (err: unknown, stdout: string, stderr: string) => {
        if (err) reject(err)
        else resolve({ stdout, stderr })
      }
      mockExecFile(...args, cb)
    })
  },
}))

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}))

import { videoAssembler } from './video-assembler'
import { finalComposer } from './final-composer'
import type { VideoAssetRef, VideoAssemblerInput, FinalComposerInput } from '@yikart/mediaclaw-shared-kernel'

const makeVideo = (id = 'v1'): VideoAssetRef => ({
  assetId: id, storageKey: `/tmp/${id}.mp4`, sha256: 'abc', mimeType: 'video/mp4',
  durationSec: 5, width: 720, height: 1280, fps: 30, hasAudio: true,
})

describe('videoAssembler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env['MEDIA_TEMP_DIR'] = '/tmp/mediaclaw-test'
    mockExecFile.mockImplementation((_cmd: string, _args: unknown, _opts: unknown, cb?: unknown) => {
      if (typeof _opts === 'function') cb = _opts
      if (typeof cb === 'function') cb(null, '', '')
    })
  })

  it('拼接多段视频', async () => {
    const input: VideoAssemblerInput = {
      shots: [makeVideo('s1'), makeVideo('s2'), makeVideo('s3')],
    }
    const result = await videoAssembler(input)
    expect(result.video.durationSec).toBe(15)
    expect(result.meta.status).toBe('success')
  })
})

describe('finalComposer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env['MEDIA_TEMP_DIR'] = '/tmp/mediaclaw-test'
    mockExecFile.mockImplementation((_cmd: string, _args: unknown, _opts: unknown, cb?: unknown) => {
      if (typeof _opts === 'function') cb = _opts
      if (typeof cb === 'function') cb(null, '', '')
    })
  })

  it('合并视频+音频', async () => {
    const input: FinalComposerInput = {
      video: makeVideo(),
      ttsAudio: { assetId: 'a1', storageKey: '/tmp/audio.mp3', sha256: 'x', mimeType: 'audio/mpeg' },
    }
    const result = await finalComposer(input)
    expect(result.video.hasAudio).toBe(true)
    expect(result.meta.status).toBe('success')
  })

  it('纯视频无音频', async () => {
    const input: FinalComposerInput = { video: makeVideo() }
    const result = await finalComposer(input)
    expect(result.video.hasAudio).toBe(false)
    expect(result.meta.status).toBe('success')
  })
})
