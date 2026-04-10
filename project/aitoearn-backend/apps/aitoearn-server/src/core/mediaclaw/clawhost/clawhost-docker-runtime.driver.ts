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
  ManagedRuntimeRecord,
  ManagedRuntimeState,
  ManagedRuntimeTarget,
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
        RestartPolicy: {
          Name: 'unless-stopped',
        },
      },
      Labels: {
        'mediaclaw.managed': 'true',
        'mediaclaw.runtime_kind': this.kind,
        'mediaclaw.instance_id': input.instanceId,
        'mediaclaw.org_id': input.orgId,
        'mediaclaw.plan': input.plan,
        'mediaclaw.skill_id': 'mediaclaw-client',
        'mediaclaw.skill_version': input.skillVersion,
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
}
