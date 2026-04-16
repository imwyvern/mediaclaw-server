import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

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
}))

import { styleRewriter } from './style-rewriter'
import { videoEditor } from './video-editor'
import { shotUpgrader } from './shot-upgrader'
import type { VideoAssetRef } from '@yikart/mediaclaw-shared-kernel'

const makeVideo = (): VideoAssetRef => ({
  assetId: 'v1', storageKey: '/tmp/v.mp4', sha256: 'abc', mimeType: 'video/mp4',
  durationSec: 15, width: 1080, height: 1920, fps: 30, hasAudio: true,
})

describe('styleRewriter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env['MEDIA_TEMP_DIR'] = '/tmp/mediaclaw-test'
    mockExecFile.mockImplementation((_cmd: string, _args: unknown, _opts: unknown, cb?: unknown) => {
      if (typeof _opts === 'function') cb = _opts
      if (typeof cb === 'function') cb(null, '', '')
    })
  })

  it('应用多个变异维度', async () => {
    const result = await styleRewriter({
      video: makeVideo(),
      rewriteAxes: ['color', 'speed', 'crop'],
      intensity: 0.5,
    })
    expect(result.appliedChanges).toHaveLength(3)
    expect(result.meta.status).toBe('success')
  })
})

describe('videoEditor', () => {
  it('script 编辑返回正确重跑计划', async () => {
    const result = await videoEditor({
      originalVideo: makeVideo(),
      editType: 'script',
      editRequest: { type: 'script', lineId: 'l1', newText: '新文案' },
      reuseArtifacts: true,
    })
    expect(result.rerunPlan).toContain('script-writer')
    expect(result.rerunPlan).toContain('tts-engine')
    expect(result.rerunPlan).toContain('final-composer')
    expect(result.incrementalCostYuan).toBe(0.05)
  })

  it('shot 编辑成本更高', async () => {
    const result = await videoEditor({
      originalVideo: makeVideo(),
      editType: 'shot',
      editRequest: { type: 'shot', shotId: 's1', newMotionPrompt: 'zoom in' },
      reuseArtifacts: true,
    })
    expect(result.rerunPlan).toContain('video-generator')
    expect(result.incrementalCostYuan).toBe(0.3)
  })
})

describe('shotUpgrader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env['SEEDANCE_API_KEY'] = 'test-key'
    process.env['VCE_BASE_URL'] = 'https://api.vce.test'
  })

  it('提交+轮询成功', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { task_id: 'task_1' } }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { task_status: 'succeed', task_result: { videos: [{ url: 'https://cdn.test/upgraded.mp4' }] } } }),
      })

    const result = await shotUpgrader({
      originalShot: makeVideo(),
      upgradeModel: 'seedance-2.0',
      reason: 'hero shot needs higher quality',
    })
    expect(result.upgradedShot.url).toBe('https://cdn.test/upgraded.mp4')
    expect(result.meta.costYuan).toBe(0.8)
  }, 30_000)

  it('提交失败抛错', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 })
    await expect(shotUpgrader({
      originalShot: makeVideo(),
      upgradeModel: 'seedance-1.5',
      reason: 'test',
    })).rejects.toThrow('升级任务提交失败')
  })
})
