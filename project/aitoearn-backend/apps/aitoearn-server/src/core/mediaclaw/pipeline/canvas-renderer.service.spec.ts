import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CanvasRendererService } from './canvas-renderer.service'

const pipelineUtils = vi.hoisted(() => ({
  pathExists: vi.fn().mockResolvedValue(false),
  runCommand: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
  ensureParentDirectory: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('./pipeline.utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./pipeline.utils')>()
  return {
    ...actual,
    pathExists: pipelineUtils.pathExists,
    runCommand: pipelineUtils.runCommand,
    ensureParentDirectory: pipelineUtils.ensureParentDirectory,
  }
})

describe('canvasRendererService', () => {
  beforeEach(() => {
    pipelineUtils.pathExists.mockReset()
    pipelineUtils.pathExists.mockResolvedValue(false)
    pipelineUtils.runCommand.mockReset()
    pipelineUtils.runCommand.mockResolvedValue({ stdout: '', stderr: '' })
    pipelineUtils.ensureParentDirectory.mockReset()
    pipelineUtils.ensureParentDirectory.mockResolvedValue(undefined)
  })

  it('应生成带转场与文案的 ffmpeg 渲染命令', async () => {
    const service = new CanvasRendererService()

    const outputPath = await service.renderSlides(
      [
        { text: '第一屏：开场钩子', duration: 3, bgColor: '#111111' },
        { text: '第二屏：卖点解释', duration: 4, bgColor: '#222222' },
      ],
      '/tmp/mediaclaw-canvas/output.mp4',
    )

    expect(outputPath).toBe('/tmp/mediaclaw-canvas/output.mp4')
    expect(pipelineUtils.ensureParentDirectory).toHaveBeenCalledWith('/tmp/mediaclaw-canvas/output.mp4')
    expect(pipelineUtils.runCommand).toHaveBeenCalledWith(
      'ffmpeg',
      expect.arrayContaining([
        '-filter_complex',
        expect.stringContaining('drawtext=text='),
        expect.stringContaining('xfade=transition=fade'),
        '/tmp/mediaclaw-canvas/output.mp4',
      ]),
      expect.objectContaining({ timeoutMs: 180_000 }),
    )
  })
})
