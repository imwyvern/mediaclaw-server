import { BadRequestException } from '@nestjs/common'
import { Types } from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ClawHostService } from './clawhost.service'

vi.mock('@yikart/mongodb', () => {
  class ClawHostInstance {}

  return {
    ClawHostInstance,
    ClawHostDeploymentMode: {
      MANAGED: 'managed',
      BYOC: 'byoc',
    },
    ClawHostInstanceStatus: {
      CREATING: 'creating',
      PENDING_MANUAL_SETUP: 'pending_manual_setup',
      RUNNING: 'running',
      STOPPED: 'stopped',
      UPGRADING: 'upgrading',
      ERROR: 'error',
    },
    ClawHostRuntimeKind: {
      DOCKER: 'docker',
      K8S: 'k8s',
    },
    UserRole: {
      OPERATOR: 'editor',
    },
  }
})

const MANAGED = 'managed'
const RUNNING = 'running'
const ERROR = 'error'

function createExecQuery<T>(value: T) {
  const query = {
    sort: vi.fn(),
    skip: vi.fn(),
    limit: vi.fn(),
    lean: vi.fn(),
    select: vi.fn(),
    populate: vi.fn(),
    exec: vi.fn().mockResolvedValue(value),
  }

  query.sort.mockReturnValue(query)
  query.skip.mockReturnValue(query)
  query.limit.mockReturnValue(query)
  query.lean.mockReturnValue(query)
  query.select.mockReturnValue(query)
  query.populate.mockReturnValue(query)

  return query
}

function createManagedInstance(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-04-09T18:30:00.000Z')
  return {
    _id: new Types.ObjectId(),
    instanceId: 'chi-org-demo-abc123',
    orgId: 'org-1',
    clientName: '直营客服',
    plan: 'starter',
    status: RUNNING,
    deploymentMode: MANAGED,
    config: {
      cpu: '500m',
      memory: '1Gi',
      storage: '10Gi',
    },
    skills: [],
    healthStatus: {
      lastCheck: now,
      isHealthy: true,
      latency: 12,
    },
    k8sNamespace: 'clawhost-org-1',
    k8sPodName: 'pod-abc123',
    runtimeKind: 'docker',
    containerId: 'container-1',
    containerName: 'mediaclaw-clawhost-1',
    runtimeImage: 'node:20-alpine',
    hostPort: 3900,
    healthUrl: 'http://127.0.0.1:3900/health',
    lastHealthMessage: '',
    gatewayConfig: {
      enabled: false,
      url: '',
      toolName: 'mediaclaw.sync',
      lastPushAt: null,
      lastPushStatus: '',
      lastPushMessage: '',
    },
    sharedExperienceConfig: {
      enabled: false,
      displayName: '',
      welcomeMessage: '',
      supportContact: '',
      defaultChannel: '',
      channels: [],
      lastActivatedAt: null,
    },
    requestedImChannel: 'feishu',
    accessUrl: 'http://127.0.0.1:3900/',
    installCommand: 'openclaw skills install mediaclaw-client',
    connectionCodePreview: '',
    connectionCodeHash: '',
    connectionCodeIssuedAt: null,
    connectionCodeExpiresAt: null,
    boundApiKeyId: '',
    boundApiKeyPrefix: '',
    boundAt: null,
    lastHeartbeatAt: null,
    lastClientVersion: '',
    lastAgentId: '',
    heartbeatCapabilities: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('clawHostService behavior', () => {
  let service: ClawHostService
  let clawHostInstanceModel: Record<string, any>
  let redisService: Record<string, any>
  let apiKeyService: Record<string, any>
  let clawHostRuntimeService: Record<string, any>
  let clawHostAlertService: Record<string, any>
  let clawHostPostgresService: Record<string, any>
  let clawHostGatewayPushService: Record<string, any>

  beforeEach(() => {
    clawHostInstanceModel = {
      create: vi.fn(),
      find: vi.fn(),
      findOne: vi.fn(),
      findByIdAndUpdate: vi.fn(),
      updateOne: vi.fn(),
    }
    redisService = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(true),
      del: vi.fn().mockResolvedValue(1),
      setJson: vi.fn(),
      getJson: vi.fn(),
    }
    apiKeyService = {
      create: vi.fn(),
      revokeInternal: vi.fn(),
    }
    clawHostRuntimeService = {
      resolveRuntimeKind: vi.fn().mockReturnValue('docker'),
      createManagedContainer: vi.fn(),
      startContainer: vi.fn(),
      stopContainer: vi.fn(),
      restartContainer: vi.fn(),
      upgradeSkill: vi.fn(),
      inspectManagedContainer: vi.fn(),
      getContainerLogs: vi.fn().mockResolvedValue([]),
    }
    clawHostAlertService = {
      notifyUnhealthyInstance: vi.fn().mockResolvedValue(undefined),
    }
    clawHostPostgresService = {
      syncInstance: vi.fn().mockResolvedValue({ enabled: true, synced: true }),
    }
    clawHostGatewayPushService = {
      queueConfigUpdate: vi.fn(),
      pushRealtimeEvent: vi.fn().mockResolvedValue({ attempted: 1, delivered: 1 }),
    }

    service = new ClawHostService(
      clawHostInstanceModel as any,
      redisService as any,
      apiKeyService as any,
      clawHostRuntimeService as any,
      clawHostAlertService as any,
      clawHostPostgresService as any,
      clawHostGatewayPushService as any,
    )
  })

  it('应拒绝不支持的 ClawHost 套餐', async () => {
    await expect(service.createInstance('org-1', undefined, '直营客服', {
      plan: 'ultra',
    })).rejects.toThrow(BadRequestException)
    expect(clawHostInstanceModel.create).not.toHaveBeenCalled()
  })

  it('应为托管实例保留 managed 快照状态而不是回退为待绑定', async () => {
    const instance = createManagedInstance()
    clawHostInstanceModel.findOne.mockReturnValue(createExecQuery(instance))

    const result = await service.getInstance('org-1', instance.instanceId)

    expect(result.status).toBe(RUNNING)
    expect(result.healthStatus.isHealthy).toBe(true)
    expect(result.connectionInfo.connectionStatus).toBe('connected')
  })

  it('应在托管实例异常时持久化错误状态并发送告警', async () => {
    const instance = createManagedInstance()
    clawHostInstanceModel.find.mockReturnValue(createExecQuery([instance]))
    clawHostInstanceModel.updateOne.mockReturnValue(createExecQuery({ acknowledged: true }))
    clawHostRuntimeService.inspectManagedContainer.mockResolvedValue({
      exists: true,
      running: true,
      status: 'running',
      healthUrl: instance.healthUrl,
      apiHealthy: false,
      latencyMs: 380,
      errorMessage: 'api_unhealthy',
    })

    const result = await service.runHealthCheck()

    expect(clawHostInstanceModel.updateOne).toHaveBeenCalledWith(
      { _id: instance._id },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: ERROR,
          lastHealthMessage: 'api_unhealthy',
        }),
      }),
    )
    expect(redisService.set).toHaveBeenCalledWith(
      `mediaclaw:clawhost:alert:${instance.instanceId}`,
      '1',
      15 * 60,
    )
    expect(clawHostAlertService.notifyUnhealthyInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceId: instance.instanceId,
        message: 'api_unhealthy',
      }),
    )
    expect(result.unhealthyCount).toBe(1)
  })

  it('应保存 gateway 配置并给最近 agent 下发配置更新', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const instance: Record<string, any> = {
      ...createManagedInstance({
        orgId: 'org-1',
        lastAgentId: 'agent-1',
      }),
      save,
      toObject() {
        return this
      },
    }
    instance.set = vi.fn((key: string, value: unknown) => {
      instance[key] = value
    })
    clawHostInstanceModel.findOne.mockReturnValue(createExecQuery(instance))

    const result = await service.configureGateway('org-1', instance.instanceId, {
      enabled: true,
      url: 'https://openclaw.example.com',
      toolName: 'mediaclaw.sync',
    })

    expect(instance.set).toHaveBeenCalledWith('gatewayConfig', expect.objectContaining({
      enabled: true,
      url: 'https://openclaw.example.com',
      toolName: 'mediaclaw.sync',
    }))
    expect(clawHostGatewayPushService.queueConfigUpdate).toHaveBeenCalledWith('org-1', 'agent-1', expect.objectContaining({
      key: 'gatewayConfig',
    }))
    expect(clawHostGatewayPushService.pushRealtimeEvent).toHaveBeenCalledWith('org-1', expect.objectContaining({
      event: 'config.update',
    }))
    expect(result.connectionInfo.gateway).toEqual(expect.objectContaining({
      enabled: true,
      url: 'https://openclaw.example.com',
    }))
  })

  it('应保存共享群体验配置并回显默认渠道', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const instance: Record<string, any> = {
      ...createManagedInstance({
        orgId: 'org-1',
      }),
      save,
      toObject() {
        return this
      },
    }
    instance.set = vi.fn((key: string, value: unknown) => {
      instance[key] = value
    })
    clawHostInstanceModel.findOne.mockReturnValue(createExecQuery(instance))

    const result = await service.configureSharedExperience('org-1', instance.instanceId, {
      enabled: true,
      displayName: 'MediaClaw 官方体验群',
      welcomeMessage: '发送开始体验即可领取试用任务',
      supportContact: '企微小助手',
      defaultChannel: 'feishu',
      channels: [{
        channel: 'feishu',
        groupName: 'MediaClaw 飞书体验群',
        inviteUrl: 'https://open.feishu.cn/invite/shared-demo',
        entryKeyword: '开始体验',
      }],
    })

    expect(instance.set).toHaveBeenCalledWith('sharedExperienceConfig', expect.objectContaining({
      enabled: true,
      displayName: 'MediaClaw 官方体验群',
      defaultChannel: 'feishu',
    }))
    expect(result.connectionInfo.sharedExperience).toEqual(expect.objectContaining({
      enabled: true,
      defaultChannel: 'feishu',
      channels: [
        expect.objectContaining({
          channel: 'feishu',
          inviteUrl: 'https://open.feishu.cn/invite/shared-demo',
        }),
      ],
    }))
  })

  it('应在托管实例恢复健康时清理告警节流缓存', async () => {
    const instance = createManagedInstance({
      status: ERROR,
      healthStatus: {
        lastCheck: new Date('2026-04-09T18:25:00.000Z'),
        isHealthy: false,
        latency: 0,
      },
      lastHealthMessage: 'api_unhealthy',
    })
    clawHostInstanceModel.find.mockReturnValue(createExecQuery([instance]))
    clawHostInstanceModel.updateOne.mockReturnValue(createExecQuery({ acknowledged: true }))
    clawHostRuntimeService.inspectManagedContainer.mockResolvedValue({
      exists: true,
      running: true,
      status: 'running',
      healthUrl: instance.healthUrl,
      apiHealthy: true,
      latencyMs: 42,
      errorMessage: '',
    })

    const result = await service.runHealthCheck()

    expect(redisService.del).toHaveBeenCalledWith(`mediaclaw:clawhost:alert:${instance.instanceId}`)
    expect(clawHostAlertService.notifyUnhealthyInstance).not.toHaveBeenCalled()
    expect(result.unhealthyCount).toBe(0)
  })

  it('应在创建实例后同步 PostgreSQL 元数据', async () => {
    const created = createManagedInstance()
    clawHostInstanceModel.find.mockReturnValue(createExecQuery([]))
    clawHostRuntimeService.createManagedContainer.mockResolvedValue({
      containerId: created.containerId,
      containerName: created.containerName,
      image: created.runtimeImage,
      hostPort: created.hostPort,
      healthUrl: created.healthUrl,
      accessUrl: created.accessUrl,
    })
    clawHostInstanceModel.create.mockResolvedValue({
      toObject: () => created,
    })

    const result = await service.createInstance('org-1', undefined, '直营客服', {
      plan: 'starter',
      deploymentMode: MANAGED as any,
    })

    expect(result.instanceId).toBe(created.instanceId)
    expect(clawHostPostgresService.syncInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceId: created.instanceId,
        orgId: created.orgId,
        clientName: created.clientName,
        status: RUNNING,
        runtimeKind: 'docker',
      }),
      { ownerUserId: '' },
    )
  })
})
