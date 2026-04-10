import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ClawHostDockerRuntimeDriver } from './clawhost-docker-runtime.driver'
import { ClawHostK8sRuntimeDriver } from './clawhost-k8s-runtime.driver'
import { ClawHostRuntimeService } from './clawhost-runtime.service'
import { ClawHostRuntimeKind } from './clawhost-runtime.types'

describe('clawHostRuntimeService behavior', () => {
  let configService: { getString: ReturnType<typeof vi.fn> }
  let dockerDriver: Record<string, any>
  let k8sDriver: Record<string, any>
  let service: ClawHostRuntimeService

  beforeEach(() => {
    configService = {
      getString: vi.fn().mockReturnValue('docker'),
    }
    dockerDriver = {
      kind: ClawHostRuntimeKind.DOCKER,
      createManagedRuntime: vi.fn().mockResolvedValue({ runtimeKind: ClawHostRuntimeKind.DOCKER }),
      start: vi.fn(),
      stop: vi.fn(),
      restart: vi.fn(),
      upgradeSkill: vi.fn(),
      inspect: vi.fn().mockResolvedValue({ exists: true, running: true, status: 'running', apiHealthy: true, latencyMs: 12, errorMessage: '', healthUrl: '' }),
      getLogs: vi.fn().mockResolvedValue(['docker-log']),
    }
    k8sDriver = {
      kind: ClawHostRuntimeKind.K8S,
      createManagedRuntime: vi.fn().mockResolvedValue({ runtimeKind: ClawHostRuntimeKind.K8S }),
      start: vi.fn(),
      stop: vi.fn(),
      restart: vi.fn(),
      upgradeSkill: vi.fn(),
      inspect: vi.fn().mockResolvedValue({ exists: true, running: true, status: 'running', apiHealthy: true, latencyMs: 1, errorMessage: '', healthUrl: '' }),
      getLogs: vi.fn().mockResolvedValue(['k8s-log']),
    }

    service = new ClawHostRuntimeService(
      configService as any,
      dockerDriver as ClawHostDockerRuntimeDriver,
      k8sDriver as ClawHostK8sRuntimeDriver,
    )
  })

  it('应默认按配置选择 docker runtime 创建实例', async () => {
    const result = await service.createManagedContainer({
      instanceId: 'chi-org-demo',
      orgId: 'org-1',
      plan: 'starter',
      clientName: '直营客服',
      skillVersion: 'latest',
    })

    expect(result.runtimeKind).toBe(ClawHostRuntimeKind.DOCKER)
    expect(dockerDriver.createManagedRuntime).toHaveBeenCalled()
    expect(k8sDriver.createManagedRuntime).not.toHaveBeenCalled()
  })

  it('应按实例 runtimeKind 把操作路由到 k8s driver', async () => {
    await service.restartContainer({
      runtimeKind: ClawHostRuntimeKind.K8S,
      containerId: 'deploy-demo',
      namespace: 'clawhost-org-1',
    })

    expect(k8sDriver.restart).toHaveBeenCalledWith({
      runtimeKind: ClawHostRuntimeKind.K8S,
      containerId: 'deploy-demo',
      namespace: 'clawhost-org-1',
    })
    expect(dockerDriver.restart).not.toHaveBeenCalled()
  })

  it('应识别 k8s 为当前默认 runtime', () => {
    configService.getString.mockReturnValue('k8s')

    expect(service.resolveRuntimeKind()).toBe(ClawHostRuntimeKind.K8S)
  })
})
