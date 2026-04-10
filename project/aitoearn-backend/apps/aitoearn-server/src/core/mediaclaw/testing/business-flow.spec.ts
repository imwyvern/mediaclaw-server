import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JwtService } from '@nestjs/jwt'
import {
  BrandAssetType,
  NotificationEvent,
  VideoTaskStatus,
} from '@yikart/mongodb'
import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnalyticsService } from '../analytics/analytics.service'
import { AssetService } from '../asset/asset.service'
import { McAuthService } from '../auth/auth.service'
import {
  DistributionCallbackStatus,
  DistributionLifecycleStatus,
  DistributionPublishStatus,
} from '../distribution/distribution.constants'
import { DistributionService } from '../distribution/distribution.service'
import { PipelinePreferenceLearningService } from '../pipeline/pipeline-preference-learning.service'
import { PipelineService } from '../pipeline/pipeline.service'

function createQuery<T>(value: T) {
  const query = {
    lean: vi.fn(),
    limit: vi.fn(),
    populate: vi.fn(),
    select: vi.fn(),
    skip: vi.fn(),
    sort: vi.fn(),
    exec: vi.fn().mockResolvedValue(value),
  }

  query.lean.mockReturnValue(query)
  query.limit.mockReturnValue(query)
  query.populate.mockReturnValue(query)
  query.select.mockReturnValue(query)
  query.skip.mockReturnValue(query)
  query.sort.mockReturnValue(query)

  return query
}

function setByPath(target: Record<string, any>, path: string, value: unknown) {
  const segments = path.split('.')
  let cursor = target

  for (const segment of segments.slice(0, -1)) {
    const current = cursor[segment]
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      cursor[segment] = {}
    }
    cursor = cursor[segment]
  }

  cursor[segments.at(-1) || path] = value
}

function applyMongoUpdate(target: Record<string, any>, update: Record<string, any>) {
  const setPayload = update['$set'] as Record<string, unknown> | undefined
  if (setPayload) {
    for (const [path, value] of Object.entries(setPayload)) {
      setByPath(target, path, value)
    }
  }

  const pushPayload = update['$push'] as Record<string, unknown> | undefined
  if (pushPayload) {
    for (const [path, value] of Object.entries(pushPayload)) {
      const segments = path.split('.')
      let cursor = target
      for (const segment of segments.slice(0, -1)) {
        const current = cursor[segment]
        if (!current || typeof current !== 'object' || Array.isArray(current)) {
          cursor[segment] = {}
        }
        cursor = cursor[segment]
      }

      const leaf = segments.at(-1) || path
      if (!Array.isArray(cursor[leaf])) {
        cursor[leaf] = []
      }

      const items = value && typeof value === 'object' && '$each' in (value as Record<string, unknown>)
        ? (((value as Record<string, unknown>)['$each']) as unknown[])
        : [value]

      cursor[leaf].push(...items)
    }
  }
}

describe('mediaclaw business flow', () => {
  let workspaceDir: string

  beforeEach(async () => {
    workspaceDir = await mkdtemp(join(tmpdir(), 'mediaclaw-business-flow-'))
  })

  afterEach(async () => {
    await rm(workspaceDir, { recursive: true, force: true })
  })

  it('应跑通注册、品牌资产、管线生产、分发发布与数据回流闭环', async () => {
    const organizations: Array<Record<string, any>> = []
    const users: Array<Record<string, any>> = []
    const videoPacks: Array<Record<string, any>> = []
    const assetVersions: Array<Record<string, any>> = []
    const orgId = new Types.ObjectId()
    const brandId = new Types.ObjectId()
    const taskId = new Types.ObjectId()
    const pipelineId = new Types.ObjectId()

    const jwtService = {
      sign: vi.fn((payload: Record<string, any>) => `jwt-${payload['id']}`),
    } satisfies Partial<JwtService>

    const userModel = {
      findOne: vi.fn((query: Record<string, any>) => {
        const record = users.find((item) => {
          if (query['phone']) {
            return item['phone'] === query['phone']
          }
          if (query['email']) {
            return item['email'] === query['email']
          }
          return false
        }) || null
        return createQuery(record)
      }),
      create: vi.fn(async (payload: Record<string, any>) => {
        const user = {
          _id: new Types.ObjectId(),
          ...payload,
          toObject() {
            return this
          },
        }
        users.push(user)
        return user
      }),
      findByIdAndUpdate: vi.fn((id: Types.ObjectId, update: Record<string, any>) => {
        const user = users.find(item => item['_id'].toString() === id.toString()) || null
        if (user) {
          applyMongoUpdate(user, update)
        }
        return createQuery(user)
      }),
    }

    const organizationModel = {
      create: vi.fn(async (payload: Record<string, any>) => {
        const organization = {
          _id: orgId,
          monthlyQuota: 50,
          monthlyUsed: 0,
          ...payload,
          toObject() {
            return this
          },
        }
        organizations.push(organization)
        return organization
      }),
    }

    const videoPackModel = {
      create: vi.fn(async (payload: Record<string, any>) => {
        videoPacks.push(payload)
        return {
          _id: new Types.ObjectId(),
          ...payload,
        }
      }),
    }

    const authService = new McAuthService(
      userModel as any,
      videoPackModel as any,
      organizationModel as any,
      jwtService as JwtService,
      undefined,
    )

    const registerResult = await authService.compatRegister({
      account: 'demo@mediaclaw.com',
      password: 'Secret123',
      company: 'Demo Org',
    })

    expect(registerResult.accessToken).toBe(`jwt-${registerResult.user.id}`)
    expect(registerResult.user.orgId?.toString()).toBe(orgId.toString())
    expect(organizations).toHaveLength(1)
    expect(videoPacks).toHaveLength(1)

    const brandRecord: Record<string, any> = {
      _id: brandId,
      orgId,
      isActive: true,
      name: 'Demo Brand',
      assets: {
        logoUrl: '',
        colors: ['#101820'],
        fonts: ['PingFang SC'],
        slogans: ['评论区领取完整脚本'],
        keywords: ['精华', '护肤'],
      },
      videoStyle: {
        preferredDuration: 15,
        aspectRatio: '9:16',
        referenceVideoUrl: 'https://cdn.example.com/reference.mp4',
      },
    }

    const brandModel = {
      exists: vi.fn().mockResolvedValue(true),
      findOne: vi.fn().mockReturnValue(createQuery(brandRecord)),
      findByIdAndUpdate: vi.fn((id: Types.ObjectId, update: Record<string, any>) => {
        if (id.toString() === brandId.toString()) {
          applyMongoUpdate(brandRecord, update)
        }
        return createQuery(brandRecord)
      }),
    }

    const brandAssetVersionModel = {
      findOne: vi.fn(() => createQuery(assetVersions.at(-1) || null)),
      updateMany: vi.fn(() => createQuery({ modifiedCount: assetVersions.length })),
      create: vi.fn(async (payload: Record<string, any>) => {
        const asset = {
          _id: new Types.ObjectId(),
          createdAt: new Date('2026-04-09T00:00:00.000Z'),
          updatedAt: new Date('2026-04-09T00:00:00.000Z'),
          ...payload,
        }
        assetVersions.push(asset)
        return asset
      }),
    }

    const assetService = new AssetService(
      brandModel as any,
      brandAssetVersionModel as any,
    )

    const asset = await assetService.uploadAsset(
      orgId.toString(),
      brandId.toString(),
      BrandAssetType.LOGO,
      {
        fileUrl: 'https://cdn.example.com/assets/logo.png',
        fileName: 'logo.png',
        uploadedBy: registerResult.user.id,
      },
    )

    expect(asset.fileUrl).toBe('https://cdn.example.com/assets/logo.png')
    expect(brandRecord['assets']['logoUrl']).toBe('https://cdn.example.com/assets/logo.png')

    const createdPipelines: Array<Record<string, any>> = []
    const pipelineModel = {
      create: vi.fn(async (payload: Record<string, any>) => {
        const pipeline = {
          _id: pipelineId,
          ...payload,
          toObject() {
            return this
          },
        }
        createdPipelines.push(pipeline)
        return pipeline
      }),
      find: vi.fn().mockReturnValue(createQuery([])),
      findById: vi.fn().mockReturnValue(createQuery(null)),
      findByIdAndUpdate: vi.fn().mockReturnValue(createQuery(null)),
      findOne: vi.fn().mockReturnValue(createQuery(null)),
      findOneAndUpdate: vi.fn().mockReturnValue(createQuery(null)),
    }
    const frameExtractService = {
      ensureLocalVideo: vi.fn(),
      probeVideoMetadata: vi.fn(),
      extractKeyFrames: vi.fn(),
    }
    const brandEditService = {
      applyBranding: vi.fn(),
    }
    const sourceSegmentPath = join(workspaceDir, 'segment.mp4')
    const composedPath = join(workspaceDir, 'composed.mp4')
    const subtitledPath = join(workspaceDir, 'subtitled.mp4')
    await writeFile(sourceSegmentPath, Buffer.from('segment'))
    await writeFile(composedPath, Buffer.from('video'))
    await writeFile(subtitledPath, Buffer.from('subtitled'))

    const videoGenService = {
      generateSegments: vi.fn().mockResolvedValue({
        segmentPaths: [sourceSegmentPath],
        result: {
          provider: 'kling',
          status: 'completed',
        },
      }),
      composeSegments: vi.fn().mockResolvedValue(composedPath),
    }
    const canvasRendererService = {
      renderSlides: vi.fn(),
    }
    const deepSynthesisMarkerService = {
      createMarker: vi.fn().mockReturnValue({
        visibleLabel: 'AI 生成',
        watermarkText: 'MediaClaw',
        metadata: {},
        manifest: {
          standard: 'mc-v1',
        },
      }),
    }
    const subtitleService = {
      renderSubtitles: vi.fn().mockResolvedValue({
        outputPath: subtitledPath,
        deepSynthesisMarker: {
          visibleLabel: 'AI 生成',
        },
      }),
    }
    const dedupService = {
      applyVideoPostProcess: vi.fn(async (input: Record<string, any>) => {
        await copyFile(subtitledPath, input['outputVideoPath'])
      }),
      createStrategy: vi.fn(),
    }
    const qualityCheckService = {
      assertQuality: vi.fn(),
    }
    const modelResolverService = {
      validatePipelineOverrides: vi.fn().mockResolvedValue({}),
      resolveCapability: vi.fn(),
    }
    const templateRegistry = {
      run: vi.fn().mockResolvedValue({
        templateId: 'b7-ai-live',
        type: 'seeding',
        name: 'B7 AI 微动效模板',
        description: '品牌微动效模板',
        styleConfig: {
          tone: '种草',
          platforms: ['douyin'],
          brandAssets: {
            productImages: ['https://cdn.example.com/assets/product-1.png'],
          },
        },
        distributionRules: {
          preferredPlatforms: ['douyin'],
        },
        preferences: {
          preferredDuration: 15,
        },
      }),
    }
    const ttsService = {
      isConfigured: vi.fn().mockReturnValue(true),
      generateVoiceover: vi.fn().mockResolvedValue({
        buffer: Buffer.from('voiceover'),
        provider: 'minimax',
        voiceId: 'Chinese_Female_Gentle',
        format: 'mp3',
        sampleRate: 32000,
        durationMs: 3200,
      }),
    }

    const pipelineService = new PipelineService(
      pipelineModel as any,
      brandModel as any,
      frameExtractService as any,
      brandEditService as any,
      videoGenService as any,
      canvasRendererService as any,
      deepSynthesisMarkerService as any,
      subtitleService as any,
      dedupService as any,
      qualityCheckService as any,
      modelResolverService as any,
      new PipelinePreferenceLearningService(),
      templateRegistry as any,
      ttsService as any,
    )

    vi.spyOn(pipelineService as any, 'mixVoiceoverTrack').mockImplementation(
      async (inputVideoPath: string, _voiceoverPath: string, outputPath: string) => {
        await copyFile(inputVideoPath, outputPath)
        return outputPath
      },
    )

    const pipeline = await pipelineService.create(orgId.toString(), brandId.toString(), {
      templateType: 'b7-ai-live',
      params: {
        productImages: ['https://cdn.example.com/assets/product-1.png'],
        style: 'micro-motion',
      },
    })

    expect(templateRegistry.run).toHaveBeenCalledWith(
      'b7-ai-live',
      expect.objectContaining({
        brand: expect.objectContaining({
          id: brandId.toString(),
          logo: 'https://cdn.example.com/assets/logo.png',
        }),
      }),
    )
    expect(createdPipelines).toHaveLength(1)
    expect(pipeline['templateId']).toBe('b7-ai-live')

    const task: Record<string, any> = {
      _id: taskId,
      orgId,
      userId: registerResult.user.id,
      brandId,
      pipelineId,
      status: VideoTaskStatus.COMPLETED,
      sourceVideoUrl: 'https://cdn.example.com/source.mp4',
      outputVideoUrl: '',
      dedup: {
        status: 'passed',
      },
      metadata: {
        voiceover: {
          voiceId: 'Chinese_Female_Gentle',
        },
      },
      createdAt: new Date('2026-04-09T00:00:00.000Z'),
      completedAt: new Date('2026-04-09T00:05:00.000Z'),
      toObject() {
        return this
      },
    }

    const renderContext = await pipelineService.renderVideo(task as any, {
      workspaceDir,
      templateId: 'b7-ai-live',
      renderWidth: 1080,
      renderHeight: 1920,
      targetDurationSeconds: 15,
      brand: {
        name: 'Demo Brand',
        logo: brandRecord['assets']['logoUrl'],
        colors: brandRecord['assets']['colors'],
        fonts: brandRecord['assets']['fonts'],
        slogans: brandRecord['assets']['slogans'],
        keywords: brandRecord['assets']['keywords'],
        referenceVideoUrl: brandRecord['videoStyle']['referenceVideoUrl'],
        preferredDuration: 15,
        aspectRatio: '9:16',
      },
      sourceMetadata: {
        hasAudio: false,
      },
      subtitles: [],
      preserveSourceAudio: false,
      dedupStrategy: {},
    } as any)

    const finalContext = await pipelineService.finalizeVideo(
      task as any,
      renderContext,
      {
        title: '三步做出通透底妆',
        subtitle: '品牌卖点已经注入',
        description: '轻薄服帖，上镜不假面',
        hashtags: ['#美妆'],
        blueWords: ['通透'],
        commentGuide: '评论区回复【底妆】领取完整版脚本',
        commentGuides: ['评论区回复【底妆】领取完整版脚本'],
      } as any,
    )

    task['outputVideoUrl'] = finalContext.outputVideoUrl
    task['metadata']['voiceoverUrl'] = finalContext.voiceoverUrl

    expect(videoGenService.generateSegments).toHaveBeenCalledTimes(1)
    expect(ttsService.generateVoiceover).toHaveBeenCalledTimes(1)
    expect(finalContext.outputVideoUrl).toContain(taskId.toString())
    expect(finalContext.voiceoverUrl).toContain('voiceover')

    const videoTaskModel = {
      find: vi.fn().mockReturnValue(createQuery([task])),
      findOne: vi.fn().mockImplementation(() => createQuery(task)),
      findById: vi.fn().mockImplementation(() => createQuery(task)),
      findByIdAndUpdate: vi.fn((id: Types.ObjectId, update: Record<string, any>) => {
        if (id.toString() === taskId.toString()) {
          applyMongoUpdate(task, update)
        }
        return createQuery(task)
      }),
    }
    const distributionWebhookService = {
      trigger: vi.fn().mockResolvedValue(undefined),
    }
    const employeeDispatchService = {
      confirmPublished: vi.fn().mockResolvedValue({
        confirmed: false,
        reason: 'manual_confirm',
      }),
      batchDispatch: vi.fn(),
      expireDeliveryRecord: vi.fn(),
    }
    const notificationService = {
      send: vi.fn().mockResolvedValue(undefined),
    }

    const distributionService = new DistributionService(
      { find: vi.fn().mockReturnValue(createQuery([])) } as any,
      videoTaskModel as any,
      { findOne: vi.fn() } as any,
      distributionWebhookService as any,
      employeeDispatchService as any,
      notificationService as any,
      undefined,
    )

    const pushed = await distributionService.distribute(orgId.toString(), taskId.toString(), [
      {
        action: 'push',
        target: 'wecom-group-1',
      },
    ])

    expect(pushed.publishStatus).toBe(DistributionPublishStatus.PUSHED)
    expect(task['metadata']['distribution']['lifecycleStatus']).toBe(DistributionLifecycleStatus.PUSHED)

    const published = await distributionService.handleEmployeeCallback(
      orgId.toString(),
      taskId.toString(),
      {
        status: DistributionCallbackStatus.PUBLISHED,
        publishUrl: 'https://www.xiaohongshu.com/explore/demo-post',
        publishPostId: 'xhs-demo-post',
        platform: 'xiaohongshu',
      },
    )

    expect(published.publishStatus).toBe(DistributionPublishStatus.PUBLISHED)
    expect(task['status']).toBe(VideoTaskStatus.PUBLISHED)
    expect(task['metadata']['distribution']['publishUrl']).toBe('https://www.xiaohongshu.com/explore/demo-post')
    expect(notificationService.send).toHaveBeenCalledWith(
      orgId.toString(),
      NotificationEvent.CONTENT_PUBLISHED,
      expect.objectContaining({
        contentId: taskId.toString(),
      }),
    )

    const analyticsService = new AnalyticsService(
      {
        findOne: vi.fn().mockImplementation(() => createQuery(task)),
      } as any,
      {} as any,
      {
        getVideoLatestMetrics: vi.fn().mockResolvedValue({
          views: 10888,
          likes: 856,
          comments: 97,
          shares: 44,
          saves: 31,
          followers: 12,
          engagementRate: 9.47,
          publishPostId: 'xhs-demo-post',
          publishPostUrl: 'https://www.xiaohongshu.com/explore/demo-post',
        }),
      } as any,
    )

    const analytics = await analyticsService.getVideoStats(orgId.toString(), taskId.toString())

    expect(analytics.status).toBe(VideoTaskStatus.PUBLISHED)
    expect(analytics.performance.views).toBe(10888)
    expect(analytics.performance.likes).toBe(856)
    expect(analytics.latestAnalytics.publishPostId).toBe('xhs-demo-post')
  })
})
