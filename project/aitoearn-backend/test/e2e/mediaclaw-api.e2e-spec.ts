import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { McAccountController } from '../../apps/aitoearn-server/src/core/mediaclaw/account/account.controller'
import { McAccountService } from '../../apps/aitoearn-server/src/core/mediaclaw/account/account.service'
import { MediaClawApiKeyGuard } from '../../apps/aitoearn-server/src/core/mediaclaw/apikey/apikey.guard'
import { BrandController } from '../../apps/aitoearn-server/src/core/mediaclaw/brand/brand.controller'
import { BrandService } from '../../apps/aitoearn-server/src/core/mediaclaw/brand/brand.service'
import { ContentMgmtController } from '../../apps/aitoearn-server/src/core/mediaclaw/content-mgmt/content-mgmt.controller'
import { ContentMgmtService } from '../../apps/aitoearn-server/src/core/mediaclaw/content-mgmt/content-mgmt.service'
import { XorPayController } from '../../apps/aitoearn-server/src/core/mediaclaw/payment/xorpay.controller'
import { PaymentCreateThrottleGuard } from '../../apps/aitoearn-server/src/core/mediaclaw/payment/payment-create-throttle.guard'
import { XorPayService } from '../../apps/aitoearn-server/src/core/mediaclaw/payment/xorpay.service'
import { SkillController } from '../../apps/aitoearn-server/src/core/mediaclaw/skill/skill.controller'
import { SkillService } from '../../apps/aitoearn-server/src/core/mediaclaw/skill/skill.service'
import { UsageTrackingInterceptor } from '../../apps/aitoearn-server/src/core/mediaclaw/usage/usage-tracking.interceptor'
import { UsageService } from '../../apps/aitoearn-server/src/core/mediaclaw/usage/usage.service'

const testUser = {
  id: 'user-1',
  orgId: '507f1f77bcf86cd799439011',
  role: 'admin',
  apiKeyId: 'mc_live_test_key',
}

Reflect.defineMetadata('design:paramtypes', [ContentMgmtService], ContentMgmtController)
Reflect.defineMetadata('design:paramtypes', [McAccountService], McAccountController)
Reflect.defineMetadata('design:paramtypes', [BrandService], BrandController)
Reflect.defineMetadata('design:paramtypes', [XorPayService], XorPayController)
Reflect.defineMetadata('design:paramtypes', [SkillService], SkillController)
Reflect.defineMetadata('design:paramtypes', [UsageService], UsageTrackingInterceptor)

function createResponseMock(name: string) {
  return vi.fn(async (...args: any[]) => ({
    handler: name,
    args,
  }))
}

describe('MediaClaw API HTTP Integration', () => {
  let app: INestApplication
  let baseUrl: string

  const contentMgmtService = {
    approveContent: createResponseMock('approveContent'),
    batchEditCopy: createResponseMock('batchEditCopy'),
    editCopy: createResponseMock('editCopy'),
    exportContent: createResponseMock('exportContent'),
    getContent: createResponseMock('getContent'),
    getDownloadUrl: vi.fn(async () => 'https://cdn.example.com/video.mp4?signature=1'),
    getStylePreferences: createResponseMock('getStylePreferences'),
    listContent: createResponseMock('listContent'),
    listPendingContent: createResponseMock('listPendingContent'),
    markPublished: createResponseMock('markPublished'),
    reviewContent: createResponseMock('reviewContent'),
    setStylePreferences: createResponseMock('setStylePreferences'),
  }
  const accountService = {
    getInfo: createResponseMock('getInfo'),
    getUsage: createResponseMock('getUsage'),
    updateProfile: createResponseMock('updateProfile'),
  }
  const brandService = {
    create: createResponseMock('createBrand'),
    delete: createResponseMock('deleteBrand'),
    findById: createResponseMock('getBrand'),
    findByOrg: createResponseMock('listBrand'),
    update: createResponseMock('updateBrand'),
    updateAssets: createResponseMock('updateBrandAssets'),
    updateVideoStyle: createResponseMock('updateVideoStyle'),
  }
  const xorPayService = {
    createOrder: createResponseMock('createOrder'),
    getOrderStatus: createResponseMock('getOrderStatus'),
    getProducts: vi.fn(async () => ({ handler: 'getProducts' })),
    handleCallback: createResponseMock('handleCallback'),
    listOrders: createResponseMock('listOrders'),
  }
  const skillService = {
    confirmDelivery: createResponseMock('confirmDelivery'),
    getAgentConfig: createResponseMock('getAgentConfig'),
    getPendingDeliveries: createResponseMock('getPendingDeliveries'),
    registerAgent: createResponseMock('registerAgent'),
    submitFeedback: createResponseMock('submitFeedback'),
  }
  const usageService = {
    trackRequest: vi.fn().mockResolvedValue(undefined),
  }
  const mediaClawApiKeyGuard = {
    canActivate: vi.fn().mockResolvedValue(true),
  }
  const paymentCreateThrottleGuard = {
    canActivate: vi.fn().mockResolvedValue(true),
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [
        ContentMgmtController,
        McAccountController,
        BrandController,
        XorPayController,
        SkillController,
      ],
      providers: [
        UsageTrackingInterceptor,
        { provide: ContentMgmtService, useValue: contentMgmtService },
        { provide: McAccountService, useValue: accountService },
        { provide: BrandService, useValue: brandService },
        { provide: XorPayService, useValue: xorPayService },
        { provide: SkillService, useValue: skillService },
        { provide: UsageService, useValue: usageService },
        { provide: MediaClawApiKeyGuard, useValue: mediaClawApiKeyGuard },
        { provide: PaymentCreateThrottleGuard, useValue: paymentCreateThrottleGuard },
      ],
    }).compile()

    app = moduleRef.createNestApplication()
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
    contentMgmtService.getDownloadUrl.mockResolvedValue('https://cdn.example.com/video.mp4?signature=1')
    usageService.trackRequest.mockResolvedValue(undefined)
    mediaClawApiKeyGuard.canActivate.mockResolvedValue(true)
    paymentCreateThrottleGuard.canActivate.mockResolvedValue(true)
    xorPayService.getProducts.mockResolvedValue({ handler: 'getProducts' })
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
      headers: response.headers,
      body: bodyText ? JSON.parse(bodyText) : null,
    }
  }

  it('GET /api/v1/content should proxy content list query params', async () => {
    const response = await request('/api/v1/content?status=completed&publishStatus=published&brandId=brand-1&startDate=2026-03-01&endDate=2026-03-30&page=2&limit=5')
    expect(response.status).toBe(200)
    expect(contentMgmtService.listContent).toHaveBeenCalledWith(
      testUser.orgId,
      {
        status: 'completed',
        publishStatus: 'published',
        brandId: 'brand-1',
        startDate: '2026-03-01',
        endDate: '2026-03-30',
      },
      { page: 2, limit: 5 },
    )
  })

  it('GET /api/v1/content/pending should list pending approvals', async () => {
    const response = await request('/api/v1/content/pending')
    expect(response.status).toBe(200)
    expect(contentMgmtService.listPendingContent).toHaveBeenCalledWith(testUser.orgId, testUser.id)
  })

  it('POST /api/v1/content/batch-edit should forward payload', async () => {
    const response = await request('/api/v1/content/batch-edit', {
      method: 'POST',
      body: JSON.stringify({
        contentIds: ['content-1'],
        updates: {
          title: '新标题',
        },
      }),
    })
    expect(response.status).toBe(201)
    expect(contentMgmtService.batchEditCopy).toHaveBeenCalledWith(testUser.orgId, ['content-1'], { title: '新标题' })
  })

  it('POST /api/v1/content/export should export content', async () => {
    const response = await request('/api/v1/content/export', {
      method: 'POST',
      body: JSON.stringify({
        format: 'csv',
        filters: {
          status: 'completed',
        },
      }),
    })
    expect(response.status).toBe(201)
    expect(contentMgmtService.exportContent).toHaveBeenCalledWith(testUser.orgId, 'csv', { status: 'completed' })
  })

  it('GET /api/v1/content/:id should return detail', async () => {
    const response = await request('/api/v1/content/content-1')
    expect(response.status).toBe(200)
    expect(contentMgmtService.getContent).toHaveBeenCalledWith(testUser.orgId, 'content-1')
  })

  it('GET /api/v1/content/:id/download should issue a 302 redirect', async () => {
    const response = await fetch(`${baseUrl}/api/v1/content/content-1/download`, { redirect: 'manual' })
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://cdn.example.com/video.mp4?signature=1')
    expect(contentMgmtService.getDownloadUrl).toHaveBeenCalledWith(testUser.orgId, 'content-1')
  })

  it('PATCH /api/v1/content/:id/copy should update copy', async () => {
    const response = await request('/api/v1/content/content-1/copy', {
      method: 'PATCH',
      body: JSON.stringify({
        title: '标题',
        subtitle: '副标题',
        hashtags: ['#a'],
        blueWords: ['蓝词'],
        commentGuides: ['引导'],
      }),
    })
    expect(response.status).toBe(200)
    expect(contentMgmtService.editCopy).toHaveBeenCalledWith(
      testUser.orgId,
      'content-1',
      '标题',
      '副标题',
      ['#a'],
      ['蓝词'],
      ['引导'],
    )
  })

  it('POST /api/v1/content/:id/approve should approve content', async () => {
    const response = await request('/api/v1/content/content-1/approve', {
      method: 'POST',
      body: JSON.stringify({ comment: '通过' }),
    })
    expect(response.status).toBe(201)
    expect(contentMgmtService.approveContent).toHaveBeenCalledWith(testUser.orgId, 'content-1', testUser.id, '通过')
  })

  it('POST /api/v1/content/:id/review should submit review action', async () => {
    const response = await request('/api/v1/content/content-1/review', {
      method: 'POST',
      body: JSON.stringify({ action: 'changes_requested', comment: '需修改' }),
    })
    expect(response.status).toBe(201)
    expect(contentMgmtService.reviewContent).toHaveBeenCalledWith(testUser.orgId, 'content-1', testUser.id, {
      action: 'changes_requested',
      comment: '需修改',
    })
  })

  it('POST /api/v1/content/:id/publish should mark published', async () => {
    const response = await request('/api/v1/content/content-1/publish', {
      method: 'POST',
      body: JSON.stringify({ platform: 'douyin', publishUrl: 'https://example.com/p/1' }),
    })
    expect(response.status).toBe(201)
    expect(contentMgmtService.markPublished).toHaveBeenCalledWith(
      testUser.orgId,
      'content-1',
      'douyin',
      'https://example.com/p/1',
      testUser.id,
    )
  })

  it('POST /api/v1/content/:id/published should keep alias behavior', async () => {
    const response = await request('/api/v1/content/content-1/published', {
      method: 'POST',
      body: JSON.stringify({ platform: 'xhs', publishUrl: 'https://example.com/p/2' }),
    })
    expect(response.status).toBe(201)
    expect(contentMgmtService.markPublished).toHaveBeenCalledWith(
      testUser.orgId,
      'content-1',
      'xhs',
      'https://example.com/p/2',
      testUser.id,
    )
  })

  it('GET /api/v1/content/style-preferences should read style preferences', async () => {
    const response = await request('/api/v1/content/style-preferences')
    expect(response.status).toBe(200)
    expect(contentMgmtService.getStylePreferences).toHaveBeenCalledWith(testUser.orgId)
  })

  it('PUT /api/v1/content/style-preferences should update style preferences', async () => {
    const response = await request('/api/v1/content/style-preferences', {
      method: 'PUT',
      body: JSON.stringify({
        preferences: { color: '#fff' },
      }),
    })
    expect(response.status).toBe(200)
    expect(contentMgmtService.setStylePreferences).toHaveBeenCalledWith(testUser.orgId, { color: '#fff' })
  })

  it('GET /api/v1/account should reuse getInfo', async () => {
    const response = await request('/api/v1/account')
    expect(response.status).toBe(200)
    expect(accountService.getInfo).toHaveBeenCalledWith(testUser.id)
  })

  it('GET /api/v1/account/info should return account info', async () => {
    const response = await request('/api/v1/account/info')
    expect(response.status).toBe(200)
    expect(accountService.getInfo).toHaveBeenCalledWith(testUser.id)
  })

  it('GET /api/v1/account/usage should return usage', async () => {
    const response = await request('/api/v1/account/usage')
    expect(response.status).toBe(200)
    expect(accountService.getUsage).toHaveBeenCalledWith(testUser.id)
  })

  it('PATCH /api/v1/account/profile should update profile', async () => {
    const response = await request('/api/v1/account/profile', {
      method: 'PATCH',
      body: JSON.stringify({ nickname: 'mc' }),
    })
    expect(response.status).toBe(200)
    expect(accountService.updateProfile).toHaveBeenCalledWith(testUser.id, { nickname: 'mc' })
  })

  it('POST /api/v1/brand should create brand', async () => {
    const response = await request('/api/v1/brand', {
      method: 'POST',
      body: JSON.stringify({ name: '品牌' }),
    })
    expect(response.status).toBe(201)
    expect(brandService.create).toHaveBeenCalledWith(testUser.orgId, { name: '品牌' })
  })

  it('GET /api/v1/brand should list brands', async () => {
    const response = await request('/api/v1/brand')
    expect(response.status).toBe(200)
    expect(brandService.findByOrg).toHaveBeenCalledWith(testUser.orgId)
  })

  it('GET /api/v1/brand/:id should return brand detail', async () => {
    const response = await request('/api/v1/brand/brand-1')
    expect(response.status).toBe(200)
    expect(brandService.findById).toHaveBeenCalledWith(testUser.orgId, 'brand-1')
  })

  it('PATCH /api/v1/brand/:id should update brand', async () => {
    const response = await request('/api/v1/brand/brand-1', {
      method: 'PATCH',
      body: JSON.stringify({ name: '品牌2' }),
    })
    expect(response.status).toBe(200)
    expect(brandService.update).toHaveBeenCalledWith(testUser.orgId, 'brand-1', { name: '品牌2' })
  })

  it('PATCH /api/v1/brand/:id/assets should update assets', async () => {
    const response = await request('/api/v1/brand/brand-1/assets', {
      method: 'PATCH',
      body: JSON.stringify({ logoUrl: 'https://example.com/logo.png' }),
    })
    expect(response.status).toBe(200)
    expect(brandService.updateAssets).toHaveBeenCalledWith(testUser.orgId, 'brand-1', { logoUrl: 'https://example.com/logo.png' })
  })

  it('PATCH /api/v1/brand/:id/video-style should update video style', async () => {
    const response = await request('/api/v1/brand/brand-1/video-style', {
      method: 'PATCH',
      body: JSON.stringify({ preferredDuration: 15 }),
    })
    expect(response.status).toBe(200)
    expect(brandService.updateVideoStyle).toHaveBeenCalledWith(testUser.orgId, 'brand-1', { preferredDuration: 15 })
  })

  it('DELETE /api/v1/brand/:id should delete brand', async () => {
    const response = await request('/api/v1/brand/brand-1', {
      method: 'DELETE',
    })
    expect(response.status).toBe(200)
    expect(brandService.delete).toHaveBeenCalledWith(testUser.orgId, 'brand-1')
  })

  it('GET /api/v1/payment/products should expose product list', async () => {
    const response = await request('/api/v1/payment/products')
    expect(response.status).toBe(200)
    expect(xorPayService.getProducts).toHaveBeenCalled()
  })

  it('POST /api/v1/payment/create should pass client ip and order payload', async () => {
    const response = await request('/api/v1/payment/create', {
      method: 'POST',
      headers: {
        'x-forwarded-for': '198.51.100.7, 10.0.0.1',
      },
      body: JSON.stringify({
        productId: 'pack-10',
        paymentMethod: 'wechat_native',
        quantity: 2,
        productType: 'video_pack',
      }),
    })
    expect(response.status).toBe(201)
    expect(xorPayService.createOrder).toHaveBeenCalledWith({
      orgId: testUser.orgId,
      userId: testUser.id,
      productId: 'pack-10',
      paymentMethod: 'wechat_native',
      productType: 'video_pack',
      quantity: 2,
      openId: undefined,
      clientIp: '198.51.100.7',
    })
  })

  it('POST /api/v1/payment/callback should pass signature header', async () => {
    const response = await request('/api/v1/payment/callback', {
      method: 'POST',
      headers: {
        'x-xorpay-signature': 'sig-1',
      },
      body: JSON.stringify({ order_id: 'o-1' }),
    })
    expect(response.status).toBe(201)
    expect(xorPayService.handleCallback).toHaveBeenCalledWith({ order_id: 'o-1' }, 'sig-1')
  })

  it('GET /api/v1/payment/status/:orderId should read order status', async () => {
    const response = await request('/api/v1/payment/status/order-1')
    expect(response.status).toBe(200)
    expect(xorPayService.getOrderStatus).toHaveBeenCalledWith('order-1', expect.objectContaining({
      id: testUser.id,
      orgId: testUser.orgId,
      role: testUser.role,
    }))
  })

  it('GET /api/v1/payment/orders should support org scope queries', async () => {
    const response = await request('/api/v1/payment/orders?status=paid&page=3&limit=8&scope=org')
    expect(response.status).toBe(200)
    expect(xorPayService.listOrders).toHaveBeenCalledWith(
      testUser.orgId,
      {
        status: 'paid',
        userId: undefined,
      },
      {
        page: 3,
        limit: 8,
      },
    )
  })

  it('POST /api/v1/skill/register should register agent', async () => {
    const response = await request('/api/v1/skill/register', {
      method: 'POST',
      body: JSON.stringify({
        agentId: 'agent-1',
        capabilities: ['preview', 'download'],
      }),
    })
    expect(response.status).toBe(201)
    expect(skillService.registerAgent).toHaveBeenCalledWith('agent-1', ['preview', 'download'], {
      orgId: testUser.orgId,
      userId: testUser.id,
    })
  })

  it('GET /api/v1/skill/config should return agent config', async () => {
    const response = await request('/api/v1/skill/config?agentId=agent-1')
    expect(response.status).toBe(200)
    expect(skillService.getAgentConfig).toHaveBeenCalledWith('agent-1', {
      orgId: testUser.orgId,
      userId: testUser.id,
    })
  })

  it('POST /api/v1/skill/feedback should submit delivery feedback', async () => {
    const response = await request('/api/v1/skill/feedback', {
      method: 'POST',
      body: JSON.stringify({
        agentId: 'agent-1',
        taskId: 'task-1',
        feedback: { rating: 5 },
      }),
    })
    expect(response.status).toBe(201)
    expect(skillService.submitFeedback).toHaveBeenCalledWith('agent-1', 'task-1', { rating: 5 }, {
      orgId: testUser.orgId,
      userId: testUser.id,
    })
  })

  it('GET /api/v1/skill/deliveries should return pending deliveries', async () => {
    const response = await request('/api/v1/skill/deliveries?agentId=agent-1')
    expect(response.status).toBe(200)
    expect(skillService.getPendingDeliveries).toHaveBeenCalledWith('agent-1', {
      orgId: testUser.orgId,
      userId: testUser.id,
    })
  })

  it('POST /api/v1/skill/confirm-delivery should confirm delivery', async () => {
    const response = await request('/api/v1/skill/confirm-delivery', {
      method: 'POST',
      body: JSON.stringify({
        agentId: 'agent-1',
        taskId: 'task-1',
      }),
    })
    expect(response.status).toBe(201)
    expect(skillService.confirmDelivery).toHaveBeenCalledWith('agent-1', 'task-1', {
      orgId: testUser.orgId,
      userId: testUser.id,
    })
  })
})
