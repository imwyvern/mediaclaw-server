import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ClawHostService } from './clawhost.service'

vi.mock('@yikart/mongodb', () => {
  class ClawHostInstance {}
  class ClawHostInstanceConfig {}
  class ClawHostInstalledSkill {}
  class ClawHostHealthStatus {}

  return {
    ClawHostDeploymentMode: {
      MANAGED: 'managed',
      BYOC: 'byoc',
    },
    ClawHostHealthStatus,
    ClawHostInstalledSkill,
    ClawHostInstance,
    ClawHostInstanceConfig,
    ClawHostInstanceStatus: {
      CREATING: 'creating',
      PENDING_MANUAL_SETUP: 'pending_manual_setup',
      RUNNING: 'running',
      STOPPED: 'stopped',
      ERROR: 'error',
      UPGRADING: 'upgrading',
    },
    UserRole: {
      OPERATOR: 'operator',
    },
  }
})

function createQuery<T>(value: T) {
  const query = {
    select: vi.fn(),
    sort: vi.fn(),
    skip: vi.fn(),
    limit: vi.fn(),
    lean: vi.fn(),
    exec: vi.fn().mockResolvedValue(value),
  }

  query.select.mockReturnValue(query)
  query.sort.mockReturnValue(query)
  query.skip.mockReturnValue(query)
  query.limit.mockReturnValue(query)
  query.lean.mockReturnValue(query)

  return query
}

function createManagedInstance(overrides: Record<string, any> = {}) {
  const now = new Date('2026-04-09T12:00:00.000Z')

  return {
    _id: 'mongo-id-1',
    instanceId: 'chi-org-demo-abc123',
    orgId: 'org-demo',
    clientName: 'starter-demo',
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
      installedAt: now,
    }],
    healthStatus: {
      lastCheck: now,
      isHealthy: true,
      latency: 12,
    },
    k8sNamespace: 'clawhost-org-demo',
    k8sPodName: 'pod-abc123',
    containerId: 'container-1',
    containerName: 'mediaclaw-clawhost-demo',
    runtimeImage: 'node:20-alpine',
    hostPort: 3900,
    healthUrl: 'http://127.0.0.1:3900/health',
    lastHealthMessage: '',
    requestedImChannel: '',
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
  let clawHostInstanceModel: Record<string, any>
  let redisService: Record<string, any>
  let apiKeyService: Record<string, any>
  let clawHostRuntimeService: Record<string, any>
  let clawHostAlertService: Record<string, any>
  let service: ClawHostService

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-09T12:00:00.000Z'))

    clawHostInstanceModel = {
      countDocuments: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue(0) }),
      create: vi.fn(),
      find: vi.fn(),
      findByIdAndUpdate: vi.fn(),
      findOne: vi.fn(),
      findOneAndUpdate: vi.fn(),
      updateOne: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue({ acknowledged: true }) }),
    }
    redisService = {
      del: vi.fn().mockResolvedValue(1),
      get: vi.fn().mockResolvedValue(null),
      getJson: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(true),
      setJson: vi.fn().mockResolvedValue(true),
    }
    apiKeyService = {
      create: vi.fn(),
      revokeInternal: vi.fn(),
    }
    clawHostRuntimeService = {
      createManagedContainer: vi.fn(),
      getContainerLogs: vi.fn().mockResolvedValue(['runtime-log']),
      inspectManagedContainer: vi.fn(),
      restartContainer: vi.fn().mockResolvedValue(undefined),
      startContainer: vi.fn().mockResolvedValue(undefined),
      stopContainer: vi.fn().mockResolvedValue(undefined),
      upgradeSkill: vi.fn().mockResolvedValue(undefined),
    }
    clawHostAlertService = {
      notifyUnhealthyInstance: vi.fn().mockResolvedValue(undefined),
    }

    service = new ClawHostService(
      clawHostInstanceModel as any,
      redisService as any,
      apiKeyService as any,
      clawHostRuntimeService as any,
      clawHostAlertService as any,
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('应创建 managed ClawHost 实例并保存运行时元数据', async () => {
    const createdInstance = createManagedInstance({
      instanceId: 'chi-org-pro-demo',
      clientName: 'pro-demo',
      plan: 'pro',
      hostPort: 3901,
      healthUrl: 'http://127.0.0.1:3901/health',
      accessUrl: 'http://127.0.0.1:3901/',
    })

    clawHostInstanceModel.find.mockReturnValue(createQuery([]))
    clawHostRuntimeService.createManagedContainer.mockResolvedValue({
      containerId: 'container-99',
      containerName: 'mediaclaw-clawhost-99',
      image: 'node:20-alpine',
      hostPort: 3901,
      accessUrl: 'http://127.0.0.1:3901/',
      healthUrl: 'http://127.0.0.1:3901/health',
    })
    clawHostInstanceModel.create.mockImplementation(async (payload: Record<string, any>) => ({
      ...createdInstance,
      ...payload,
      toObject: () => ({
        ...createdInstance,
        ...payload,
      }),
    }))

    const result = await service.createInstance('org-demo', undefined, undefined, {
      plan: 'pro',
    })

    expect(clawHostRuntimeService.createManagedContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-demo',
        plan: 'pro',
        clientName: 'pro-g-demo',
        preferredPort: 3900,
        skillVersion: 'latest',
      }),
    )
    expect(clawHostInstanceModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: 'pro',
        deploymentMode: 'managed',
        containerId: 'container-99',
        hostPort: 3901,
        healthUrl: 'http://127.0.0.1:3901/health',
      }),
    )
    expect(result.plan).toBe('pro')
    expect(result.connectionInfo.hostPort).toBe(3901)
    expect(result.connectionInfo.containerId).toBe('container-99')
  })

  it('应在启停和重启时调用 managed runtime', async () => {
    const managedInstance = createManagedInstance()

    clawHostInstanceModel.findOne.mockReturnValue(createQuery(managedInstance))
    clawHostInstanceModel.findByIdAndUpdate
      .mockReturnValueOnce(createQuery({
        ...managedInstance,
        status: 'running',
        healthStatus: {
          lastCheck: new Date('2026-04-09T12:01:00.000Z'),
          isHealthy: false,
          latency: 0,
        },
      }))
      .mockReturnValueOnce(createQuery({
        ...managedInstance,
        status: 'running',
      }))
    clawHostInstanceModel.findOneAndUpdate.mockReturnValue(createQuery({
      ...managedInstance,
      status: 'stopped',
      healthStatus: {
        lastCheck: new Date('2026-04-09T12:02:00.000Z'),
        isHealthy: false,
        latency: 0,
      },
    }))

    await service.startInstance('org-demo', managedInstance.instanceId)
    await service.stopInstance('org-demo', managedInstance.instanceId)
    const restarted = await service.restartInstance('org-demo', managedInstance.instanceId)

    expect(clawHostRuntimeService.startContainer).toHaveBeenCalledWith('container-1')
    expect(clawHostRuntimeService.stopContainer).toHaveBeenCalledWith('container-1')
    expect(clawHostRuntimeService.restartContainer).toHaveBeenCalledWith('container-1')
    expect(restarted.operation).toBe('restarting')
  })

  it('应把 managed runtime 的异常健康态映射为错误状态', async () => {
    const managedInstance = createManagedInstance()

    clawHostInstanceModel.findOne.mockReturnValue(createQuery(managedInstance))
    clawHostRuntimeService.inspectManagedContainer.mockResolvedValue({
      exists: true,
      running: false,
      status: 'exited',
      healthUrl: managedInstance.healthUrl,
      apiHealthy: false,
      latencyMs: 0,
      errorMessage: 'container_not_running',
    })

    const result = await service.getInstanceHealth('org-demo', managedInstance.instanceId)

    expect(result.status).toBe('error')
    expect(result.connectionStatus).toBe('container_stopped')
    expect(result.message).toBe('container_not_running')
    expect(clawHostInstanceModel.updateOne).toHaveBeenCalledWith(
      { _id: managedInstance._id },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'error',
          lastHealthMessage: 'container_not_running',
        }),
      }),
    )
  })

  it('应在巡检发现 managed 实例异常时发送告警', async () => {
    const unhealthyInstance = createManagedInstance({
      instanceId: 'chi-org-demo-unhealthy',
      healthStatus: {
        lastCheck: new Date('2026-04-09T08:00:00.000Z'),
        isHealthy: true,
        latency: 5,
      },
    })

    clawHostInstanceModel.find.mockReturnValue(createQuery([unhealthyInstance]))
    clawHostRuntimeService.inspectManagedContainer.mockResolvedValue({
      exists: true,
      running: true,
      status: 'running',
      healthUrl: unhealthyInstance.healthUrl,
      apiHealthy: false,
      latencyMs: 4800,
      errorMessage: 'upstream_timeout',
    })

    const result = await service.runHealthCheck()

    expect(result.checkedCount).toBe(1)
    expect(result.unhealthyCount).toBe(1)
    expect(redisService.set).toHaveBeenCalledWith(
      'mediaclaw:clawhost:alert:chi-org-demo-unhealthy',
      '1',
      900,
    )
    expect(clawHostAlertService.notifyUnhealthyInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceId: 'chi-org-demo-unhealthy',
        orgId: 'org-demo',
        message: 'upstream_timeout',
      }),
    )
  })
})
