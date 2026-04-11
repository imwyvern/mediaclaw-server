import type { Duplex } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { Injectable, Logger } from '@nestjs/common'
import axios from 'axios'
import Docker from 'dockerode'
import { MediaclawConfigService } from '../mediaclaw-config.service'
import {
  buildClawHostBootstrapScript,
  ClawHostRuntimeDriver,
  ClawHostRuntimeKind,
  CreateManagedRuntimeInput,
  ManagedRuntimeQuota,
  ManagedRuntimeRecord,
  ManagedRuntimeState,
  ManagedRuntimeTarget,
  ManagedRuntimeTemplate,
} from './clawhost-runtime.types'

@Injectable()
export class ClawHostDockerRuntimeDriver implements ClawHostRuntimeDriver {
  readonly kind = ClawHostRuntimeKind.DOCKER
  private readonly logger = new Logger(ClawHostDockerRuntimeDriver.name)
  private dockerClient: Docker | null = null

  constructor(private readonly configService: MediaclawConfigService) {}

  async createManagedRuntime(input: CreateManagedRuntimeInput): Promise<ManagedRuntimeRecord> {
    const docker = this.getDocker()
    const image = this.configService.getString(['MEDIACLAW_CLAWHOST_IMAGE'], 'node:20-alpine')
    const port = input.preferredPort || this.configService.getNumber(['MEDIACLAW_CLAWHOST_BASE_PORT'], 3900)
    const containerName = this.buildContainerName(input.instanceId)
    const quota = this.resolveQuota(input.config)
    await this.ensureImage(image)

    const container = await docker.createContainer({
      name: containerName,
      Image: image,
      Env: [
        `PORT=3000`,
        `MEDIACLAW_INSTANCE_ID=${input.instanceId}`,
        `MEDIACLAW_ORG_ID=${input.orgId}`,
        `MEDIACLAW_PLAN=${input.plan}`,
        `MEDIACLAW_CLIENT_NAME=${input.clientName}`,
        `MEDIACLAW_SKILL_VERSION=${input.skillVersion}`,
      ],
      Cmd: ['node', '-e', buildClawHostBootstrapScript()],
      ExposedPorts: {
        '3000/tcp': {},
      },
      HostConfig: {
        PortBindings: {
          '3000/tcp': [{ HostPort: String(port) }],
        },
        NanoCpus: this.parseCpuToNano(quota.cpu),
        Memory: this.parseMemoryToBytes(quota.memory),
        RestartPolicy: {
          Name: 'unless-stopped',
        },
        Mounts: [{
          Type: 'volume',
          Source: this.buildVolumeName(input.instanceId),
          Target: '/opt/mediaclaw/data',
        }],
      },
      Healthcheck: {
        Test: ['CMD-SHELL', 'wget -qO- http://127.0.0.1:3000/health >/dev/null 2>&1 || exit 1'],
        Interval: 15_000_000_000,
        Timeout: 5_000_000_000,
        Retries: 3,
        StartPeriod: 10_000_000_000,
      },
      Labels: {
        'mediaclaw.managed': 'true',
        'mediaclaw.runtime_kind': this.kind,
        'mediaclaw.instance_id': input.instanceId,
        'mediaclaw.org_id': input.orgId,
        'mediaclaw.plan': input.plan,
        'mediaclaw.skill_id': 'mediaclaw-client',
        'mediaclaw.skill_version': input.skillVersion,
        'mediaclaw.quota_cpu': quota.cpu,
        'mediaclaw.quota_memory': quota.memory,
        'mediaclaw.quota_storage': quota.storage,
        'mediaclaw.namespace': this.buildNamespace(input.orgId),
      },
    })

    await container.start()

    return {
      runtimeKind: this.kind,
      containerId: container.id,
      containerName,
      image,
      hostPort: port,
      accessUrl: `http://127.0.0.1:${port}/`,
      healthUrl: `http://127.0.0.1:${port}/health`,
      quota,
      currentReplicas: 1,
      desiredReplicas: 1,
    }
  }

  async start(target: ManagedRuntimeTarget) {
    await this.getContainer(target.containerId).start()
  }

  async stop(target: ManagedRuntimeTarget) {
    await this.getContainer(target.containerId).stop({ t: 10 })
  }

  async restart(target: ManagedRuntimeTarget) {
    await this.getContainer(target.containerId).restart({ t: 10 })
  }

  async terminate(target: ManagedRuntimeTarget) {
    await this.getContainer(target.containerId).remove({ force: true, v: true })
  }

  async upgradeSkill(target: ManagedRuntimeTarget, version: string) {
    const container = this.getContainer(target.containerId)
    const exec = await container.exec({
      AttachStdout: true,
      AttachStderr: true,
      Cmd: [
        'node',
        '-e',
        `const fs=require('fs');fs.mkdirSync('/opt/mediaclaw/skills',{recursive:true});fs.writeFileSync('/opt/mediaclaw/skills/mediaclaw-client.version',${JSON.stringify(version)});process.stdout.write('ok\\n')`,
      ],
    })

    const stream = await exec.start({ hijack: false, stdin: false })
    await this.waitForStream(stream)
  }

  async reconcileResources(target: ManagedRuntimeTarget) {
    const quota = this.resolveQuota(target.config)
    await this.getContainer(target.containerId).update({
      NanoCpus: this.parseCpuToNano(quota.cpu),
      Memory: this.parseMemoryToBytes(quota.memory),
      RestartPolicy: {
        Name: 'unless-stopped',
      },
    })
  }

  async scale(target: ManagedRuntimeTarget, replicas: number) {
    const normalized = replicas > 0 ? 1 : 0
    const container = this.getContainer(target.containerId)

    if (normalized === 0) {
      await container.stop({ t: 10 }).catch(() => undefined)
      return
    }

    await container.start().catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error)
      if (!message.includes('already started')) {
        throw error
      }
    })
  }

  async inspect(target: ManagedRuntimeTarget): Promise<ManagedRuntimeState> {
    try {
      const inspected = await this.getContainer(target.containerId).inspect()
      const running = Boolean(inspected.State?.Running)
      const resolvedHealthUrl = target.healthUrl?.trim() || ''

      if (!running) {
        return {
          exists: true,
          running: false,
          status: inspected.State?.Status || 'stopped',
          healthUrl: resolvedHealthUrl,
          apiHealthy: false,
          latencyMs: 0,
          errorMessage: inspected.State?.Error || 'container_not_running',
          currentReplicas: 0,
          desiredReplicas: 0,
          quota: this.resolveQuotaFromLabels(inspected.Config?.Labels || {}, target.config),
          template: await this.describeTemplate(target),
        }
      }

      const startedAt = Date.now()
      let apiHealthy = false
      let errorMessage = ''
      if (resolvedHealthUrl) {
        try {
          const response = await axios.get(resolvedHealthUrl, { timeout: 5000 })
          apiHealthy = response.status >= 200 && response.status < 300
        }
        catch (error) {
          errorMessage = error instanceof Error ? error.message : String(error)
        }
      }

      return {
        exists: true,
        running,
        status: inspected.State?.Status || 'running',
        healthUrl: resolvedHealthUrl,
        apiHealthy: resolvedHealthUrl ? apiHealthy : running,
        latencyMs: Date.now() - startedAt,
        errorMessage,
        currentReplicas: running ? 1 : 0,
        desiredReplicas: running ? 1 : 0,
        quota: this.resolveQuotaFromLabels(inspected.Config?.Labels || {}, target.config),
        template: await this.describeTemplate(target),
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
        currentReplicas: 0,
        desiredReplicas: 0,
        quota: this.resolveQuota(target.config),
        template: await this.describeTemplate(target),
      }
    }
  }

  async describeTemplate(target: ManagedRuntimeTarget): Promise<ManagedRuntimeTemplate> {
    const quota = this.resolveQuota(target.config)
    const namespace = this.buildNamespace(target.orgId || '')
    const workloadName = target.containerName?.trim() || target.containerId

    return {
      runtimeKind: this.kind,
      namespace,
      workloadName,
      serviceName: workloadName,
      quota,
      probes: {
        readiness: {
          path: '/health',
          port: 3000,
          initialDelaySeconds: 5,
          periodSeconds: 10,
        },
        liveness: {
          path: '/health',
          port: 3000,
          initialDelaySeconds: 15,
          periodSeconds: 20,
        },
      },
      labels: {
        'mediaclaw.instance_id': target.instanceId || '',
        'mediaclaw.org_id': target.orgId || '',
      },
    }
  }

  async getLogs(target: ManagedRuntimeTarget, tail = 100) {
    const logs = await this.getContainer(target.containerId).logs({
      stdout: true,
      stderr: true,
      tail,
    })

    return logs.toString('utf-8')
      .split('\n')
      .map(item => item.trim())
      .filter(Boolean)
  }

  private getContainer(containerId: string) {
    return this.getDocker().getContainer(containerId)
  }

  private getDocker() {
    if (this.dockerClient) {
      return this.dockerClient
    }

    const socketPath = this.configService.getString(['MEDIACLAW_CLAWHOST_DOCKER_SOCKET'], '/var/run/docker.sock')
    this.dockerClient = new Docker({ socketPath })
    return this.dockerClient
  }

  private async ensureImage(image: string) {
    const docker = this.getDocker()
    try {
      await docker.getImage(image).inspect()
      return
    }
    catch {
      this.logger.log(`Pulling ClawHost runtime image: ${image}`)
    }

    await new Promise<void>((resolve, reject) => {
      docker.pull(image, (error: Error | null, stream?: NodeJS.ReadableStream) => {
        if (error || !stream) {
          reject(error || new Error('docker_pull_failed'))
          return
        }

        docker.modem.followProgress(stream, (pullError) => {
          if (pullError) {
            reject(pullError)
            return
          }
          resolve()
        })
      })
    })
  }

  private waitForStream(stream: Duplex) {
    return new Promise<void>((resolve, reject) => {
      stream.on('end', () => resolve())
      stream.on('error', reject)
    })
  }

  private buildContainerName(instanceId: string) {
    return `mediaclaw-clawhost-${instanceId}-${randomUUID().slice(0, 8)}`
  }

  private buildVolumeName(instanceId: string) {
    return `mediaclaw-clawhost-data-${instanceId}`
  }

  private buildNamespace(orgId: string) {
    const suffix = (orgId || 'default')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(-20)

    return `clawhost-${suffix || 'default'}`
  }

  private resolveQuota(config?: ManagedRuntimeTarget['config']): ManagedRuntimeQuota {
    return {
      cpu: config?.cpu?.trim() || '500m',
      memory: config?.memory?.trim() || '1Gi',
      storage: config?.storage?.trim() || '10Gi',
    }
  }

  private resolveQuotaFromLabels(
    labels: Record<string, string>,
    config?: ManagedRuntimeTarget['config'],
  ): ManagedRuntimeQuota {
    const fallback = this.resolveQuota(config)
    return {
      cpu: labels['mediaclaw.quota_cpu'] || fallback.cpu,
      memory: labels['mediaclaw.quota_memory'] || fallback.memory,
      storage: labels['mediaclaw.quota_storage'] || fallback.storage,
    }
  }

  private parseCpuToNano(value: string) {
    const normalized = value.trim().toLowerCase()
    if (!normalized) {
      return 500_000_000
    }

    if (normalized.endsWith('m')) {
      const milli = Number(normalized.slice(0, -1))
      return Number.isFinite(milli) && milli > 0 ? Math.round(milli * 1_000_000) : 500_000_000
    }

    const cpu = Number(normalized)
    return Number.isFinite(cpu) && cpu > 0 ? Math.round(cpu * 1_000_000_000) : 500_000_000
  }

  private parseMemoryToBytes(value: string) {
    const normalized = value.trim().toLowerCase()
    const matched = normalized.match(/^(\d+(?:\.\d+)?)(ki|mi|gi|ti|[kmgt])?$/)
    if (!matched) {
      return 1_073_741_824
    }

    const amount = Number(matched[1])
    if (!Number.isFinite(amount) || amount <= 0) {
      return 1_073_741_824
    }

    const unit = matched[2] || 'b'
    const factorMap: Record<string, number> = {
      b: 1,
      k: 1_000,
      m: 1_000_000,
      g: 1_000_000_000,
      t: 1_000_000_000_000,
      ki: 1024,
      mi: 1024 ** 2,
      gi: 1024 ** 3,
      ti: 1024 ** 4,
    }

    return Math.round(amount * (factorMap[unit] || factorMap['gi']))
  }
}
