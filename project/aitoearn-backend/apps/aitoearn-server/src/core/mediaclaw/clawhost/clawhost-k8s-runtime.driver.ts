import { spawn } from 'node:child_process'
import { Injectable } from '@nestjs/common'
import { MediaclawConfigService } from '../mediaclaw-config.service'
import {
  buildClawHostBootstrapScript,
  ClawHostRuntimeDriver,
  ClawHostRuntimeKind,
  CreateManagedRuntimeInput,
  ManagedRuntimeRecord,
  ManagedRuntimeState,
  ManagedRuntimeTarget,
} from './clawhost-runtime.types'

interface KubectlResult {
  stdout: string
  stderr: string
}

interface KubernetesDeploymentStatus {
  metadata?: {
    name?: string
  }
  status?: {
    readyReplicas?: number
    availableReplicas?: number
    unavailableReplicas?: number
    conditions?: Array<{
      type?: string
      status?: string
      message?: string
      reason?: string
    }>
  }
}

@Injectable()
export class ClawHostK8sRuntimeDriver implements ClawHostRuntimeDriver {
  readonly kind = ClawHostRuntimeKind.K8S

  constructor(private readonly configService: MediaclawConfigService) {}

  async createManagedRuntime(input: CreateManagedRuntimeInput): Promise<ManagedRuntimeRecord> {
    const namespace = this.normalizeNamespace(
      input.namespace || this.configService.getString('MEDIACLAW_CLAWHOST_K8S_NAMESPACE', 'mediaclaw-clawhost'),
    )
    const podName = this.normalizeKubernetesName(input.podName || input.instanceId)
    const deploymentName = this.buildDeploymentName(podName)
    const serviceName = this.buildServiceName(podName)
    const pvcName = this.buildPvcName(podName)
    const image = this.configService.getString(['MEDIACLAW_CLAWHOST_IMAGE'], 'node:20-alpine')
    const serviceDomain = this.configService.getString(
      'MEDIACLAW_CLAWHOST_K8S_SERVICE_DOMAIN',
      'svc.cluster.local',
    )

    await this.ensureNamespace(namespace)
    await this.kubectl([
      'apply',
      '-n',
      namespace,
      '-f',
      '-',
    ], {
      input: JSON.stringify(this.buildManifest({
        input,
        namespace,
        podName,
        deploymentName,
        serviceName,
        pvcName,
        image,
      })),
    })
    await this.kubectl([
      'rollout',
      'status',
      `deployment/${deploymentName}`,
      '-n',
      namespace,
      `--timeout=${this.configService.getString('MEDIACLAW_CLAWHOST_K8S_ROLLOUT_TIMEOUT', '120s')}`,
    ])

    return {
      runtimeKind: this.kind,
      containerId: deploymentName,
      containerName: serviceName,
      image,
      hostPort: 0,
      accessUrl: `http://${serviceName}.${namespace}.${serviceDomain}/`,
      healthUrl: `http://${serviceName}.${namespace}.${serviceDomain}/health`,
      namespace,
      podName,
    }
  }

  async start(target: ManagedRuntimeTarget) {
    await this.scale(target, 1)
  }

  async stop(target: ManagedRuntimeTarget) {
    await this.scale(target, 0)
  }

  async restart(target: ManagedRuntimeTarget) {
    const namespace = this.requireNamespace(target)
    await this.kubectl([
      'rollout',
      'restart',
      `deployment/${target.containerId}`,
      '-n',
      namespace,
    ])
    await this.waitForDeployment(target)
  }

  async upgradeSkill(target: ManagedRuntimeTarget, version: string) {
    const namespace = this.requireNamespace(target)
    await this.kubectl([
      'set',
      'env',
      `deployment/${target.containerId}`,
      '-n',
      namespace,
      `MEDIACLAW_SKILL_VERSION=${version}`,
    ])
    await this.waitForDeployment(target)
  }

  async inspect(target: ManagedRuntimeTarget): Promise<ManagedRuntimeState> {
    try {
      const namespace = this.requireNamespace(target)
      const result = await this.kubectl([
        'get',
        'deployment',
        target.containerId,
        '-n',
        namespace,
        '-o',
        'json',
      ])
      const deployment = JSON.parse(result.stdout) as KubernetesDeploymentStatus
      const readyReplicas = Number(deployment.status?.readyReplicas || 0)
      const availableReplicas = Number(deployment.status?.availableReplicas || 0)
      const unavailableReplicas = Number(deployment.status?.unavailableReplicas || 0)
      const availableCondition = deployment.status?.conditions?.find(
        condition => condition.type === 'Available',
      )
      const progressCondition = deployment.status?.conditions?.find(
        condition => condition.type === 'Progressing',
      )
      const running = readyReplicas > 0 || availableReplicas > 0
      const apiHealthy = running && unavailableReplicas === 0
      const errorMessage = apiHealthy
        ? ''
        : availableCondition?.message
          || progressCondition?.message
          || progressCondition?.reason
          || 'deployment_unavailable'

      return {
        exists: true,
        running,
        status: apiHealthy ? 'running' : 'degraded',
        healthUrl: target.healthUrl?.trim() || '',
        apiHealthy,
        latencyMs: apiHealthy ? 1 : 0,
        errorMessage,
      }
    }
    catch (error) {
      return {
        exists: false,
        running: false,
        status: 'missing',
        healthUrl: target.healthUrl?.trim() || '',
        apiHealthy: false,
        latencyMs: 0,
        errorMessage: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async getLogs(target: ManagedRuntimeTarget, tail = 100) {
    const namespace = this.requireNamespace(target)
    const result = await this.kubectl([
      'logs',
      `deployment/${target.containerId}`,
      '-n',
      namespace,
      '--tail',
      String(Math.min(Math.max(tail, 1), 500)),
    ])

    return result.stdout
      .split('\n')
      .map(item => item.trim())
      .filter(Boolean)
  }

  private async ensureNamespace(namespace: string) {
    try {
      await this.kubectl(['get', 'namespace', namespace])
    }
    catch {
      await this.kubectl(['create', 'namespace', namespace])
    }
  }

  private async scale(target: ManagedRuntimeTarget, replicas: number) {
    const namespace = this.requireNamespace(target)
    await this.kubectl([
      'scale',
      `deployment/${target.containerId}`,
      '-n',
      namespace,
      `--replicas=${replicas}`,
    ])

    if (replicas > 0) {
      await this.waitForDeployment(target)
    }
  }

  private async waitForDeployment(target: ManagedRuntimeTarget) {
    await this.kubectl([
      'rollout',
      'status',
      `deployment/${target.containerId}`,
      '-n',
      this.requireNamespace(target),
      `--timeout=${this.configService.getString('MEDIACLAW_CLAWHOST_K8S_ROLLOUT_TIMEOUT', '120s')}`,
    ])
  }

  private requireNamespace(target: ManagedRuntimeTarget) {
    return this.normalizeNamespace(
      target.namespace || this.configService.getString('MEDIACLAW_CLAWHOST_K8S_NAMESPACE', 'mediaclaw-clawhost'),
    )
  }

  private buildManifest(args: {
    input: CreateManagedRuntimeInput
    namespace: string
    podName: string
    deploymentName: string
    serviceName: string
    pvcName: string
    image: string
  }) {
    const labels = {
      'app.kubernetes.io/name': 'mediaclaw-clawhost',
      'app.kubernetes.io/managed-by': 'mediaclaw',
      'mediaclaw.instance_id': args.input.instanceId,
      'mediaclaw.org_id': args.input.orgId,
      'mediaclaw.plan': args.input.plan,
    }

    return {
      apiVersion: 'v1',
      kind: 'List',
      items: [
        {
          apiVersion: 'v1',
          kind: 'PersistentVolumeClaim',
          metadata: {
            name: args.pvcName,
            namespace: args.namespace,
            labels,
          },
          spec: {
            accessModes: ['ReadWriteOnce'],
            ...(this.configService.has('MEDIACLAW_CLAWHOST_K8S_STORAGE_CLASS')
              ? { storageClassName: this.configService.getString('MEDIACLAW_CLAWHOST_K8S_STORAGE_CLASS') }
              : {}),
            resources: {
              requests: {
                storage: args.input.config?.storage?.trim() || '10Gi',
              },
            },
          },
        },
        {
          apiVersion: 'apps/v1',
          kind: 'Deployment',
          metadata: {
            name: args.deploymentName,
            namespace: args.namespace,
            labels,
          },
          spec: {
            replicas: 1,
            selector: {
              matchLabels: {
                'mediaclaw.instance_id': args.input.instanceId,
              },
            },
            template: {
              metadata: {
                labels: {
                  ...labels,
                  'mediaclaw.instance_id': args.input.instanceId,
                },
              },
              spec: {
                containers: [
                  {
                    name: args.podName,
                    image: args.image,
                    env: [
                      { name: 'PORT', value: '3000' },
                      { name: 'MEDIACLAW_INSTANCE_ID', value: args.input.instanceId },
                      { name: 'MEDIACLAW_ORG_ID', value: args.input.orgId },
                      { name: 'MEDIACLAW_PLAN', value: args.input.plan },
                      { name: 'MEDIACLAW_CLIENT_NAME', value: args.input.clientName },
                      { name: 'MEDIACLAW_SKILL_VERSION', value: args.input.skillVersion },
                    ],
                    command: ['node', '-e', buildClawHostBootstrapScript()],
                    ports: [
                      { containerPort: 3000, name: 'http' },
                    ],
                    readinessProbe: {
                      httpGet: {
                        path: '/health',
                        port: 'http',
                      },
                      initialDelaySeconds: 5,
                      periodSeconds: 10,
                    },
                    livenessProbe: {
                      httpGet: {
                        path: '/health',
                        port: 'http',
                      },
                      initialDelaySeconds: 15,
                      periodSeconds: 20,
                    },
                    resources: {
                      requests: {
                        cpu: args.input.config?.cpu?.trim() || '500m',
                        memory: args.input.config?.memory?.trim() || '1Gi',
                      },
                      limits: {
                        cpu: this.configService.getString(
                          'MEDIACLAW_CLAWHOST_K8S_CPU_LIMIT',
                          args.input.config?.cpu?.trim() || '500m',
                        ),
                        memory: this.configService.getString(
                          'MEDIACLAW_CLAWHOST_K8S_MEMORY_LIMIT',
                          args.input.config?.memory?.trim() || '1Gi',
                        ),
                      },
                    },
                    volumeMounts: [
                      {
                        name: 'mediaclaw-data',
                        mountPath: '/opt/mediaclaw/data',
                      },
                    ],
                  },
                ],
                volumes: [
                  {
                    name: 'mediaclaw-data',
                    persistentVolumeClaim: {
                      claimName: args.pvcName,
                    },
                  },
                ],
              },
            },
          },
        },
        {
          apiVersion: 'v1',
          kind: 'Service',
          metadata: {
            name: args.serviceName,
            namespace: args.namespace,
            labels,
          },
          spec: {
            type: 'ClusterIP',
            selector: {
              'mediaclaw.instance_id': args.input.instanceId,
            },
            ports: [
              {
                name: 'http',
                port: 80,
                targetPort: 'http',
              },
            ],
          },
        },
      ],
    }
  }

  private buildDeploymentName(podName: string) {
    return this.normalizeKubernetesName(`deploy-${podName}`)
  }

  private buildServiceName(podName: string) {
    return this.normalizeKubernetesName(`svc-${podName}`)
  }

  private buildPvcName(podName: string) {
    return this.normalizeKubernetesName(`pvc-${podName}`)
  }

  private normalizeNamespace(value: string) {
    return this.normalizeKubernetesName(value || 'mediaclaw-clawhost')
  }

  private normalizeKubernetesName(value: string) {
    const normalized = value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')

    return (normalized || 'mediaclaw').slice(0, 63)
  }

  private kubectl(args: string[], options: { input?: string } = {}) {
    const command = this.configService.getString('MEDIACLAW_CLAWHOST_KUBECTL_BIN', 'kubectl')
    return new Promise<KubectlResult>((resolve, reject) => {
      const child = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
      })

      let stdout = ''
      let stderr = ''

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString()
      })
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString()
      })
      child.on('error', reject)
      child.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr })
          return
        }

        reject(new Error(stderr.trim() || stdout.trim() || `kubectl_exit_${code || 1}`))
      })

      if (options.input) {
        child.stdin.write(options.input)
      }
      child.stdin.end()
    })
  }
}
