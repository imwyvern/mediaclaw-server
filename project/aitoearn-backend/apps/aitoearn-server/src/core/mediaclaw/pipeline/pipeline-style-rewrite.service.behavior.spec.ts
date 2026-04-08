import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PipelineStyleRewriteService } from './pipeline-style-rewrite.service'

describe('pipelineStyleRewriteService', () => {
  let service: PipelineStyleRewriteService

  beforeEach(() => {
    service = new TestablePipelineStyleRewriteService()
    vi.restoreAllMocks()
  })

  it('应为 shared 模式复用同一套 style rewrite 方案并锁定构图', () => {
    service = new TestablePipelineStyleRewriteService([24680])
    const context = createContext({
      templateId: 'b7-ai-live',
      styleRewrite: {
        enabled: true,
        scope: 'shared',
        preserveComposition: true,
        preserveProductPlacement: true,
        mutationDomains: [
          'table surface material',
          'tableware',
          'flowers',
          'ornaments',
          'lighting direction',
          'color temperature',
          'background elements',
        ],
      },
    })

    const firstResult = service.prepareFrame(context as any, context.frameArtifacts[0])
    context.frameArtifacts[0].styleRewritePlan = firstResult.plan
    const secondResult = service.prepareFrame(context as any, context.frameArtifacts[1])

    expect(firstResult.promptKey).toBe('style-rewrite:shared')
    expect(secondResult.promptKey).toBe('style-rewrite:shared')
    expect(secondResult.plan).toEqual(firstResult.plan)
    expect(firstResult.prompt).toContain('Keep the exact same composition')
    expect(firstResult.prompt).toContain('Keep the exact same product placement')
    expect(firstResult.prompt).toContain('Seed: 24680.')
    expect(firstResult.prompt).toContain('Change the table surface material')
    expect(firstResult.prompt).toContain('Change the lighting direction')
    expect(firstResult.prompt).toContain('Change the background elements')
  })

  it('应为 per_scene 模式按镜头生成独立 style rewrite 方案', () => {
    service = new TestablePipelineStyleRewriteService([13579, 97531])

    const context = createContext({
      templateId: 'b9-product-showcase',
      styleRewrite: {
        enabled: true,
        scope: 'per_scene',
        preserveComposition: true,
        preserveProductPlacement: true,
        mutationDomains: [
          'table surface material',
          'tableware',
          'flowers',
          'ornaments',
          'lighting direction',
          'color temperature',
          'background elements',
        ],
      },
    })

    const firstResult = service.prepareFrame(context as any, context.frameArtifacts[0])
    const secondResult = service.prepareFrame(context as any, context.frameArtifacts[1])

    expect(firstResult.promptKey).toBe('style-rewrite:0')
    expect(secondResult.promptKey).toBe('style-rewrite:1')
    expect(firstResult.plan?.seed).toBe(13579)
    expect(secondResult.plan?.seed).toBe(97531)
    expect(firstResult.plan?.scope).toBe('per_scene')
    expect(secondResult.plan?.scope).toBe('per_scene')
    expect(firstResult.prompt).toContain('This shot can use its own rewritten style direction within the same batch.')
  })

  it('应在关闭 style rewrite 时回退到普通品牌编辑 prompt', () => {
    const context = createContext({
      styleRewrite: {
        enabled: false,
        scope: 'shared',
        preserveComposition: true,
        preserveProductPlacement: true,
        mutationDomains: [],
      },
    })

    const result = service.prepareFrame(context as any, context.frameArtifacts[0])

    expect(result.promptKey).toBe('edit-frames')
    expect(result.plan).toBeNull()
    expect(result.prompt).toContain('Edit the frame for brand 测试品牌.')
    expect(result.prompt).toContain('Keep the original composition and motion clue for the hook shot.')
    expect(result.prompt).not.toContain('Seed:')
  })
})

class TestablePipelineStyleRewriteService extends PipelineStyleRewriteService {
  constructor(private readonly seeds: number[] = []) {
    super()
  }

  protected override createSeed() {
    return this.seeds.shift() ?? 12345
  }
}

function createContext(overrides: Record<string, unknown> = {}) {
  return {
    taskId: 'task-1',
    orgId: 'org-1',
    workspaceDir: '/tmp/mediaclaw-style-rewrite',
    templateId: 'b7-ai-live',
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
      colors: ['#FFAA00', '#111111'],
      fonts: ['PingFang SC'],
      slogans: ['好喝不贵'],
      keywords: ['精酿', '啤酒'],
      prohibitedWords: ['疗效'],
      preferredDuration: 15,
      aspectRatio: '9:16',
      subtitleStyle: {},
      referenceVideoUrl: '',
    },
    styleRewrite: {
      enabled: true,
      scope: 'shared',
      preserveComposition: true,
      preserveProductPlacement: true,
      mutationDomains: [],
    },
    frameArtifacts: [
      {
        index: 0,
        label: 'hook',
        timestampSeconds: 0,
        sourcePath: '/tmp/frame-1.png',
      },
      {
        index: 1,
        label: 'product',
        timestampSeconds: 5,
        sourcePath: '/tmp/frame-2.png',
      },
    ],
    segmentVideoPaths: [],
    subtitles: [],
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
    prompts: {},
    models: {
      copy: {
        capability: 'copy',
        id: 'copy-model',
        label: 'Copy Model',
        provider: 'deepseek',
        runtimeModel: 'deepseek-chat',
        source: 'default',
      },
      frameEdit: {
        capability: 'frameEdit',
        id: 'frame-edit-model',
        label: 'Frame Edit Model',
        provider: 'vce',
        runtimeModel: 'gemini-2.5-flash-image',
        source: 'default',
      },
      videoGen: {
        capability: 'videoGen',
        id: 'video-model',
        label: 'Video Model',
        provider: 'kling',
        runtimeModel: 'kling-v3-omni',
        source: 'default',
      },
    },
    ...overrides,
  }
}
