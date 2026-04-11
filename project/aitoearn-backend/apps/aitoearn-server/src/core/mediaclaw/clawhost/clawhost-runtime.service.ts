import { Injectable, Optional } from '@nestjs/common'
import { ModuleRef } from '@nestjs/core'
import { MonitoringMetricsService } from '../health/monitoring-metrics.service'
import { MediaclawConfigService } from '../mediaclaw-config.service'
import { ClawHostDockerRuntimeDriver } from './clawhost-docker-runtime.driver'
import { ClawHostK8sRuntimeDriver } from './clawhost-k8s-runtime.driver'
import {
  ClawHostRuntimeDriver,
  ClawHostRuntimeKind,
  CreateManagedRuntimeInput,
  ManagedRuntimeScaleDecision,
  ManagedRuntimeScalingMetrics,
  ManagedRuntimeScalingPolicy,
  ManagedRuntimeTarget,
  ManagedRuntimeTemplate,
} from './clawhost-runtime.types'

@Injectable()
export class ClawHostRuntimeService {
  private readonly drivers: Map<ClawHostRuntimeKind, ClawHostRuntimeDriver>
  private metricsService: MonitoringMetricsService | null | undefined

  constructor(
    private readonly configService: MediaclawConfigService,
    @Optional() dockerDriver?: ClawHostDockerRuntimeDriver,
    @Optional() k8sDriver?: ClawHostK8sRuntimeDriver,
    @Optional() private readonly moduleRef?: ModuleRef,
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

  async terminateContainer(target: ManagedRuntimeTarget) {
    await this.resolveDriver(target.runtimeKind).terminate(target)
  }

  async reconcileResources(target: ManagedRuntimeTarget) {
    await this.resolveDriver(target.runtimeKind).reconcileResources(target)
  }

  async inspectManagedContainer(target: ManagedRuntimeTarget) {
    return this.resolveDriver(target.runtimeKind).inspect(target)
  }

  async describeManagedTemplate(target: ManagedRuntimeTarget): Promise<ManagedRuntimeTemplate> {
    return this.resolveDriver(target.runtimeKind).describeTemplate(target)
  }

  async evaluateAutoscaling(
    target: ManagedRuntimeTarget,
    metrics?: Partial<ManagedRuntimeScalingMetrics>,
  ): Promise<ManagedRuntimeScaleDecision> {
    const driver = this.resolveDriver(target.runtimeKind)
    const state = await driver.inspect(target)
    const snapshot = this.resolveScalingMetrics(state.latencyMs, metrics)
    const policy = this.buildScalingPolicy()
    const currentReplicas = Math.max(state.currentReplicas || state.desiredReplicas || 0, 0)

    let desiredReplicas = currentReplicas
    let action: ManagedRuntimeScaleDecision['action'] = 'none'
    let reason = 'within_threshold'

    const shouldScaleUp = (
      snapshot.queueDepth >= policy.queueDepthScaleUpThreshold
      || snapshot.responseTimeMs >= policy.responseTimeScaleUpThresholdMs
      || snapshot.queueLatencyMs >= policy.responseTimeScaleUpThresholdMs
    )
    && currentReplicas < policy.maxReplicas

    const shouldScaleDown = currentReplicas > policy.minReplicas && (
      snapshot.queueDepth <= policy.queueDepthScaleDownThreshold
      && snapshot.responseTimeMs <= policy.responseTimeScaleDownThresholdMs
      && snapshot.queueLatencyMs <= policy.responseTimeScaleDownThresholdMs
    )

    if (shouldScaleUp) {
      desiredReplicas = Math.min(policy.maxReplicas, Math.max(currentReplicas, 1) + 1)
      action = 'scale_up'
      reason = 'queue_or_latency_above_threshold'
    }
    else if (shouldScaleDown) {
      desiredReplicas = Math.max(policy.minReplicas, currentReplicas - 1)
      action = 'scale_down'
      reason = 'queue_and_latency_below_threshold'
    }

    if (desiredReplicas !== currentReplicas) {
      await driver.scale(target, desiredReplicas)
    }

    return {
      action,
      currentReplicas,
      desiredReplicas,
      reason,
      metrics: snapshot,
      policy,
    }
  }

  async getContainerLogs(target: ManagedRuntimeTarget, tail = 100) {
    return this.resolveDriver(target.runtimeKind).getLogs(target, tail)
  }

  resolveRuntimeKind() {
    const configured = this.configService
      .getString('MEDIACLAW_CLAWHOST_RUNTIME', ClawHostRuntimeKind.DOCKER)
      .trim()
      .toLowerCase()

    return configured === ClawHostRuntimeKind.K8S || configured === 'k3s'
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

  private resolveScalingMetrics(
    responseTimeMs: number,
    overrides?: Partial<ManagedRuntimeScalingMetrics>,
  ): ManagedRuntimeScalingMetrics {
    const snapshot = this.resolveMonitoringMetricsService()?.getOperationalSnapshot()

    return {
      queueDepth: overrides?.queueDepth ?? snapshot?.queue.depth ?? 0,
      responseTimeMs: overrides?.responseTimeMs ?? responseTimeMs,
      queueLatencyMs: overrides?.queueLatencyMs ?? snapshot?.queue.latency ?? 0,
      capturedAt: overrides?.capturedAt || new Date().toISOString(),
    }
  }

  private buildScalingPolicy(): ManagedRuntimeScalingPolicy {
    const minReplicas = Math.max(this.configService.getNumber('MEDIACLAW_CLAWHOST_AUTOSCALE_MIN_REPLICAS', 1), 0)
    const maxReplicas = Math.max(
      this.configService.getNumber('MEDIACLAW_CLAWHOST_AUTOSCALE_MAX_REPLICAS', 3),
      Math.max(minReplicas, 1),
    )

    return {
      minReplicas,
      maxReplicas,
      queueDepthScaleUpThreshold: this.configService.getNumber('MEDIACLAW_CLAWHOST_AUTOSCALE_QUEUE_UP', 20),
      queueDepthScaleDownThreshold: this.configService.getNumber('MEDIACLAW_CLAWHOST_AUTOSCALE_QUEUE_DOWN', 5),
      responseTimeScaleUpThresholdMs: this.configService.getNumber('MEDIACLAW_CLAWHOST_AUTOSCALE_RESPONSE_UP_MS', 1_500),
      responseTimeScaleDownThresholdMs: this.configService.getNumber('MEDIACLAW_CLAWHOST_AUTOSCALE_RESPONSE_DOWN_MS', 500),
    }
  }

  private resolveMonitoringMetricsService() {
    if (this.metricsService !== undefined) {
      return this.metricsService
    }

    if (!this.moduleRef) {
      this.metricsService = null
      return this.metricsService
    }

    try {
      this.metricsService = this.moduleRef.get(MonitoringMetricsService, { strict: false })
    }
    catch {
      this.metricsService = null
    }

    return this.metricsService
  }
}
