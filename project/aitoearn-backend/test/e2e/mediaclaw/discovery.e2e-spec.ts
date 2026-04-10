import { GUARDS_METADATA, INTERCEPTORS_METADATA } from '@nestjs/common/constants'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContentRemixService } from '../../../apps/aitoearn-server/src/core/mediaclaw/discovery/content-remix.service'
import { DiscoveryController } from '../../../apps/aitoearn-server/src/core/mediaclaw/discovery/discovery.controller'
import { DiscoveryService } from '../../../apps/aitoearn-server/src/core/mediaclaw/discovery/discovery.service'
import { createMediaClawTestApp } from './test-app.helper'

Reflect.defineMetadata('design:paramtypes', [DiscoveryService, ContentRemixService], DiscoveryController)
Reflect.defineMetadata(GUARDS_METADATA, [], DiscoveryController)
Reflect.defineMetadata(INTERCEPTORS_METADATA, [], DiscoveryController)

describe('MediaClaw Discovery E2E', () => {
  let app: Awaited<ReturnType<typeof createMediaClawTestApp>>['app']
  let client: Awaited<ReturnType<typeof createMediaClawTestApp>>['client']

  const discoveryService = {
    getRecommendationPool: vi.fn(),
  }

  const contentRemixService = {
    analyzeViralElements: vi.fn(),
    generateRemixBrief: vi.fn(),
  }

  beforeAll(async () => {
    const testApp = await createMediaClawTestApp({
      controllers: [DiscoveryController],
      providers: [
        { provide: DiscoveryService, useValue: discoveryService },
        { provide: ContentRemixService, useValue: contentRemixService },
      ],
    })

    app = testApp.app
    client = testApp.client
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    discoveryService.getRecommendationPool.mockResolvedValue({
      orgId: null,
      total: 1,
      source: 'p90',
      items: [
        {
          contentId: '507f1f77bcf86cd799439061',
          title: '三秒抓住注意力的种草视频',
          viralScore: 96,
        },
      ],
    })
    contentRemixService.analyzeViralElements.mockResolvedValue({
      contentId: '507f1f77bcf86cd799439061',
      structure: ['3秒钩子', '快速对比', '行动召唤'],
    })
    contentRemixService.generateRemixBrief.mockResolvedValue({
      contentId: '507f1f77bcf86cd799439061',
      brandId: '507f1f77bcf86cd799439071',
      brief: '保留前三秒钩子，替换成品牌卖点演示。',
    })
  })

  it('应完成获取素材池、分析爆款并生成改编 brief', async () => {
    const poolResponse = await client
      .get('/api/v1/discovery/pool?limit=5&industry=美妆')

    expect(poolResponse.status).toBe(200)
    expect(poolResponse.body).toEqual(expect.objectContaining({
      total: 1,
      source: 'p90',
    }))

    const analyzeResponse = await client
      .post('/api/v1/discovery/analyze-viral-elements')
      .send({
        contentId: '507f1f77bcf86cd799439061',
      })

    expect(analyzeResponse.status).toBe(201)
    expect(contentRemixService.analyzeViralElements).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439061',
    )

    const remixBriefResponse = await client
      .post('/api/v1/discovery/generate-remix-brief')
      .send({
        contentId: '507f1f77bcf86cd799439061',
        brandId: '507f1f77bcf86cd799439071',
      })

    expect(remixBriefResponse.status).toBe(201)
    expect(contentRemixService.generateRemixBrief).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439061',
      '507f1f77bcf86cd799439071',
    )
  })
})
