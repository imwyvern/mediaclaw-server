import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaclawConfigService } from '../mediaclaw-config.service'
import { ClawHostPostgresService } from './clawhost-postgres.service'

describe('clawHostPostgresService behavior', () => {
  let service: ClawHostPostgresService
  let query: ReturnType<typeof vi.fn>
  let release: ReturnType<typeof vi.fn>

  beforeEach(() => {
    process.env.CLAWHOST_POSTGRES_URL = 'postgres://clawhost:test@127.0.0.1:5432/clawhost'
    query = vi.fn().mockResolvedValue({ rows: [] })
    release = vi.fn()

    service = new ClawHostPostgresService(new MediaclawConfigService())
    ;(service as any).pool = {
      connect: vi.fn().mockResolvedValue({
        query,
        release,
      }),
      end: vi.fn().mockResolvedValue(undefined),
    }
  })

  it('应自动建表并同步实例、渠道和设备元数据', async () => {
    const result = await service.syncInstance({
      instanceId: 'chi-org-demo-1',
      orgId: 'org-1',
      clientName: '直营客服',
      plan: 'starter',
      status: 'running',
      deploymentMode: 'managed',
      config: {
        cpu: '500m',
        memory: '1Gi',
        storage: '10Gi',
      },
      skills: [{
        skillId: 'mediaclaw-client',
        version: 'latest',
        installedAt: new Date('2026-04-10T18:00:00.000Z'),
      }],
      healthStatus: {
        lastCheck: new Date('2026-04-10T18:01:00.000Z'),
        isHealthy: true,
        latency: 12,
      },
      requestedImChannel: 'feishu',
      accessUrl: 'https://chi-org-demo-1.mediaclaw.ai',
      healthUrl: 'http://127.0.0.1:3900/health',
      hostPort: 3900,
      runtimeImage: 'mediaclaw/openclaw:latest',
      containerId: 'container-1',
      containerName: 'mediaclaw-clawhost-1',
      lastHealthMessage: '',
      boundApiKeyPrefix: 'mc_live_1234',
      boundAt: new Date('2026-04-10T18:02:00.000Z'),
      lastHeartbeatAt: new Date('2026-04-10T18:03:00.000Z'),
      lastClientVersion: '1.2.3',
      heartbeatCapabilities: ['skill:heartbeat', 'skill:deliveries'],
      connectionCodePreview: 'MC-****-****-ABCD',
    }, {
      appName: 'org-1',
      ownerUserId: 'user-1',
      apiToken: 'mc_live_full_token',
      deviceId: 'device-1',
      deviceApproved: true,
    })

    expect(result).toEqual({ enabled: true, synced: true })
    expect(query).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS apps'))
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO apps'),
      ['org-1', 'org-1', 'mc_live_full_token'],
    )
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO bots'),
      expect.arrayContaining([
        'chi-org-demo-1',
        'org-1',
        'user-1',
        '直营客服',
        'running',
      ]),
    )
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO bot_channels'),
      expect.arrayContaining(['chi-org-demo-1', 'feishu']),
    )
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO bot_devices'),
      ['chi-org-demo-1', 'device-1', true],
    )
    expect(release).toHaveBeenCalledTimes(2)
  })

  it('无 PostgreSQL 配置时应跳过同步', async () => {
    delete process.env.CLAWHOST_POSTGRES_URL
    const disabledService = new ClawHostPostgresService(new MediaclawConfigService())

    await expect(disabledService.syncInstance({
      instanceId: 'chi-org-demo-2',
      orgId: 'org-2',
      clientName: '演示实例',
      status: 'creating',
    })).resolves.toEqual({
      enabled: false,
      synced: false,
    })
  })
})
