import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common'
import { GUARDS_METADATA, INTERCEPTORS_METADATA } from '@nestjs/common/constants'
import { Reflector } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { UserRole } from '@yikart/mongodb'
import request from 'supertest'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { EnterpriseAuthService } from '../../apps/aitoearn-server/src/core/mediaclaw/auth/enterprise-auth.service'
import { McAuthController } from '../../apps/aitoearn-server/src/core/mediaclaw/auth/auth.controller'
import { McAuthService } from '../../apps/aitoearn-server/src/core/mediaclaw/auth/auth.service'
import { CompetitorController } from '../../apps/aitoearn-server/src/core/mediaclaw/competitor/competitor.controller'
import { CompetitorService } from '../../apps/aitoearn-server/src/core/mediaclaw/competitor/competitor.service'
import { ContentRemixService } from '../../apps/aitoearn-server/src/core/mediaclaw/discovery/content-remix.service'
import { DiscoveryController } from '../../apps/aitoearn-server/src/core/mediaclaw/discovery/discovery.controller'
import { DiscoveryService } from '../../apps/aitoearn-server/src/core/mediaclaw/discovery/discovery.service'
import { MonitoringMetricsController } from '../../apps/aitoearn-server/src/core/mediaclaw/health/monitoring-metrics.controller'
import { MonitoringMetricsService } from '../../apps/aitoearn-server/src/core/mediaclaw/health/monitoring-metrics.service'
import { PublicHealthController } from '../../apps/aitoearn-server/src/core/mediaclaw/health/public-health.controller'
import { HealthService } from '../../apps/aitoearn-server/src/core/mediaclaw/health/health.service'

const testUser = {
  id: '507f1f77bcf86cd799439012',
  orgId: '507f1f77bcf86cd799439011',
  role: UserRole.ENTERPRISE_ADMIN,
  apiKeyId: 'mc_live_test_key',
}

class SmokeAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const isBypassed = this.hasBypassMetadata(context, 'is_public')
      || this.hasBypassMetadata(context, 'is_internal')
      || this.isPublicPath(context)

    if (isBypassed) {
      return true
    }

    const request = context.switchToHttp().getRequest()
    const authorization = request.headers.authorization || ''
    if (authorization !== 'Bearer test-access-token') {
      throw new UnauthorizedException('Unauthorized')
    }

    request.user = { ...testUser }
    return true
  }

  private hasBypassMetadata(context: ExecutionContext, suffix: string) {
    const targets = [context.getHandler(), context.getClass()]

    return targets.some((target) =>
      Reflect.getMetadataKeys(target).some((key) => {
        const keyText = typeof key === 'symbol'
          ? key.description || key.toString()
          : String(key)
        return keyText.includes(suffix) && Reflect.getMetadata(key, target) === true
      }),
    )
  }

  private isPublicPath(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest()
    const url = String(request.url || '')

    return url === '/health'
      || url === '/metrics'
      || url.startsWith('/api/v1/discovery/')
      || url === '/api/v1/discovery'
      || url === '/api/v1/auth/login'
  }
}

Reflect.defineMetadata('design:paramtypes', [DiscoveryService, ContentRemixService], DiscoveryController)
Reflect.defineMetadata('design:paramtypes', [CompetitorService], CompetitorController)
Reflect.defineMetadata('design:paramtypes', [McAuthService, EnterpriseAuthService], McAuthController)
Reflect.defineMetadata('design:paramtypes', [MonitoringMetricsService], MonitoringMetricsController)
Reflect.defineMetadata('design:paramtypes', [HealthService], PublicHealthController)
Reflect.defineMetadata(GUARDS_METADATA, [], DiscoveryController)
Reflect.defineMetadata(GUARDS_METADATA, [], CompetitorController)
Reflect.defineMetadata(GUARDS_METADATA, [], McAuthController)
Reflect.defineMetadata(GUARDS_METADATA, [], MonitoringMetricsController)
Reflect.defineMetadata(GUARDS_METADATA, [], PublicHealthController)
Reflect.defineMetadata(INTERCEPTORS_METADATA, [], DiscoveryController)
Reflect.defineMetadata(INTERCEPTORS_METADATA, [], CompetitorController)
Reflect.defineMetadata(INTERCEPTORS_METADATA, [], McAuthController)
Reflect.defineMetadata(INTERCEPTORS_METADATA, [], MonitoringMetricsController)
Reflect.defineMetadata(INTERCEPTORS_METADATA, [], PublicHealthController)

describe('MediaClaw Smoke E2E', () => {
  let app: INestApplication
  let client: request.SuperTest<request.Test>

  const discoveryService = {
    getRecommendationPool: vi.fn(),
  }

  const contentRemixService = {
    remixAnalyzeByVideoUrl: vi.fn(),
  }

  const competitorService = {
    listCompetitors: vi.fn(),
  }

  const authService = {
    compatLogin: vi.fn(),
  }

  const enterpriseAuthService = {}

  const monitoringMetricsService = {
    renderPrometheusMetrics: vi.fn(),
  }

  const healthService = {
    getPublicStatus: vi.fn(),
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [
        PublicHealthController,
        DiscoveryController,
        CompetitorController,
        McAuthController,
        MonitoringMetricsController,
      ],
      providers: [
        { provide: DiscoveryService, useValue: discoveryService },
        { provide: ContentRemixService, useValue: contentRemixService },
        { provide: CompetitorService, useValue: competitorService },
        { provide: McAuthService, useValue: authService },
        { provide: EnterpriseAuthService, useValue: enterpriseAuthService },
        { provide: MonitoringMetricsService, useValue: monitoringMetricsService },
        { provide: HealthService, useValue: healthService },
      ],
    }).compile()

    app = moduleRef.createNestApplication()
    app.useGlobalPipes(new ValidationPipe({ transform: true }))
    app.useGlobalGuards(new SmokeAuthGuard(app.get(Reflector)))
    await app.init()
    client = request(app.getHttpServer())
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    healthService.getPublicStatus.mockReturnValue({
      status: 'ok',
      service: 'mediaclaw-api',
      version: '1.0.0',
      timestamp: '2026-04-09T00:00:00.000Z',
    })
    discoveryService.getRecommendationPool.mockResolvedValue({
      orgId: testUser.orgId,
      source: 'seed',
      total: 1,
      items: [
        {
          contentId: 'content-1',
          title: '爆款示例',
          platform: 'douyin',
          viralScore: 92,
        },
      ],
    })
    monitoringMetricsService.renderPrometheusMetrics.mockResolvedValue([
      '# HELP http_requests_total Total HTTP requests',
      '# TYPE http_requests_total counter',
      'http_requests_total{method="GET",route="/metrics"} 1',
    ].join('\n'))
    authService.compatLogin.mockRejectedValue(new UnauthorizedException('账号或密码错误'))
  })

  it('GET /health should return 200', async () => {
    const response = await client.get('/health')

    expect(response.status).toBe(200)
    expect(response.body).toEqual(expect.objectContaining({
      status: 'ok',
      service: 'mediaclaw-api',
    }))
  })

  it('GET /api/v1/discovery/pool should return discovery items', async () => {
    const response = await client.get('/api/v1/discovery/pool?limit=2')

    expect(response.status).toBe(200)
    expect(Array.isArray(response.body.items)).toBe(true)
    expect(response.body.items[0]).toEqual(expect.objectContaining({
      contentId: 'content-1',
      viralScore: 92,
    }))
  })

  it('GET /api/v1/competitors should require auth', async () => {
    const response = await client.get('/api/v1/competitors')

    expect(response.status).toBe(401)
  })

  it('POST /api/v1/auth/login with invalid creds should return 401', async () => {
    const response = await client
      .post('/api/v1/auth/login')
      .send({
        type: 'email',
        email: 'invalid@example.com',
        password: 'wrong-password',
      })

    expect(response.status).toBe(401)
  })

  it('GET /metrics should return prometheus text', async () => {
    const response = await client.get('/metrics')

    expect(response.status).toBe(200)
    expect(response.text).toContain('# HELP http_requests_total')
    expect(response.headers['content-type']).toContain('text/plain')
  })
})
