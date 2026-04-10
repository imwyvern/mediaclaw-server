import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaClawHealthCheckService } from '../../apps/aitoearn-server/src/core/mediaclaw/health/health-check.service'
import { HealthController } from '../../apps/aitoearn-server/src/core/mediaclaw/health/health.controller'
import { HealthService } from '../../apps/aitoearn-server/src/core/mediaclaw/health/health.service'
import { ClawHostBindingController } from '../../apps/aitoearn-server/src/core/mediaclaw/clawhost/clawhost-binding.controller'
import { ClawHostController } from '../../apps/aitoearn-server/src/core/mediaclaw/clawhost/clawhost.controller'
import { ClawHostService } from '../../apps/aitoearn-server/src/core/mediaclaw/clawhost/clawhost.service'
import { UsageTrackingInterceptor } from '../../apps/aitoearn-server/src/core/mediaclaw/usage/usage-tracking.interceptor'
import { UsageService } from '../../apps/aitoearn-server/src/core/mediaclaw/usage/usage.service'

const testUser = {
  id: 'user-1',
  orgId: 'org-1',
  role: 'super_admin',
  apiKeyId: 'mc_live_test_key',
}

Reflect.defineMetadata('design:paramtypes', [ClawHostService], ClawHostController)
Reflect.defineMetadata('design:paramtypes', [ClawHostService], ClawHostBindingController)
Reflect.defineMetadata('design:paramtypes', [HealthService, MediaClawHealthCheckService], HealthController)
Reflect.defineMetadata('design:paramtypes', [UsageService], UsageTrackingInterceptor)

function createResponseMock(name: string) {
  return vi.fn(async (...args: any[]) => ({
    handler: name,
    args,
  }))
}

describe('MediaClaw ClawHost + Monitoring E2E', () => {
  let app: INestApplication
  let baseUrl: string

  const clawHostService = {
    createInstance: createResponseMock('createInstance'),
    startInstance: createResponseMock('startInstance'),
    connectInstance: createResponseMock('connectInstance'),
  }

  const healthService = {
    heartbeat: createResponseMock('heartbeat'),
  }

  const mediaClawHealthCheckService = {
    getDashboardStatus: createResponseMock('getDashboardStatus'),
    getSystemHealth: createResponseMock('getSystemHealth'),
  }

  const usageService = {
    trackRequest: vi.fn().mockResolvedValue(undefined),
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [
        ClawHostController,
        ClawHostBindingController,
        HealthController,
      ],
      providers: [
        UsageTrackingInterceptor,
        { provide: ClawHostService, useValue: clawHostService },
        { provide: HealthService, useValue: healthService },
        { provide: MediaClawHealthCheckService, useValue: mediaClawHealthCheckService },
        { provide: UsageService, useValue: usageService },
      ],
    }).compile()

    app = moduleRef.createNestApplication()
    app.useGlobalPipes(new ValidationPipe({ transform: true }))
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

  it('GET /api/v1/health should expose public health summary', async () => {
    const response = await request('/api/v1/health')

    expect(response.status).toBe(200)
    expect(response.body).toEqual(expect.objectContaining({
      status: 'ok',
      service: 'mediaclaw-api',
    }))
  })

  it('GET /api/v1/health/status should proxy dashboard monitoring data', async () => {
    const response = await request('/api/v1/health/status')

    expect(response.status).toBe(200)
    expect(mediaClawHealthCheckService.getDashboardStatus).toHaveBeenCalledTimes(1)
  })

  it('GET /api/v1/health/system should proxy system health checks', async () => {
    const response = await request('/api/v1/health/system')

    expect(response.status).toBe(200)
    expect(mediaClawHealthCheckService.getSystemHealth).toHaveBeenCalledTimes(1)
  })

  it('POST /api/v1/heartbeat should accept skill heartbeat payloads', async () => {
    const response = await request('/api/v1/heartbeat', {
      method: 'POST',
      body: JSON.stringify({
        agentId: 'chi-org-demo-abc123',
        clientVersion: '1.2.3',
        capabilities: ['deliveries', 'feedback'],
      }),
    })

    expect(response.status).toBe(201)
    expect(healthService.heartbeat).toHaveBeenCalledWith(
      expect.objectContaining(testUser),
      {
        agentId: 'chi-org-demo-abc123',
        clientVersion: '1.2.3',
        capabilities: ['deliveries', 'feedback'],
      },
    )
  })

  it('POST /api/v1/clawhost/instances should create a managed instance via control plane', async () => {
    const response = await request('/api/v1/clawhost/instances', {
      method: 'POST',
      body: JSON.stringify({
        clientName: '直营客服',
        plan: 'pro',
        requestedImChannel: 'feishu',
      }),
    })

    expect(response.status).toBe(201)
    expect(clawHostService.createInstance).toHaveBeenCalledWith(
      testUser.orgId,
      undefined,
      '直营客服',
      expect.objectContaining({
        plan: 'pro',
        requestedImChannel: 'feishu',
        issuedByUserId: testUser.id,
      }),
    )
  })

  it('POST /api/v1/clawhost/instances/:id/start should proxy managed start requests', async () => {
    const response = await request('/api/v1/clawhost/instances/chi-org-demo-abc123/start', {
      method: 'POST',
      body: JSON.stringify({}),
    })

    expect(response.status).toBe(201)
    expect(clawHostService.startInstance).toHaveBeenCalledWith(
      testUser.orgId,
      'chi-org-demo-abc123',
    )
  })

  it('POST /api/v1/connect should accept public binding requests', async () => {
    const response = await request('/api/v1/connect', {
      method: 'POST',
      body: JSON.stringify({
        code: 'MC-ABCD-EFGH-JKLM',
        instanceId: 'chi-org-demo-abc123',
        agentId: 'chi-org-demo-abc123',
        clientVersion: '1.2.3',
      }),
    })

    expect(response.status).toBe(201)
    expect(clawHostService.connectInstance).toHaveBeenCalledWith({
      code: 'MC-ABCD-EFGH-JKLM',
      instanceId: 'chi-org-demo-abc123',
      agentId: 'chi-org-demo-abc123',
      clientVersion: '1.2.3',
    })
  })
})
