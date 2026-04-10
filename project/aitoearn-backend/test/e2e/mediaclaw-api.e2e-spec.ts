import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { CompetitorController } from '../../apps/aitoearn-server/src/core/mediaclaw/competitor/competitor.controller'
import { CompetitorService } from '../../apps/aitoearn-server/src/core/mediaclaw/competitor/competitor.service'
import { DiscoveryController } from '../../apps/aitoearn-server/src/core/mediaclaw/discovery/discovery.controller'
import { ContentRemixService } from '../../apps/aitoearn-server/src/core/mediaclaw/discovery/content-remix.service'
import { DiscoveryService } from '../../apps/aitoearn-server/src/core/mediaclaw/discovery/discovery.service'
import { PipelineMatchController } from '../../apps/aitoearn-server/src/core/mediaclaw/pipeline-match/pipeline-match.controller'
import { PipelineMatchService } from '../../apps/aitoearn-server/src/core/mediaclaw/pipeline-match/pipeline-match.service'
import { PipelineController } from '../../apps/aitoearn-server/src/core/mediaclaw/pipeline/pipeline.controller'
import { PipelineService } from '../../apps/aitoearn-server/src/core/mediaclaw/pipeline/pipeline.service'
import { UsageTrackingInterceptor } from '../../apps/aitoearn-server/src/core/mediaclaw/usage/usage-tracking.interceptor'
import { UsageService } from '../../apps/aitoearn-server/src/core/mediaclaw/usage/usage.service'
import { ZodValidationPipe } from '../../libs/common/src/pipes/zod-validation.pipe'

const testUser = {
  id: 'user-1',
  orgId: '507f1f77bcf86cd799439011',
  role: 'admin',
  apiKeyId: 'mc_live_test_key',
}

Reflect.defineMetadata('design:paramtypes', [CompetitorService], CompetitorController)
Reflect.defineMetadata('design:paramtypes', [DiscoveryService, ContentRemixService], DiscoveryController)
Reflect.defineMetadata('design:paramtypes', [PipelineMatchService], PipelineMatchController)
Reflect.defineMetadata('design:paramtypes', [PipelineService], PipelineController)
Reflect.defineMetadata('design:paramtypes', [UsageService], UsageTrackingInterceptor)

function createResponseMock(name: string) {
  return vi.fn(async (...args: any[]) => ({
    handler: name,
    args,
  }))
}

describe('MediaClaw API Smoke E2E', () => {
  let app: INestApplication
  let baseUrl: string

  const competitorService = {
    addCompetitor: createResponseMock('addCompetitor'),
    getCompetitorHot: createResponseMock('getCompetitorHot'),
    getIndustryHot: createResponseMock('getIndustryHot'),
    listCompetitors: createResponseMock('listCompetitors'),
    removeCompetitor: createResponseMock('removeCompetitor'),
    syncCompetitor: createResponseMock('syncCompetitor'),
  }

  const discoveryService = {
    calculateViralScore: vi.fn().mockReturnValue(88),
    getRecommendationPool: createResponseMock('getRecommendationPool'),
    markRemixed: createResponseMock('markRemixed'),
  }

  const contentRemixService = {
    analyzeViralElements: createResponseMock('analyzeViralElements'),
    applyRemixInsights: createResponseMock('applyRemixInsights'),
    generateRemixBrief: createResponseMock('generateRemixBrief'),
  }

  const pipelineMatchService = {
    analyzeReferenceVideo: createResponseMock('analyzeReferenceVideo'),
    matchPipeline: createResponseMock('matchPipeline'),
  }

  const pipelineService = {
    archive: createResponseMock('archivePipeline'),
    bindGroup: createResponseMock('bindGroup'),
    create: createResponseMock('createPipeline'),
    findById: createResponseMock('findPipeline'),
    findByOrg: createResponseMock('listPipeline'),
    update: createResponseMock('updatePipeline'),
    updateDistributionRules: createResponseMock('updatePipelineDistributionRules'),
    updateModelOverrides: createResponseMock('updatePipelineModelOverrides'),
    updatePreferences: createResponseMock('updatePipelinePreferences'),
  }

  const usageService = {
    trackRequest: vi.fn().mockResolvedValue(undefined),
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [
        CompetitorController,
        DiscoveryController,
        PipelineController,
        PipelineMatchController,
      ],
      providers: [
        UsageTrackingInterceptor,
        { provide: CompetitorService, useValue: competitorService },
        { provide: DiscoveryService, useValue: discoveryService },
        { provide: ContentRemixService, useValue: contentRemixService },
        { provide: PipelineService, useValue: pipelineService },
        { provide: PipelineMatchService, useValue: pipelineMatchService },
        { provide: UsageService, useValue: usageService },
      ],
    }).compile()

    app = moduleRef.createNestApplication()
    app.useGlobalPipes(new ZodValidationPipe())
    app.use((req: any, _res: any, next: () => void) => {
      req.user = { ...testUser }
      next()
    })
    await app.listen(0, '127.0.0.1')
    const address = app.getHttpServer().address()
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    discoveryService.calculateViralScore.mockReturnValue(88)
    usageService.trackRequest.mockResolvedValue(undefined)
  })

  async function request(path: string, init: RequestInit = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(init.headers || {}),
      },
    })
    const bodyText = await response.text()

    return {
      status: response.status,
      body: bodyText ? JSON.parse(bodyText) : null,
    }
  }

  it('POST /api/v1/discovery/score should calculate viral score', async () => {
    const response = await request('/api/v1/discovery/score', {
      method: 'POST',
      body: JSON.stringify({
        views: 1000,
        likes: 100,
        comments: 20,
        shares: 10,
        publishedAt: '2026-04-01T00:00:00.000Z',
        videoKeywords: ['宠物'],
        industryKeywords: ['消费'],
      }),
    })

    expect(response.status).toBe(201)
    expect(response.body).toEqual({ viralScore: 88 })
    expect(discoveryService.calculateViralScore).toHaveBeenCalledWith(
      {
        views: 1000,
        likes: 100,
        comments: 20,
        shares: 10,
        keywords: ['宠物'],
      },
      '2026-04-01T00:00:00.000Z',
      ['消费'],
    )
  })

  it('POST /api/v1/discovery/mark-remixed should proxy remix completion', async () => {
    const response = await request('/api/v1/discovery/mark-remixed', {
      method: 'POST',
      body: JSON.stringify({
        contentId: 'content-1',
        taskId: 'task-1',
      }),
    })

    expect(response.status).toBe(201)
    expect(discoveryService.markRemixed).toHaveBeenCalledWith('content-1', 'task-1')
  })

  it('POST /api/v1/competitors should add competitor', async () => {
    const response = await request('/api/v1/competitors', {
      method: 'POST',
      body: JSON.stringify({
        platform: 'douyin',
        accountUrl: 'https://www.douyin.com/user/demo',
      }),
    })

    expect(response.status).toBe(201)
    expect(competitorService.addCompetitor).toHaveBeenCalledWith(
      testUser.orgId,
      'douyin',
      'https://www.douyin.com/user/demo',
    )
  })

  it('POST /api/v1/pipelines should create pipeline', async () => {
    const response = await request('/api/v1/pipelines', {
      method: 'POST',
      body: JSON.stringify({
        brandId: '507f1f77bcf86cd799439012',
        name: '新品种草',
        description: '高转化模板',
      }),
    })

    expect(response.status).toBe(201)
    expect(pipelineService.create).toHaveBeenCalledWith(
      testUser.orgId,
      '507f1f77bcf86cd799439012',
      {
        brandId: '507f1f77bcf86cd799439012',
        name: '新品种草',
        description: '高转化模板',
      },
    )
  })

  it('POST /api/v1/pipelines/match should proxy pipeline match', async () => {
    const response = await request('/api/v1/pipelines/match', {
      method: 'POST',
      body: JSON.stringify({
        referenceVideoUrl: 'https://example.com/video.mp4',
        category: 'beauty',
        style: 'storytelling',
        duration: 30,
        budget: 100,
      }),
    })

    expect(response.status).toBe(201)
    expect(pipelineMatchService.matchPipeline).toHaveBeenCalledWith({
      referenceVideoUrl: 'https://example.com/video.mp4',
      category: 'beauty',
      style: 'storytelling',
      duration: 30,
      budget: 100,
    })
  })
})
