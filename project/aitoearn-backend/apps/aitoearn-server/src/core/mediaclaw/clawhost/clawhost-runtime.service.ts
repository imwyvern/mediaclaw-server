import { Injectable, Optional } from '@nestjs/common'
import { MediaclawConfigService } from '../mediaclaw-config.service'
import { ClawHostDockerRuntimeDriver } from './clawhost-docker-runtime.driver'
import { ClawHostK8sRuntimeDriver } from './clawhost-k8s-runtime.driver'
import {
  ClawHostRuntimeDriver,
  ClawHostRuntimeKind,
  CreateManagedRuntimeInput,
  ManagedRuntimeTarget,
} from './clawhost-runtime.types'

@Injectable()
export class ClawHostRuntimeService {
  private readonly drivers: Map<ClawHostRuntimeKind, ClawHostRuntimeDriver>

  constructor(
    private readonly configService: MediaclawConfigService,
    @Optional() dockerDriver?: ClawHostDockerRuntimeDriver,
    @Optional() k8sDriver?: ClawHostK8sRuntimeDriver,
  ) {
    const resolvedDockerDriver = dockerDriver || new ClawHostDockerRuntimeDriver(configService)
    const resolvedK8sDriver = k8sDriver || new ClawHostK8sRuntimeDriver(configService)
    this.drivers = new Map<ClawHostRuntimeKind, ClawHostRuntimeDriver>([
      [resolvedDockerDriver.kind, resolvedDockerDriver],
      [resolvedK8sDriver.kind, resolvedK8sDriver],
    ])
  }

  async createManagedContainer(input: CreateManagedRuntimeInput) {
    return this.resolveDriver().createManagedRuntime(input)
  }

  async startContainer(target: ManagedRuntimeTarget) {
    await this.resolveDriver(target.runtimeKind).start(target)
  }

  async stopContainer(target: ManagedRuntimeTarget) {
    await this.resolveDriver(target.runtimeKind).stop(target)
  }

  async restartContainer(target: ManagedRuntimeTarget) {
    await this.resolveDriver(target.runtimeKind).restart(target)
  }

  async upgradeSkill(target: ManagedRuntimeTarget, version: string) {
    await this.resolveDriver(target.runtimeKind).upgradeSkill(target, version)
  }

  async inspectManagedContainer(target: ManagedRuntimeTarget) {
    return this.resolveDriver(target.runtimeKind).inspect(target)
  }

  async getContainerLogs(target: ManagedRuntimeTarget, tail = 100) {
    return this.resolveDriver(target.runtimeKind).getLogs(target, tail)
  }

  resolveRuntimeKind() {
    const configured = this.configService
      .getString('MEDIACLAW_CLAWHOST_RUNTIME', ClawHostRuntimeKind.DOCKER)
      .trim()
      .toLowerCase()

    return configured === ClawHostRuntimeKind.K8S
      ? ClawHostRuntimeKind.K8S
      : ClawHostRuntimeKind.DOCKER
  }

  private resolveDriver(kind = this.resolveRuntimeKind()) {
    const driver = this.drivers.get(kind)
    if (!driver) {
      throw new Error(`Unsupported ClawHost runtime: ${kind}`)
    }

    return driver
  }
}
