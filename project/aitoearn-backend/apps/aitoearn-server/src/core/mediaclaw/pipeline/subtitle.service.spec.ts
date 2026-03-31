import { vi } from 'vitest'
import { DeepSynthesisMarkerService } from './deep-synthesis-marker.service'

const pipelineUtils = vi.hoisted(() => ({
  pathExists: vi.fn().mockResolvedValue(false),
  runCommand: vi.fn(),
}))

vi.mock('./pipeline.utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./pipeline.utils')>()
  return {
    ...actual,
    pathExists: pipelineUtils.pathExists,
    runCommand: pipelineUtils.runCommand,
  }
})

import { describe, expect, it, beforeEach } from 'vitest'
import { SubtitleService } from './subtitle.service'

describe('SubtitleService', () => {
  beforeEach(() => {
    pipelineUtils.pathExists.mockReset()
    pipelineUtils.pathExists.mockResolvedValue(false)
    pipelineUtils.runCommand.mockReset()
  })

  it('should add visible watermark text and metadata in drawtext mode', async () => {
    pipelineUtils.runCommand
      .mockResolvedValueOnce({ stdout: 'drawtext', stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })

    const service = new SubtitleService(new DeepSynthesisMarkerService())
    const result = await service.renderSubtitles({
      taskId: 'task-1',
      workspaceDir: '/tmp/mediaclaw-subtitle',
      sourceVideoPath: '/tmp/source.mp4',
      sourceMetadata: {
        durationSeconds: 15,
        width: 1080,
        height: 1920,
        frameRate: 30,
        hasAudio: true,
      },
      targetDurationSeconds: 15,
      renderWidth: 1080,
      renderHeight: 1920,
      brand: {
        id: 'brand-1',
        name: '测试品牌',
        colors: [],
        fonts: [],
        slogans: [],
        keywords: [],
        prohibitedWords: [],
        preferredDuration: 15,
        aspectRatio: '9:16',
        subtitleStyle: {},
        referenceVideoUrl: '',
      },
      frameArtifacts: [],
      segmentVideoPaths: [],
      subtitles: [
        {
          text: '这是字幕',
          startSeconds: 0,
          endSeconds: 3,
        },
      ],
      dedupStrategy: {
        cropScale: 1,
        cropXRatio: 0,
        cropYRatio: 0,
        hueShift: 0,
        saturation: 1,
        contrast: 1,
        brightness: 0,
        noise: 0,
        speedFactor: 1,
        metadataFingerprint: 'fp-1',
      },
      preserveSourceAudio: true,
      composedVideoPath: '/tmp/composed.mp4',
    })

    const ffmpegArgs = pipelineUtils.runCommand.mock.calls[1]?.[1] as string[]
    expect(result.deepSynthesisMarker.visibleLabel).toBe('AI深度合成')
    expect(ffmpegArgs).toContain('-vf')
    expect(ffmpegArgs[ffmpegArgs.indexOf('-vf') + 1]).toContain('AI深度合成')
    expect(ffmpegArgs[ffmpegArgs.indexOf('-vf') + 1]).toContain('测试品牌')
    expect(ffmpegArgs).toContain('-metadata')
    expect(ffmpegArgs.some(arg => arg.includes('comment=AI深度合成'))).toBe(true)
  })
})
