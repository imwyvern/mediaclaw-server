import { GUARDS_METADATA, INTERCEPTORS_METADATA } from '@nestjs/common/constants'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DistributionController } from '../../../apps/aitoearn-server/src/core/mediaclaw/distribution/distribution.controller'
import { DistributionService } from '../../../apps/aitoearn-server/src/core/mediaclaw/distribution/distribution.service'
import {
  createMediaClawTestApp,
  testAccessToken,
  testUser,
} from './test-app.helper'

Reflect.defineMetadata('design:paramtypes', [DistributionService], DistributionController)
Reflect.defineMetadata(GUARDS_METADATA, [], DistributionController)
Reflect.defineMetadata(INTERCEPTORS_METADATA, [], DistributionController)

describe('MediaClaw Distribution E2E', () => {
  let app: Awaited<ReturnType<typeof createMediaClawTestApp>>['app']
  let client: Awaited<ReturnType<typeof createMediaClawTestApp>>['client']

  const distributionService = {
    distribute: vi.fn(),
    handleEmployeeCallback: vi.fn(),
    getDashboardStats: vi.fn(),
  }

  beforeAll(async () => {
    const testApp = await createMediaClawTestApp({
      controllers: [DistributionController],
      providers: [
        { provide: DistributionService, useValue: distributionService },
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
    distributionService.distribute.mockResolvedValue({
      deliveryId: '507f1f77bcf86cd799439091',
      lifecycleStatus: 'pushed',
    })
    distributionService.handleEmployeeCallback.mockResolvedValue({
      deliveryId: '507f1f77bcf86cd799439091',
      lifecycleStatus: 'published',
      publishUrl: 'https://www.xiaohongshu.com/explore/distribution-demo',
    })
    distributionService.getDashboardStats.mockResolvedValue({
      pushed: 10,
      published: 7,
      expired: 1,
      pushToPublishConversionRate: 70,
      averagePublishHours: 6.5,
    })
  })

  it('应完成分发创建、员工回调发布和转化看板查询', async () => {
    const pushResponse = await client
      .post('/api/v1/distribution/push')
      .set('authorization', `Bearer ${testAccessToken}`)
      .send({
        contentId: '507f1f77bcf86cd799439081',
        targets: [
          {
            target: 'feishu:employee-1',
            action: 'notify',
          },
        ],
      })

    expect(pushResponse.status).toBe(201)
    expect(distributionService.distribute).toHaveBeenCalledWith(
      testUser.orgId,
      '507f1f77bcf86cd799439081',
      [
        {
          target: 'feishu:employee-1',
          action: 'notify',
        },
      ],
    )

    const callbackResponse = await client
      .post('/api/v1/distribution/507f1f77bcf86cd799439091/callback')
      .set('authorization', `Bearer ${testAccessToken}`)
      .send({
        status: 'published',
        publishUrl: 'https://www.xiaohongshu.com/explore/distribution-demo',
        platform: 'xiaohongshu',
      })

    expect(callbackResponse.status).toBe(201)
    expect(distributionService.handleEmployeeCallback).toHaveBeenCalledWith(
      testUser.orgId,
      '507f1f77bcf86cd799439091',
      {
        status: 'published',
        publishUrl: 'https://www.xiaohongshu.com/explore/distribution-demo',
        platform: 'xiaohongshu',
      },
    )

    const dashboardResponse = await client
      .get('/api/v1/distribution/dashboard?days=30&status=published')
      .set('authorization', `Bearer ${testAccessToken}`)

    expect(dashboardResponse.status).toBe(200)
    expect(distributionService.getDashboardStats).toHaveBeenCalledWith(
      testUser.orgId,
      {
        days: '30',
        status: 'published',
      },
    )
    expect(dashboardResponse.body).toEqual(expect.objectContaining({
      pushToPublishConversionRate: 70,
    }))
  })
})
