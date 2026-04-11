import { createHash, randomBytes } from 'node:crypto'
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { getModelToken } from '@nestjs/mongoose'
import { Cron } from '@nestjs/schedule'
import {
  ClawHostConfigInheritance,
  ClawHostDeploymentMode,
  ClawHostHealthStatus,
  ClawHostInstalledSkill,
  ClawHostInstance,
  ClawHostInstanceConfig,
  ClawHostInstanceLayer,
  ClawHostInstanceResourceIsolation,
  ClawHostInstanceStatus,
  ClawHostRuntimeKind,
  ClawHostSkillComposition,
  LayerBillingModel,
  LayerBillingPolicy,
  LayerPermissionPolicy,
  LayerQuotaPolicy,
  Organization,
  UserRole,
} from '@yikart/mongodb'
import { RedisService } from '@yikart/redis'
import { Model, Types } from 'mongoose'
import { MediaClawApiKeyService } from '../apikey/apikey.service'
import {
  mergeBillingPolicy,
  mergePermissionPolicy,
  mergeQuotaPolicy,
  normalizeLayerBillingPolicy,
  normalizeLayerPermissionPolicy,
  normalizeLayerQuotaPolicy,
  normalizeStringList,
} from '../shared/layer-policy.utils'
import { ClawHostAlertService } from './clawhost-alert.service'
import { ClawHostGatewayPushService } from './clawhost-gateway-push.service'
import {
  ClawHostPostgresInstanceRecord,
  ClawHostPostgresService,
} from './clawhost-postgres.service'
import { ClawHostRuntimeService } from './clawhost-runtime.service'
import { ManagedRuntimeTarget } from './clawhost-runtime.types'

interface ListInstancesFilters {
  orgId?: string
  status?: ClawHostInstanceStatus
}

interface PaginationInput {
  page?: number
  limit?: number
}

interface CreateInstanceOptions {
  plan?: string
  deploymentMode?: ClawHostDeploymentMode
  requestedImChannel?: string
  issuedByUserId?: string
}

interface ProvisionInstanceInput {
  orgId: string
  clientName: string
  plan?: string
  config?: ClawHostInstanceConfig
  accessUrl?: string
  deploymentMode?: ClawHostDeploymentMode
  requestedImChannel?: string
}

interface ConnectInstanceInput {
  code: string
  instanceId: string
  agentId?: string
  clientVersion?: string
  capabilities?: string[]
}

interface RecordHeartbeatInput {
  orgId?: string | null
  apiKeyId?: string | null
  agentId?: string
  clientVersion?: string
  capabilities?: string[]
}

interface InstanceLayerInput {
  resourceIsolation?: Partial<ClawHostInstanceResourceIsolation>
  quotaPolicy?: Partial<LayerQuotaPolicy>
  billingPolicy?: Partial<LayerBillingPolicy>
  permissionPolicy?: Partial<LayerPermissionPolicy>
  configInheritance?: Partial<ClawHostConfigInheritance>
  skillComposition?: Partial<ClawHostSkillComposition>
}

interface ConnectCodePayload {
  orgId: string
  instanceId: string
  requestedByUserId: string
  issuedAt: string
  expiresAt: string
}

const CONNECT_CODE_TTL_SECONDS = 10 * 60
const HEARTBEAT_FRESH_MS = 3 * 60 * 1000
const DEFAULT_OPENCLAW_SKILL_ID = 'mediaclaw-client'
const DEFAULT_OPENCLAW_SKILL_VERSION = 'latest'
const CLAWHOST_ALERT_TTL_SECONDS = 15 * 60
const CLAWHOST_STATUS_TRANSITIONS: Record<ClawHostInstanceStatus, ClawHostInstanceStatus[]> = {
  [ClawHostInstanceStatus.CREATING]: [
    ClawHostInstanceStatus.RUNNING,
    ClawHostInstanceStatus.ERROR,
    ClawHostInstanceStatus.STOPPED,
    ClawHostInstanceStatus.TERMINATED,
  ],
  [ClawHostInstanceStatus.PENDING_MANUAL_SETUP]: [
    ClawHostInstanceStatus.RUNNING,
    ClawHostInstanceStatus.STOPPED,
    ClawHostInstanceStatus.TERMINATED,
    ClawHostInstanceStatus.ERROR,
  ],
  [ClawHostInstanceStatus.RUNNING]: [
    ClawHostInstanceStatus.UPGRADING,
    ClawHostInstanceStatus.STOPPED,
    ClawHostInstanceStatus.ERROR,
    ClawHostInstanceStatus.TERMINATED,
  ],
  [ClawHostInstanceStatus.STOPPED]: [
    ClawHostInstanceStatus.RUNNING,
    ClawHostInstanceStatus.TERMINATED,
    ClawHostInstanceStatus.ERROR,
  ],
  [ClawHostInstanceStatus.UPGRADING]: [
    ClawHostInstanceStatus.RUNNING,
    ClawHostInstanceStatus.ERROR,
    ClawHostInstanceStatus.TERMINATED,
  ],
  [ClawHostInstanceStatus.ERROR]: [
    ClawHostInstanceStatus.RUNNING,
    ClawHostInstanceStatus.STOPPED,
    ClawHostInstanceStatus.UPGRADING,
    ClawHostInstanceStatus.TERMINATED,
  ],
  [ClawHostInstanceStatus.TERMINATED]: [],
}

const CLAWHOST_PLAN_PRESETS: Record<string, ClawHostInstanceConfig> = {
  starter: {
    cpu: '500m',
    memory: '1Gi',
    storage: '10Gi',
  },
  growth: {
    cpu: '1000m',
    memory: '2Gi',
    storage: '20Gi',
  },
  pro: {
    cpu: '2000m',
    memory: '4Gi',
    storage: '40Gi',
  },
  enterprise: {
    cpu: '4000m',
    memory: '8Gi',
    storage: '80Gi',
  },
}

@Injectable()
export class ClawHostService {
  private readonly logger = new Logger(ClawHostService.name)

  constructor(
    @Inject(getModelToken(ClawHostInstance.name))
    private readonly clawHostInstanceModel: Model<ClawHostInstance>,
    @Inject(getModelToken(Organization.name))
    private readonly organizationModel: Model<Organization>,
    private readonly redisService: RedisService,
    private readonly apiKeyService: MediaClawApiKeyService,
    private readonly clawHostRuntimeService: ClawHostRuntimeService,
    private readonly clawHostAlertService: ClawHostAlertService,
    private readonly clawHostPostgresService: ClawHostPostgresService,
    private readonly clawHostGatewayPushService: ClawHostGatewayPushService,
  ) {}

  async createInstance(
    orgId: string,
    config: ClawHostInstanceConfig | undefined,
    clientName: string | undefined,
    options: CreateInstanceOptions = {},
  ) {
    const normalizedOrgId = orgId?.trim()
    if (!normalizedOrgId) {
      throw new BadRequestException('orgId is required')
    }

    const plan = this.normalizePlan(options.plan)
    const resolvedClientName = clientName?.trim() || `${plan}-${normalizedOrgId.slice(-6)}`
    const resolvedConfig = this.resolveConfig(plan, config)
    const deploymentMode = options.deploymentMode || ClawHostDeploymentMode.MANAGED
    const instanceId = this.buildInstanceId(normalizedOrgId, resolvedClientName)
    const namespace = this.buildNamespace(normalizedOrgId)
    const podName = this.buildPodName(instanceId)
    const now = new Date()
    const initialSkills = this.buildDefaultInstalledSkills(now)
    if (this.isControlPlaneEnabled()) {
      let latestInstance = this.buildInstanceSnapshot({
        instanceId,
        orgId: normalizedOrgId,
        clientName: resolvedClientName,
        plan,
        deploymentMode,
        config: resolvedConfig,
        skills: initialSkills,
        healthStatus: this.buildPendingHealthStatus(now),
        requestedImChannel: options.requestedImChannel,
        status: deploymentMode === ClawHostDeploymentMode.MANAGED
          ? ClawHostInstanceStatus.CREATING
          : ClawHostInstanceStatus.PENDING_MANUAL_SETUP,
        runtime: {
          runtimeKind: this.clawHostRuntimeService.resolveRuntimeKind(),
          namespace,
          podName: deploymentMode === ClawHostDeploymentMode.MANAGED ? podName : '',
        },
      })

      latestInstance = await this.writeControlPlaneInstance(latestInstance, {
        ownerUserId: options.issuedByUserId?.trim() || '',
      })

      if (deploymentMode === ClawHostDeploymentMode.MANAGED) {
        try {
          const runtime = await this.provisionManagedRuntime({
            instanceId,
            orgId: normalizedOrgId,
            plan,
            clientName: resolvedClientName,
            config: resolvedConfig,
            namespace,
            podName,
          })
          latestInstance = await this.writeControlPlaneInstance({
            ...latestInstance,
            status: ClawHostInstanceStatus.RUNNING,
            runtimeKind: runtime.runtimeKind,
            containerId: runtime.containerId,
            containerName: runtime.containerName,
            runtimeImage: runtime.image,
            hostPort: runtime.hostPort,
            healthUrl: runtime.healthUrl,
            accessUrl: runtime.accessUrl,
            k8sNamespace: runtime.namespace || namespace,
            k8sPodName: runtime.podName || podName,
            healthStatus: this.buildPendingHealthStatus(new Date()),
            lastHealthMessage: '',
          } as ClawHostInstance, {
            ownerUserId: options.issuedByUserId?.trim() || '',
          })
        }
        catch (error) {
          const failed = await this.writeControlPlaneInstance({
            ...latestInstance,
            status: ClawHostInstanceStatus.ERROR,
            lastHealthMessage: error instanceof Error ? error.message : String(error),
          } as ClawHostInstance, {
            ownerUserId: options.issuedByUserId?.trim() || '',
          })
          throw new BadRequestException(
            failed.lastHealthMessage || 'Failed to provision ClawHost runtime',
          )
        }
      }

      let connectionCode: Awaited<ReturnType<ClawHostService['issueConnectionCode']>> | null = null
      if (options.issuedByUserId?.trim()) {
        connectionCode = await this.issueConnectionCode(
          normalizedOrgId,
          instanceId,
          options.issuedByUserId,
        )
        latestInstance = await this.getInstanceOrThrow(normalizedOrgId, instanceId)
      }

      return {
        ...this.toResponse(latestInstance),
        connectionCode: connectionCode
          ? {
              code: connectionCode.code,
              preview: connectionCode.preview,
              expiresAt: connectionCode.expiresAt,
            }
          : undefined,
      }
    }

    const runtime = deploymentMode === ClawHostDeploymentMode.MANAGED
      ? await this.provisionManagedRuntime({
          instanceId,
          orgId: normalizedOrgId,
          plan,
          clientName: resolvedClientName,
          config: resolvedConfig,
          namespace,
          podName,
        })
      : null
    const created = await this.clawHostInstanceModel.create({
      instanceId,
      orgId: normalizedOrgId,
      clientName: resolvedClientName,
      plan,
      status: deploymentMode === ClawHostDeploymentMode.MANAGED
        ? ClawHostInstanceStatus.RUNNING
        : ClawHostInstanceStatus.PENDING_MANUAL_SETUP,
      deploymentMode,
      config: resolvedConfig,
      skills: initialSkills,
      healthStatus: this.buildPendingHealthStatus(now),
      gatewayConfig: this.buildGatewayConfig(),
      sharedExperienceConfig: this.buildSharedExperienceConfig(),
      instanceLayer: this.buildDefaultInstanceLayer(normalizedOrgId, initialSkills),
      k8sNamespace: runtime?.namespace || namespace,
      k8sPodName: deploymentMode === ClawHostDeploymentMode.MANAGED
        ? runtime?.podName || podName
        : '',
      runtimeKind: runtime?.runtimeKind || this.clawHostRuntimeService.resolveRuntimeKind(),
      containerId: runtime?.containerId || '',
      containerName: runtime?.containerName || '',
      runtimeImage: runtime?.image || '',
      hostPort: runtime?.hostPort || 0,
      healthUrl: runtime?.healthUrl || '',
      lastHealthMessage: '',
      requestedImChannel: options.requestedImChannel?.trim() || '',
      accessUrl: runtime?.accessUrl || this.buildAccessUrl(instanceId),
      installCommand: this.buildInstallCommand(),
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
    })

    let latestInstance = created.toObject() as ClawHostInstance
    let connectionCode: Awaited<ReturnType<ClawHostService['issueConnectionCode']>> | null = null

    if (options.issuedByUserId?.trim()) {
      connectionCode = await this.issueConnectionCode(normalizedOrgId, instanceId, options.issuedByUserId)
      latestInstance = await this.getInstanceOrThrow(normalizedOrgId, instanceId)
    }

    await this.syncPostgresMetadata(latestInstance, {
      ownerUserId: options.issuedByUserId?.trim() || '',
    })

    return {
      ...this.toResponse(latestInstance),
      connectionCode: connectionCode
        ? {
            code: connectionCode.code,
            preview: connectionCode.preview,
            expiresAt: connectionCode.expiresAt,
          }
        : undefined,
    }
  }

  async provisionInstance(input: ProvisionInstanceInput) {
    const orgId = input.orgId?.trim()
    const clientName = input.clientName?.trim()
    const plan = this.normalizePlan(input.plan)
    if (!orgId) {
      throw new BadRequestException('orgId is required')
    }
    if (!clientName) {
      throw new BadRequestException('clientName is required')
    }

    const instanceId = this.buildInstanceId(orgId, clientName)
    const deploymentMode = input.deploymentMode || ClawHostDeploymentMode.MANAGED
    const resolvedConfig = this.resolveConfig(plan, input.config)
    const namespace = this.buildNamespace(orgId)
    const podName = this.buildPodName(instanceId)
    const initialSkills = this.buildDefaultInstalledSkills(new Date())
    if (this.isControlPlaneEnabled()) {
      let instance = this.buildInstanceSnapshot({
        instanceId,
        orgId,
        clientName,
        plan,
        deploymentMode,
        config: resolvedConfig,
        skills: initialSkills,
        healthStatus: this.buildPendingHealthStatus(new Date()),
        requestedImChannel: input.requestedImChannel,
        accessUrl: input.accessUrl,
        status: deploymentMode === ClawHostDeploymentMode.MANAGED
          ? ClawHostInstanceStatus.CREATING
          : ClawHostInstanceStatus.PENDING_MANUAL_SETUP,
        runtime: {
          runtimeKind: this.clawHostRuntimeService.resolveRuntimeKind(),
          namespace,
          podName: deploymentMode === ClawHostDeploymentMode.MANAGED ? podName : '',
        },
      })

      instance = await this.writeControlPlaneInstance(instance)

      if (deploymentMode === ClawHostDeploymentMode.MANAGED) {
        const runtime = await this.provisionManagedRuntime({
          instanceId,
          orgId,
          plan,
          clientName,
          config: resolvedConfig,
          namespace,
          podName,
        })
        instance = await this.writeControlPlaneInstance({
          ...instance,
          status: ClawHostInstanceStatus.RUNNING,
          runtimeKind: runtime.runtimeKind,
          containerId: runtime.containerId,
          containerName: runtime.containerName,
          runtimeImage: runtime.image,
          hostPort: runtime.hostPort,
          healthUrl: runtime.healthUrl,
          accessUrl: input.accessUrl?.trim() || runtime.accessUrl,
          k8sNamespace: runtime.namespace || namespace,
          k8sPodName: runtime.podName || podName,
          healthStatus: this.buildPendingHealthStatus(new Date()),
          lastHealthMessage: '',
        } as ClawHostInstance)
      }

      return {
        ...this.toResponse(instance),
        provisioned: true,
      }
    }

    const runtime = deploymentMode === ClawHostDeploymentMode.MANAGED
      ? await this.provisionManagedRuntime({
          instanceId,
          orgId,
          plan,
          clientName,
          config: resolvedConfig,
          namespace,
          podName,
        })
      : null

    const instance = await this.clawHostInstanceModel.create({
      instanceId,
      orgId,
      clientName,
      plan,
      status: deploymentMode === ClawHostDeploymentMode.MANAGED
        ? ClawHostInstanceStatus.RUNNING
        : ClawHostInstanceStatus.CREATING,
      deploymentMode,
      config: resolvedConfig,
      skills: initialSkills,
      healthStatus: this.buildPendingHealthStatus(new Date()),
      gatewayConfig: this.buildGatewayConfig(),
      sharedExperienceConfig: this.buildSharedExperienceConfig(),
      instanceLayer: this.buildDefaultInstanceLayer(orgId, initialSkills),
      k8sNamespace: runtime?.namespace || namespace,
      k8sPodName: deploymentMode === ClawHostDeploymentMode.MANAGED
        ? runtime?.podName || podName
        : '',
      runtimeKind: runtime?.runtimeKind || this.clawHostRuntimeService.resolveRuntimeKind(),
      containerId: runtime?.containerId || '',
      containerName: runtime?.containerName || '',
      runtimeImage: runtime?.image || '',
      hostPort: runtime?.hostPort || 0,
      healthUrl: runtime?.healthUrl || '',
      lastHealthMessage: '',
      requestedImChannel: input.requestedImChannel?.trim() || '',
      accessUrl: input.accessUrl?.trim() || runtime?.accessUrl || this.buildAccessUrl(instanceId),
      installCommand: this.buildInstallCommand(),
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
    })

    await this.syncPostgresMetadata(instance.toObject() as ClawHostInstance)

    return {
      ...this.toResponse(instance.toObject() as ClawHostInstance),
      provisioned: true,
    }
  }

  async issueConnectionCode(orgId: string, instanceId: string, requestedByUserId: string) {
    const instance = await this.getInstanceOrThrow(orgId, instanceId)
    const code = this.buildConnectionCode()
    const now = new Date()
    const expiresAt = new Date(now.getTime() + CONNECT_CODE_TTL_SECONDS * 1000)
    const payload: ConnectCodePayload = {
      orgId: instance.orgId,
      instanceId: instance.instanceId,
      requestedByUserId: requestedByUserId.trim(),
      issuedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    }

    const stored = await this.redisService.setJson(
      this.buildConnectionCodeCacheKey(code),
      payload,
      CONNECT_CODE_TTL_SECONDS,
    )
    if (!stored) {
      throw new BadRequestException('Failed to issue connection code')
    }

    if (this.isControlPlaneEnabled()) {
      await this.writeControlPlaneInstance({
        ...instance,
        connectionCodePreview: this.maskConnectionCode(code),
        connectionCodeHash: this.hashValue(code),
        connectionCodeIssuedAt: now,
        connectionCodeExpiresAt: expiresAt,
        status: instance.boundApiKeyId
          ? instance.status
          : ClawHostInstanceStatus.PENDING_MANUAL_SETUP,
      } as ClawHostInstance)
    }
    else {
      await this.clawHostInstanceModel.updateOne(
        { _id: instance._id },
        {
          $set: {
            connectionCodePreview: this.maskConnectionCode(code),
            connectionCodeHash: this.hashValue(code),
            connectionCodeIssuedAt: now,
            connectionCodeExpiresAt: expiresAt,
            status: instance.boundApiKeyId
              ? instance.status
              : ClawHostInstanceStatus.PENDING_MANUAL_SETUP,
          },
        },
      ).exec()
    }

    return {
      instanceId: instance.instanceId,
      code,
      preview: this.maskConnectionCode(code),
      expiresAt: expiresAt.toISOString(),
      installCommand: instance.installCommand || this.buildInstallCommand(),
      accessUrl: instance.accessUrl || this.buildAccessUrl(instance.instanceId),
    }
  }

  async connectInstance(input: ConnectInstanceInput) {
    const code = input.code?.trim().toUpperCase()
    const requestedInstanceId = input.instanceId?.trim()
    if (!code) {
      throw new BadRequestException('code is required')
    }
    if (!requestedInstanceId) {
      throw new BadRequestException('instanceId is required')
    }

    const payload = await this.redisService.consumeJson<ConnectCodePayload>(
      this.buildConnectionCodeCacheKey(code),
    )
    if (!payload) {
      throw new BadRequestException('连接码已过期，请在 Web 后台重新生成')
    }

    if (payload.instanceId !== requestedInstanceId) {
      throw new BadRequestException('该连接码不属于当前实例')
    }

    const instance = await this.getInstanceOrThrow(payload.orgId, payload.instanceId)
    if (!this.isConnectionCodeCurrent(instance, code, payload.expiresAt)) {
      throw new BadRequestException('连接码已失效，请在 Web 后台重新生成')
    }

    const previousBoundApiKeyId = instance.boundApiKeyId?.trim() || ''
    let apiKey: Awaited<ReturnType<MediaClawApiKeyService['create']>> | null = null

    const now = new Date()
    const capabilities = this.normalizeCapabilities(input.capabilities)
    const nextStatus = this.buildHealthyStatus(now, 1)
    try {
      apiKey = await this.apiKeyService.create(payload.requestedByUserId, {
        name: `${instance.clientName} OpenClaw Skill`,
        orgId: instance.orgId,
        permissions: ['skill:heartbeat', 'skill:deliveries', 'skill:feedback'],
        role: UserRole.OPERATOR,
      })

      const nextInstance = {
        ...instance,
        status: ClawHostInstanceStatus.RUNNING,
        boundApiKeyId: apiKey.id,
        boundApiKeyPrefix: apiKey.prefix,
        boundAt: now,
        lastHeartbeatAt: now,
        lastClientVersion: input.clientVersion?.trim() || '',
        lastAgentId: input.agentId?.trim() || requestedInstanceId,
        heartbeatCapabilities: capabilities,
        healthStatus: nextStatus,
        connectionCodeHash: '',
        connectionCodePreview: '',
        connectionCodeIssuedAt: null,
        connectionCodeExpiresAt: null,
      } as ClawHostInstance

      if (this.isControlPlaneEnabled()) {
        await this.writeControlPlaneInstance(nextInstance, {
          ownerUserId: payload.requestedByUserId,
          apiToken: apiKey.key,
          deviceId: input.agentId?.trim() || requestedInstanceId,
          deviceApproved: true,
        })
      }
      else {
        await this.clawHostInstanceModel.updateOne(
          { _id: instance._id },
          {
            $set: {
              status: ClawHostInstanceStatus.RUNNING,
              boundApiKeyId: apiKey.id,
              boundApiKeyPrefix: apiKey.prefix,
              boundAt: now,
              lastHeartbeatAt: now,
              lastClientVersion: input.clientVersion?.trim() || '',
              lastAgentId: input.agentId?.trim() || requestedInstanceId,
              heartbeatCapabilities: capabilities,
              healthStatus: nextStatus,
              connectionCodeHash: '',
              connectionCodePreview: '',
              connectionCodeIssuedAt: null,
              connectionCodeExpiresAt: null,
            },
          },
        ).exec()
        await this.syncPostgresMetadata(
          await this.getInstanceOrThrow(payload.orgId, payload.instanceId),
          {
            ownerUserId: payload.requestedByUserId,
            apiToken: apiKey.key,
            deviceId: input.agentId?.trim() || requestedInstanceId,
            deviceApproved: true,
          },
        )
      }
    }
    catch (error) {
      await this.handleFailedInstanceConnection(code, payload, apiKey?.id)
      throw error
    }

    if (!apiKey) {
      throw new BadRequestException('Failed to create ClawHost API key')
    }

    if (previousBoundApiKeyId && previousBoundApiKeyId !== apiKey.id) {
      await this.apiKeyService.revokeInternal(previousBoundApiKeyId).catch((error) => {
        this.logger.warn({
          message: 'Failed to revoke previous ClawHost API key after rebinding',
          instanceId: instance.instanceId,
          apiKeyId: previousBoundApiKeyId,
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }

    return {
      status: 'connected',
      instanceId: instance.instanceId,
      orgId: instance.orgId,
      apiKey: apiKey.key,
      prefix: apiKey.prefix,
      accessUrl: instance.accessUrl || this.buildAccessUrl(instance.instanceId),
      connectedAt: now.toISOString(),
    }
  }

  async recordHeartbeat(input: RecordHeartbeatInput) {
    const agentId = input.agentId?.trim() || ''
    const instance = this.isControlPlaneEnabled()
      ? input.apiKeyId?.trim()
        ? await this.hydratePostgresRecord(
            await this.clawHostPostgresService.findByBoundApiKeyId(input.apiKeyId.trim()),
          )
        : agentId && input.orgId?.trim()
          ? await this.hydratePostgresRecord(
              await this.clawHostPostgresService.findByAgent(input.orgId.trim(), agentId),
            )
          : null
      : input.apiKeyId?.trim()
        ? await this.clawHostInstanceModel.findOne({
            boundApiKeyId: input.apiKeyId.trim(),
          }).exec()
        : agentId && input.orgId?.trim()
          ? await this.clawHostInstanceModel.findOne({
              orgId: input.orgId.trim(),
              instanceId: agentId,
            }).exec()
          : null

    if (!instance) {
      return null
    }

    const now = new Date()
    const capabilities = this.normalizeCapabilities(input.capabilities)
    const nextInstance = {
      ...instance,
      status: ClawHostInstanceStatus.RUNNING,
      lastHeartbeatAt: now,
      lastClientVersion: input.clientVersion?.trim() || instance.lastClientVersion || '',
      lastAgentId: agentId || instance.lastAgentId || instance.instanceId,
      heartbeatCapabilities: capabilities,
      healthStatus: this.buildHealthyStatus(now, 1),
    } as ClawHostInstance

    if (this.isControlPlaneEnabled()) {
      await this.writeControlPlaneInstance(nextInstance, {
        deviceId: agentId || instance.instanceId,
        deviceApproved: true,
      })
    }
    else {
      const mutableInstance = instance as any
      mutableInstance.set('status', ClawHostInstanceStatus.RUNNING)
      mutableInstance.set('lastHeartbeatAt', now)
      mutableInstance.set('lastClientVersion', input.clientVersion?.trim() || instance.lastClientVersion || '')
      mutableInstance.set('lastAgentId', agentId || instance.lastAgentId || instance.instanceId)
      mutableInstance.set('heartbeatCapabilities', capabilities)
      mutableInstance.set('healthStatus', this.buildHealthyStatus(now, 1))
      await mutableInstance.save()
      await this.syncPostgresMetadata(mutableInstance.toObject() as ClawHostInstance, {
        deviceId: agentId || instance.instanceId,
        deviceApproved: true,
      })
    }

    return {
      instanceId: instance.instanceId,
      status: nextInstance.status,
      lastHeartbeatAt: now.toISOString(),
    }
  }

  async startInstance(orgId: string, instanceId: string) {
    const instance = await this.getInstanceOrThrow(orgId, instanceId)
    this.assertLifecycleTransition(instance.status, ClawHostInstanceStatus.RUNNING, 'start')
    if (this.isManagedInstance(instance)) {
      await this.clawHostRuntimeService.startContainer(this.buildManagedRuntimeTarget(instance))
    }

    if (this.isControlPlaneEnabled()) {
      const started = await this.writeControlPlaneInstance({
        ...instance,
        status: ClawHostInstanceStatus.RUNNING,
        healthStatus: this.buildPendingHealthStatus(new Date()),
        lastHealthMessage: '',
      } as ClawHostInstance)

      return {
        ...this.toResponse(started),
        operation: 'starting',
      }
    }

    const started = await this.clawHostInstanceModel.findByIdAndUpdate(
      instance._id,
      {
        $set: {
          status: ClawHostInstanceStatus.RUNNING,
          healthStatus: this.buildPendingHealthStatus(new Date()),
          lastHealthMessage: '',
        },
      },
      { new: true },
    ).lean().exec()

    if (!started) {
      throw new NotFoundException('ClawHost instance not found')
    }

    await this.syncPostgresMetadata(started as ClawHostInstance)

    return {
      ...this.toResponse(started),
      operation: 'starting',
    }
  }

  async stopInstance(orgId: string, instanceId: string) {
    const instance = await this.getInstanceOrThrow(orgId, instanceId)
    this.assertLifecycleTransition(instance.status, ClawHostInstanceStatus.STOPPED, 'stop')
    if (this.isManagedInstance(instance)) {
      await this.clawHostRuntimeService.stopContainer(this.buildManagedRuntimeTarget(instance))
    }

    if (this.isControlPlaneEnabled()) {
      const stopped = await this.writeControlPlaneInstance({
        ...instance,
        status: ClawHostInstanceStatus.STOPPED,
        healthStatus: {
          lastCheck: new Date(),
          isHealthy: false,
          latency: 0,
        },
        lastHealthMessage: '',
      } as ClawHostInstance)

      return this.toResponse(stopped)
    }

    const stopped = await this.clawHostInstanceModel.findOneAndUpdate(
      { instanceId, orgId: orgId.trim() },
      {
        $set: {
          status: ClawHostInstanceStatus.STOPPED,
          healthStatus: {
            lastCheck: new Date(),
            isHealthy: false,
            latency: 0,
          },
          lastHealthMessage: '',
        },
      },
      { new: true },
    ).lean().exec()

    if (!stopped) {
      throw new NotFoundException('ClawHost instance not found')
    }

    await this.syncPostgresMetadata(stopped as ClawHostInstance)

    return this.toResponse(stopped)
  }

  async restartInstance(orgId: string, instanceId: string) {
    const existing = await this.getInstanceOrThrow(orgId, instanceId)
    this.assertLifecycleTransition(existing.status, ClawHostInstanceStatus.RUNNING, 'restart')

    this.logger.log({
      message: 'ClawHost instance restarting',
      instanceId,
      previousStatus: existing.status,
    })

    if (this.isManagedInstance(existing)) {
      await this.clawHostRuntimeService.restartContainer(this.buildManagedRuntimeTarget(existing))
    }

    if (this.isControlPlaneEnabled()) {
      const restarted = await this.writeControlPlaneInstance({
        ...existing,
        status: this.isManagedInstance(existing)
          ? ClawHostInstanceStatus.RUNNING
          : ClawHostInstanceStatus.CREATING,
        healthStatus: this.buildPendingHealthStatus(new Date()),
        lastHeartbeatAt: this.isManagedInstance(existing)
          ? existing.lastHeartbeatAt
          : null,
        lastHealthMessage: '',
      } as ClawHostInstance)

      return {
        ...this.toResponse(restarted),
        operation: 'restarting',
      }
    }

    const restarted = await this.clawHostInstanceModel.findByIdAndUpdate(
      existing._id,
      {
        $set: {
          status: this.isManagedInstance(existing)
            ? ClawHostInstanceStatus.RUNNING
            : ClawHostInstanceStatus.CREATING,
          healthStatus: this.buildPendingHealthStatus(new Date()),
          lastHeartbeatAt: this.isManagedInstance(existing)
            ? existing.lastHeartbeatAt
            : null,
          lastHealthMessage: '',
        },
      },
      { new: true },
    ).lean().exec()

    if (!restarted) {
      throw new NotFoundException('ClawHost instance not found')
    }

    await this.syncPostgresMetadata(restarted as ClawHostInstance)

    return {
      ...this.toResponse(restarted),
      operation: 'restarting',
    }
  }

  async terminateInstance(orgId: string, instanceId: string) {
    const instance = await this.getInstanceOrThrow(orgId, instanceId)
    this.assertLifecycleTransition(instance.status, ClawHostInstanceStatus.TERMINATED, 'terminate')

    if (this.isManagedInstance(instance)) {
      await this.clawHostRuntimeService.terminateContainer(this.buildManagedRuntimeTarget(instance))
    }

    const terminatedAt = new Date()
    const nextInstance = {
      ...instance,
      status: ClawHostInstanceStatus.TERMINATED,
      healthStatus: {
        lastCheck: terminatedAt,
        isHealthy: false,
        latency: 0,
      },
      lastHealthMessage: 'instance_terminated',
    } as ClawHostInstance

    if (this.isControlPlaneEnabled()) {
      await this.writeControlPlaneInstance(nextInstance)
    }
    else {
      await this.clawHostInstanceModel.updateOne(
        { _id: instance._id },
        {
          $set: {
            status: nextInstance.status,
            healthStatus: nextInstance.healthStatus,
            lastHealthMessage: nextInstance.lastHealthMessage,
          },
        },
      ).exec()
      await this.syncPostgresMetadata(nextInstance)
    }

    return {
      ...this.toResponse(nextInstance),
      operation: 'terminated',
    }
  }

  async getInstanceHealth(orgId: string, instanceId: string) {
    const instance = await this.getInstanceOrThrow(orgId, instanceId)
    const derived = this.isManagedInstance(instance)
      ? await this.deriveManagedRuntimeState(instance)
      : this.deriveRuntimeState(instance)
    const scaling = this.isManagedInstance(instance) && derived.status === ClawHostInstanceStatus.RUNNING
      ? await this.evaluateManagedAutoscaling(instance)
      : null

    if (derived.shouldPersist) {
      const nextInstance = {
        ...instance,
        status: derived.status,
        healthStatus: derived.healthStatus,
        lastHealthMessage: derived.healthMessage || '',
      } as ClawHostInstance
      if (this.isControlPlaneEnabled()) {
        await this.writeControlPlaneInstance(nextInstance)
      }
      else {
        await this.clawHostInstanceModel.updateOne(
          { _id: instance._id },
          {
            $set: {
              status: derived.status,
              healthStatus: derived.healthStatus,
              lastHealthMessage: derived.healthMessage || '',
            },
          },
        ).exec()
        await this.syncPostgresMetadata(nextInstance)
      }
    }

    return {
      instanceId: instance.instanceId,
      status: derived.status,
      healthStatus: derived.healthStatus,
      connectionStatus: derived.connectionStatus,
      lastHeartbeatAt: instance.lastHeartbeatAt,
      message: derived.healthMessage || '',
      scaling,
    }
  }

  async getInstance(orgId: string, instanceId: string) {
    const instance = await this.getInstanceOrThrow(orgId, instanceId)
    const derived = this.isManagedInstance(instance)
      ? this.deriveManagedRuntimeStateFromSnapshot(instance)
      : this.deriveRuntimeState(instance)

    return this.toResponse({
      ...instance,
      status: derived.status,
      healthStatus: derived.healthStatus,
    })
  }

  async getInstanceArchitecture(orgId: string, instanceId: string) {
    const instance = await this.getInstanceOrThrow(orgId, instanceId)
    const org = await this.getOrganizationOrNull(instance.orgId)
    const platformLayer = this.buildPlatformLayerSnapshot(org?.platformLayer)
    const instanceLayer = this.buildInstanceLayer(
      instance.instanceLayer,
      instance.orgId,
      instance.skills || [],
    )

    return {
      instanceId: instance.instanceId,
      orgId: instance.orgId,
      platformLayer,
      instanceLayer: {
        ...instanceLayer,
        resourceIsolation: this.buildResourceIsolationSnapshot(instance, instanceLayer.resourceIsolation),
      },
      resolved: {
        quotaPolicy: instanceLayer.configInheritance.inheritQuotaPolicy
          ? mergeQuotaPolicy(platformLayer.quotaPolicy, instanceLayer.quotaPolicy)
          : instanceLayer.quotaPolicy,
        billingPolicy: instanceLayer.configInheritance.inheritBillingPolicy
          ? mergeBillingPolicy(platformLayer.billingPolicy, instanceLayer.billingPolicy)
          : instanceLayer.billingPolicy,
        permissionPolicy: instanceLayer.configInheritance.inheritPermissionPolicy
          ? mergePermissionPolicy(platformLayer.permissionPolicy, instanceLayer.permissionPolicy)
          : instanceLayer.permissionPolicy,
      },
    }
  }

  async updateInstanceArchitecture(
    orgId: string,
    instanceId: string,
    input: InstanceLayerInput,
  ) {
    const instance = await this.getInstanceOrThrow(orgId, instanceId)

    this.validateSkillCompositionInput(
      input.skillComposition,
      this.collectInstalledSkillIds(instance.skills || []),
    )

    const nextInstance = {
      ...instance,
      instanceLayer: this.buildInstanceLayer(
        instance.instanceLayer,
        instance.orgId,
        instance.skills || [],
        input,
      ),
    } as ClawHostInstance

    if (this.isControlPlaneEnabled()) {
      await this.writeControlPlaneInstance(nextInstance)
    }
    else {
      const mutableInstance = await this.clawHostInstanceModel.findOne({
        instanceId,
        orgId: orgId.trim(),
      }).exec()
      if (!mutableInstance) {
        throw new NotFoundException('ClawHost instance not found')
      }
      mutableInstance.set('instanceLayer', nextInstance.instanceLayer)
      await mutableInstance.save()
    }

    return this.getInstanceArchitecture(orgId, instanceId)
  }

  async configureGateway(
    orgId: string,
    instanceId: string,
    input: {
      enabled?: boolean
      url?: string
      toolName?: string
    },
  ) {
    const instance = await this.getInstanceOrThrow(orgId, instanceId)

    const currentGateway = this.buildGatewayConfig(instance.gatewayConfig)
    const nextGateway = this.buildGatewayConfig({
      enabled: input.enabled ?? currentGateway.enabled,
      url: input.url ?? currentGateway.url,
      toolName: input.toolName ?? currentGateway.toolName,
      lastPushAt: currentGateway.lastPushAt,
      lastPushStatus: currentGateway.lastPushStatus,
      lastPushMessage: currentGateway.lastPushMessage,
    })

    if (nextGateway.enabled && !nextGateway.url) {
      throw new BadRequestException('gateway url is required when gateway is enabled')
    }

    const nextInstance = {
      ...instance,
      gatewayConfig: nextGateway,
    } as ClawHostInstance

    if (this.isControlPlaneEnabled()) {
      await this.writeControlPlaneInstance(nextInstance)
    }
    else {
      const mutableInstance = await this.clawHostInstanceModel.findOne({
        instanceId,
        orgId: orgId.trim(),
      }).exec()
      if (!mutableInstance) {
        throw new NotFoundException('ClawHost instance not found')
      }
      mutableInstance.set('gatewayConfig', nextGateway)
      await mutableInstance.save()
    }

    const updatedAt = new Date().toISOString()
    if (instance.orgId && instance.lastAgentId) {
      this.clawHostGatewayPushService.queueConfigUpdate(instance.orgId, instance.lastAgentId, {
        key: 'gatewayConfig',
        value: {
          enabled: nextGateway.enabled,
          url: nextGateway.url,
          toolName: nextGateway.toolName,
        },
        updatedAt,
      })
    }

    if (nextGateway.enabled && nextGateway.url) {
      await this.clawHostGatewayPushService.pushRealtimeEvent(instance.orgId, {
        event: 'config.update',
        capability: 'heartbeat',
        input: {
          instanceId: instance.instanceId,
          updates: [{
            key: 'gatewayConfig',
            value: {
              enabled: nextGateway.enabled,
              url: nextGateway.url,
              toolName: nextGateway.toolName,
            },
            updatedAt,
          }],
        },
      })
    }

    return this.toResponse(nextInstance)
  }

  async configureSharedExperience(
    orgId: string,
    instanceId: string,
    input: {
      enabled?: boolean
      displayName?: string
      welcomeMessage?: string
      supportContact?: string
      defaultChannel?: string
      channels?: Array<{
        channel: string
        groupName?: string
        inviteUrl?: string
        chatId?: string
        entryKeyword?: string
      }>
    },
  ) {
    const instance = await this.getInstanceOrThrow(orgId, instanceId)

    const currentConfig = this.buildSharedExperienceConfig(instance.sharedExperienceConfig)
    const nextConfig = this.buildSharedExperienceConfig({
      enabled: input.enabled ?? currentConfig.enabled,
      displayName: input.displayName ?? currentConfig.displayName,
      welcomeMessage: input.welcomeMessage ?? currentConfig.welcomeMessage,
      supportContact: input.supportContact ?? currentConfig.supportContact,
      defaultChannel: input.defaultChannel ?? currentConfig.defaultChannel,
      channels: input.channels ?? currentConfig.channels,
      lastActivatedAt: currentConfig.lastActivatedAt,
    })

    if (nextConfig.enabled && nextConfig.channels.length === 0) {
      throw new BadRequestException('shared experience requires at least one channel')
    }

    if (
      nextConfig.enabled
      && nextConfig.defaultChannel
      && !nextConfig.channels.some(channel => channel.channel === nextConfig.defaultChannel)
    ) {
      throw new BadRequestException('defaultChannel must match one of the configured shared channels')
    }

    const nextInstance = {
      ...instance,
      sharedExperienceConfig: nextConfig,
    } as ClawHostInstance

    if (this.isControlPlaneEnabled()) {
      await this.writeControlPlaneInstance(nextInstance)
    }
    else {
      const mutableInstance = await this.clawHostInstanceModel.findOne({
        instanceId,
        orgId: orgId.trim(),
      }).exec()
      if (!mutableInstance) {
        throw new NotFoundException('ClawHost instance not found')
      }
      mutableInstance.set('sharedExperienceConfig', nextConfig)
      await mutableInstance.save()
    }

    return this.toResponse(nextInstance)
  }

  async upgradeSkill(orgId: string, instanceId: string, version: string) {
    const normalizedVersion = version?.trim() || DEFAULT_OPENCLAW_SKILL_VERSION
    const instance = await this.getInstanceOrThrow(orgId, instanceId)
    this.assertLifecycleTransition(instance.status, ClawHostInstanceStatus.UPGRADING, 'upgrade')

    if (this.isManagedInstance(instance)) {
      await this.clawHostRuntimeService.upgradeSkill(
        this.buildManagedRuntimeTarget(instance),
        normalizedVersion,
      )
    }

    const upgradedAt = new Date()
    const nextSkills = this.upsertSkill(
      instance.skills || [],
      DEFAULT_OPENCLAW_SKILL_ID,
      normalizedVersion,
      upgradedAt,
    )
    const nextInstance = {
      ...instance,
      skills: nextSkills,
      instanceLayer: this.buildInstanceLayer(instance.instanceLayer, instance.orgId, nextSkills),
      status: ClawHostInstanceStatus.RUNNING,
      healthStatus: this.buildHealthyStatus(upgradedAt, 1),
      lastHealthMessage: '',
    } as ClawHostInstance

    if (this.isControlPlaneEnabled()) {
      await this.writeControlPlaneInstance(nextInstance)
    }
    else {
      const mutableInstance = await this.clawHostInstanceModel.findOne({
        instanceId,
        orgId: orgId.trim(),
      }).exec()
      if (!mutableInstance) {
        throw new NotFoundException('ClawHost instance not found')
      }
      mutableInstance.set('skills', nextSkills)
      mutableInstance.set(
        'instanceLayer',
        this.buildInstanceLayer(instance.instanceLayer, instance.orgId, nextSkills),
      )
      mutableInstance.set('status', ClawHostInstanceStatus.RUNNING)
      mutableInstance.set('healthStatus', this.buildHealthyStatus(upgradedAt, 1))
      mutableInstance.set('lastHealthMessage', '')
      await mutableInstance.save()
      await this.syncPostgresMetadata(mutableInstance.toObject() as ClawHostInstance)
    }

    return {
      instanceId: instance.instanceId,
      skillId: DEFAULT_OPENCLAW_SKILL_ID,
      version: normalizedVersion,
      upgradedAt: upgradedAt.toISOString(),
    }
  }

  async installSkill(orgId: string, instanceId: string, skillId: string, version: string) {
    if (!skillId?.trim() || !version?.trim()) {
      throw new BadRequestException('skillId and version are required')
    }

    const instance = await this.getInstanceOrThrow(orgId, instanceId)

    const installedAt = new Date()
    const nextSkills = this.upsertSkill(instance.skills || [], skillId, version, installedAt)
    const nextInstance = {
      ...instance,
      skills: nextSkills,
      instanceLayer: this.buildInstanceLayer(
        instance.instanceLayer,
        instance.orgId,
        nextSkills,
        {
          skillComposition: {
            installedSkillIds: this.appendSkillToComposition(
              instance.instanceLayer?.skillComposition?.installedSkillIds,
              skillId,
              nextSkills,
            ),
            primarySkillId: instance.instanceLayer?.skillComposition?.primarySkillId || skillId,
          },
        },
      ),
    } as ClawHostInstance

    if (this.isControlPlaneEnabled()) {
      await this.writeControlPlaneInstance(nextInstance)
    }
    else {
      const mutableInstance = await this.clawHostInstanceModel.findOne({
        instanceId,
        orgId: orgId.trim(),
      }).exec()
      if (!mutableInstance) {
        throw new NotFoundException('ClawHost instance not found')
      }
      mutableInstance.set('skills', nextSkills)
      mutableInstance.set('instanceLayer', nextInstance.instanceLayer)
      await mutableInstance.save()
      await this.syncPostgresMetadata(mutableInstance.toObject() as ClawHostInstance)
    }

    return {
      instanceId: instance.instanceId,
      skill: nextSkills.find(item => item.skillId === skillId) || null,
      installedSkills: nextSkills.length,
    }
  }

  async uninstallSkill(orgId: string, instanceId: string, skillId: string) {
    if (!skillId?.trim()) {
      throw new BadRequestException('skillId is required')
    }

    const instance = await this.getInstanceOrThrow(orgId, instanceId)

    const nextSkills = (instance.skills || []).filter(item => item.skillId !== skillId.trim())
    if (nextSkills.length === (instance.skills || []).length) {
      throw new NotFoundException('ClawHost skill not found')
    }

    const nextInstance = {
      ...instance,
      skills: nextSkills,
      instanceLayer: this.buildInstanceLayer(
        instance.instanceLayer,
        instance.orgId,
        nextSkills,
        {
          skillComposition: {
            installedSkillIds: this.removeSkillFromComposition(
              instance.instanceLayer?.skillComposition?.installedSkillIds,
              skillId.trim(),
              nextSkills,
            ),
            primarySkillId: instance.instanceLayer?.skillComposition?.primarySkillId,
          },
        },
      ),
    } as ClawHostInstance

    if (this.isControlPlaneEnabled()) {
      await this.writeControlPlaneInstance(nextInstance)
    }
    else {
      const mutableInstance = await this.clawHostInstanceModel.findOne({
        instanceId,
        orgId: orgId.trim(),
      }).exec()
      if (!mutableInstance) {
        throw new NotFoundException('ClawHost instance not found')
      }
      mutableInstance.set('skills', nextSkills)
      mutableInstance.set('instanceLayer', nextInstance.instanceLayer)
      await mutableInstance.save()
      await this.syncPostgresMetadata(mutableInstance.toObject() as ClawHostInstance)
    }

    return {
      instanceId: instance.instanceId,
      removedSkillId: skillId.trim(),
      installedSkills: nextSkills.length,
    }
  }

  async batchUpgradeSkill(orgId: string, skillId: string, version: string) {
    if (!skillId?.trim() || !version?.trim()) {
      throw new BadRequestException('skillId and version are required')
    }

    const instances = this.isControlPlaneEnabled()
      ? (await this.clawHostPostgresService.listInstances({
          orgId: orgId.trim(),
          status: ClawHostInstanceStatus.RUNNING,
          limit: 100,
          offset: 0,
        })).items.map(item => this.hydratePostgresRecord(item)).filter((item): item is ClawHostInstance => Boolean(item)).filter(item => (item.skills || []).some(skill => skill.skillId === skillId))
      : await this.clawHostInstanceModel.find({
          'orgId': orgId.trim(),
          'status': ClawHostInstanceStatus.RUNNING,
          'skills.skillId': skillId,
        }).exec()

    const upgradedAt = new Date()
    const upgradedItems = [] as Array<{
      instanceId: string
      status: ClawHostInstanceStatus
      skillId: string
      version: string
    }>

    for (const instance of instances) {
      this.assertLifecycleTransition(instance.status, ClawHostInstanceStatus.UPGRADING, 'batch-upgrade')
      if (this.isControlPlaneEnabled()) {
        await this.writeControlPlaneInstance({
          ...instance,
          status: ClawHostInstanceStatus.UPGRADING,
        } as ClawHostInstance)
      }
      else {
        const mutableInstance = instance as any
        mutableInstance.set('status', ClawHostInstanceStatus.UPGRADING)
        await mutableInstance.save()
      }

      if (this.isManagedInstance(instance) && skillId === DEFAULT_OPENCLAW_SKILL_ID) {
        await this.clawHostRuntimeService.upgradeSkill(
          this.buildManagedRuntimeTarget(instance),
          version,
        )
      }

      const nextSkills = this.upsertSkill(instance.skills || [], skillId, version, upgradedAt)
      const nextInstance = {
        ...instance,
        skills: nextSkills,
        instanceLayer: this.buildInstanceLayer(instance.instanceLayer, instance.orgId, nextSkills),
        status: ClawHostInstanceStatus.RUNNING,
        healthStatus: this.buildHealthyStatus(upgradedAt, 50),
        lastHealthMessage: '',
      } as ClawHostInstance

      if (this.isControlPlaneEnabled()) {
        await this.writeControlPlaneInstance(nextInstance)
      }
      else {
        const mutableInstance = instance as any
        mutableInstance.set('skills', nextSkills)
        mutableInstance.set(
          'instanceLayer',
          this.buildInstanceLayer(instance.instanceLayer, instance.orgId, nextSkills),
        )
        mutableInstance.set('status', ClawHostInstanceStatus.RUNNING)
        mutableInstance.set('healthStatus', this.buildHealthyStatus(upgradedAt, 50))
        mutableInstance.set('lastHealthMessage', '')
        await mutableInstance.save()
        await this.syncPostgresMetadata(mutableInstance.toObject() as ClawHostInstance)
      }

      upgradedItems.push({
        instanceId: nextInstance.instanceId,
        status: nextInstance.status,
        skillId,
        version,
      })
    }

    return {
      skillId,
      version,
      upgradedCount: upgradedItems.length,
      instances: upgradedItems,
    }
  }

  async listInstances(filters: ListInstancesFilters, pagination: PaginationInput) {
    const page = this.normalizePage(pagination.page)
    const limit = this.normalizeLimit(pagination.limit)
    const skip = (page - 1) * limit
    const query = this.buildQuery(filters)
    const [items, total] = this.isControlPlaneEnabled()
      ? await (async () => {
          const result = await this.clawHostPostgresService.listInstances({
            orgId: filters.orgId,
            status: filters.status,
            offset: skip,
            limit,
          })
          return [
            result.items
              .map(item => this.hydratePostgresRecord(item))
              .filter((item): item is ClawHostInstance => Boolean(item)),
            result.total,
          ] as const
        })()
      : await Promise.all([
          this.clawHostInstanceModel
            .find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean()
            .exec(),
          this.clawHostInstanceModel.countDocuments(query).exec(),
        ])

    return {
      items: items.map((item) => {
        const derived = this.isManagedInstance(item)
          ? this.deriveManagedRuntimeStateFromSnapshot(item)
          : this.deriveRuntimeState(item)
        return this.toResponse({
          ...item,
          status: derived.status,
          healthStatus: derived.healthStatus,
          lastHealthMessage: derived.healthMessage || item.lastHealthMessage || '',
        })
      }),
      pagination: {
        page,
        limit,
        total,
        totalPages: total > 0 ? Math.ceil(total / limit) : 0,
      },
    }
  }

  @Cron('*/5 * * * *')
  async runHealthCheck() {
    const statuses = [
      ClawHostInstanceStatus.CREATING,
      ClawHostInstanceStatus.PENDING_MANUAL_SETUP,
      ClawHostInstanceStatus.RUNNING,
      ClawHostInstanceStatus.ERROR,
    ]
    const instances = this.isControlPlaneEnabled()
      ? (await this.clawHostPostgresService.listInstances({
          statuses,
          limit: 500,
          offset: 0,
        })).items.map(item => this.hydratePostgresRecord(item)).filter((item): item is ClawHostInstance => Boolean(item))
      : await this.clawHostInstanceModel.find({
          status: {
            $in: statuses,
          },
        }).lean().exec()

    const results = [] as Array<{
      instanceId: string
      status: ClawHostInstanceStatus
      healthStatus: ClawHostHealthStatus
      scaling?: Awaited<ReturnType<ClawHostService['evaluateManagedAutoscaling']>> | null
    }>

    for (const instance of instances) {
      const derived = this.isManagedInstance(instance)
        ? await this.deriveManagedRuntimeState(instance)
        : this.deriveRuntimeState(instance)
      const scaling = this.isManagedInstance(instance) && derived.status === ClawHostInstanceStatus.RUNNING
        ? await this.evaluateManagedAutoscaling(instance)
        : null
      if (derived.shouldPersist) {
        const nextInstance = {
          ...instance,
          status: derived.status,
          healthStatus: derived.healthStatus,
          lastHealthMessage: derived.healthMessage || '',
        } as ClawHostInstance
        if (this.isControlPlaneEnabled()) {
          await this.writeControlPlaneInstance(nextInstance)
        }
        else {
          await this.clawHostInstanceModel.updateOne(
            { _id: instance._id },
            {
              $set: {
                status: derived.status,
                healthStatus: derived.healthStatus,
                lastHealthMessage: derived.healthMessage || '',
              },
            },
          ).exec()
          await this.syncPostgresMetadata(nextInstance)
        }
      }

      if (!derived.healthStatus.isHealthy) {
        await this.emitUnhealthyAlert(instance, derived.healthMessage || 'instance_unhealthy')
      }
      else {
        await this.clearUnhealthyAlert(instance.instanceId)
      }

      results.push({
        instanceId: instance.instanceId,
        status: derived.status,
        healthStatus: derived.healthStatus,
        scaling,
      })
    }

    return {
      checkedAt: new Date(),
      checkedCount: results.length,
      unhealthyCount: results.filter(item => !item.healthStatus.isHealthy).length,
      items: results,
    }
  }

  @Cron('7 */1 * * *')
  async repairControlPlaneCache() {
    if (!this.isControlPlaneEnabled()) {
      return {
        enabled: false,
        repaired: 0,
        removed: 0,
      }
    }

    const controlPlane = await this.clawHostPostgresService.listInstances({
      limit: 1000,
      offset: 0,
    })
    const controlPlaneMap = new Map(
      controlPlane.items.map(item => [item.instanceId, item]),
    )
    const cacheItems = await this.clawHostInstanceModel.find({})
      .select({
        instanceId: 1,
        orgId: 1,
        status: 1,
        config: 1,
        runtimeKind: 1,
        hostPort: 1,
        updatedAt: 1,
      })
      .lean()
      .exec() as Array<Record<string, unknown>>

    let repaired = 0
    for (const item of controlPlane.items) {
      const cache = cacheItems.find(cacheItem => String(cacheItem['instanceId'] || '') === item.instanceId)
      const mismatched = !cache
        || String(cache['orgId'] || '') !== item.orgId
        || String(cache['status'] || '') !== item.status
        || String(cache['runtimeKind'] || '') !== (item.runtimeKind || ClawHostRuntimeKind.DOCKER)
        || Number(cache['hostPort'] || 0) !== Number(item.hostPort || 0)

      if (!mismatched) {
        continue
      }

      const hydrated = this.hydratePostgresRecord(item)
      if (!hydrated) {
        continue
      }

      await this.syncMongoCache(hydrated)
      repaired += 1
    }

    const orphanIds = cacheItems
      .map(item => String(item['instanceId'] || ''))
      .filter(Boolean)
      .filter(instanceId => !controlPlaneMap.has(instanceId))

    for (const orphanId of orphanIds) {
      await this.clawHostInstanceModel.deleteOne({ instanceId: orphanId }).exec()
    }

    return {
      enabled: true,
      repaired,
      removed: orphanIds.length,
    }
  }

  async getInstanceLogs(orgId: string, instanceId: string, lines = 100) {
    const instance = await this.getInstanceOrThrow(orgId, instanceId)
    const normalizedLines = Math.min(Math.max(lines, 1), 500)
    const runtimeLogs = this.isManagedInstance(instance)
      ? await this.clawHostRuntimeService.getContainerLogs(
          this.buildManagedRuntimeTarget(instance),
          normalizedLines,
        ).catch(() => [])
      : []

    return {
      instanceId: instance.instanceId,
      lines: normalizedLines,
      logs: [
        ...runtimeLogs,
        ...this.buildLifecycleLogs(instance),
      ].slice(0, normalizedLines),
    }
  }

  private async getInstanceOrThrow(orgId: string, instanceId: string) {
    if (this.isControlPlaneEnabled()) {
      const record = await this.clawHostPostgresService.getInstance(orgId.trim(), instanceId.trim())
      const instance = this.hydratePostgresRecord(record)
      if (instance) {
        return instance
      }
    }

    const instance = await this.clawHostInstanceModel.findOne({
      instanceId,
      orgId: orgId.trim(),
    }).lean().exec()
    if (!instance) {
      throw new NotFoundException('ClawHost instance not found')
    }

    return instance
  }

  private hydratePostgresRecord(record: ClawHostPostgresInstanceRecord | null) {
    if (!record) {
      return null
    }

    return {
      _id: new Types.ObjectId(),
      instanceId: record.instanceId,
      orgId: record.orgId,
      clientName: record.clientName,
      plan: record.plan || 'starter',
      status: record.status as ClawHostInstanceStatus,
      deploymentMode: (record.deploymentMode || ClawHostDeploymentMode.BYOC) as ClawHostDeploymentMode,
      runtimeKind: (record.runtimeKind || ClawHostRuntimeKind.DOCKER) as ClawHostRuntimeKind,
      config: {
        cpu: String(record.config?.cpu || ''),
        memory: String(record.config?.memory || ''),
        storage: String(record.config?.storage || ''),
      },
      skills: Array.isArray(record.skills)
        ? record.skills.map(skill => ({
            skillId: String(skill['skillId'] || ''),
            version: String(skill['version'] || ''),
            installedAt: skill['installedAt']
              ? new Date(String(skill['installedAt']))
              : record.createdAt || new Date(),
          }))
        : [],
      healthStatus: {
        lastCheck: record.healthStatus?.lastCheck
          ? new Date(String(record.healthStatus.lastCheck))
          : null,
        isHealthy: Boolean(record.healthStatus?.isHealthy),
        latency: Number(record.healthStatus?.latency || 0),
      },
      gatewayConfig: record.gatewayConfig || {},
      sharedExperienceConfig: record.sharedExperienceConfig || {},
      instanceLayer: record.instanceLayer || {},
      requestedImChannel: record.requestedImChannel || '',
      accessUrl: record.accessUrl || '',
      installCommand: record.installCommand || this.buildInstallCommand(),
      healthUrl: record.healthUrl || '',
      k8sNamespace: record.k8sNamespace || '',
      k8sPodName: record.k8sPodName || '',
      hostPort: record.hostPort || 0,
      runtimeImage: record.runtimeImage || '',
      containerId: record.containerId || '',
      containerName: record.containerName || '',
      lastHealthMessage: record.lastHealthMessage || '',
      connectionCodePreview: record.connectionCodePreview || '',
      connectionCodeHash: record.connectionCodeHash || '',
      connectionCodeIssuedAt: record.connectionCodeIssuedAt || null,
      connectionCodeExpiresAt: record.connectionCodeExpiresAt || null,
      boundApiKeyId: record.boundApiKeyId || '',
      boundApiKeyPrefix: record.boundApiKeyPrefix || '',
      boundAt: record.boundAt || null,
      lastHeartbeatAt: record.lastHeartbeatAt || null,
      lastClientVersion: record.lastClientVersion || '',
      lastAgentId: record.lastAgentId || '',
      heartbeatCapabilities: record.heartbeatCapabilities || [],
      createdAt: record.createdAt || new Date(),
      updatedAt: record.updatedAt || new Date(),
    } as unknown as ClawHostInstance
  }

  private async writeControlPlaneInstance(
    instance: ClawHostInstance,
    options: {
      ownerUserId?: string
      apiToken?: string
      deviceId?: string
      deviceApproved?: boolean
    } = {},
  ) {
    if (!this.isControlPlaneEnabled()) {
      return instance
    }

    const record = await this.clawHostPostgresService.upsertInstance({
      instanceId: instance.instanceId,
      orgId: instance.orgId,
      clientName: instance.clientName,
      plan: instance.plan,
      status: instance.status,
      deploymentMode: instance.deploymentMode,
      runtimeKind: instance.runtimeKind,
      config: instance.config,
      skills: instance.skills,
      healthStatus: instance.healthStatus,
      instanceLayer: instance.instanceLayer as unknown as Record<string, unknown>,
      requestedImChannel: instance.requestedImChannel,
      accessUrl: instance.accessUrl,
      healthUrl: instance.healthUrl,
      k8sNamespace: instance.k8sNamespace,
      k8sPodName: instance.k8sPodName,
      hostPort: instance.hostPort,
      runtimeImage: instance.runtimeImage,
      containerId: instance.containerId,
      containerName: instance.containerName,
      gatewayConfig: this.buildGatewayConfig(instance.gatewayConfig),
      sharedExperienceConfig: this.buildSharedExperienceConfig(instance.sharedExperienceConfig),
      installCommand: instance.installCommand,
      lastHealthMessage: instance.lastHealthMessage,
      connectionCodeHash: instance.connectionCodeHash,
      connectionCodePreview: instance.connectionCodePreview,
      connectionCodeIssuedAt: instance.connectionCodeIssuedAt,
      connectionCodeExpiresAt: instance.connectionCodeExpiresAt,
      boundApiKeyId: instance.boundApiKeyId,
      boundApiKeyPrefix: instance.boundApiKeyPrefix,
      boundAt: instance.boundAt,
      lastHeartbeatAt: instance.lastHeartbeatAt,
      lastClientVersion: instance.lastClientVersion,
      lastAgentId: instance.lastAgentId,
      heartbeatCapabilities: instance.heartbeatCapabilities,
      createdAt: instance.createdAt,
      updatedAt: instance.updatedAt,
    }, options)
    const hydrated = this.hydratePostgresRecord(record)
    if (!hydrated) {
      throw new BadRequestException('ClawHost PostgreSQL control plane is not available')
    }

    try {
      await this.syncMongoCache(hydrated)
    }
    catch (error) {
      this.logger.warn({
        message: 'ClawHost Mongo cache sync failed',
        instanceId: hydrated.instanceId,
        orgId: hydrated.orgId,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    return hydrated
  }

  private async syncMongoCache(instance: ClawHostInstance) {
    await this.clawHostInstanceModel.updateOne(
      { instanceId: instance.instanceId },
      {
        $set: {
          orgId: instance.orgId,
          clientName: instance.clientName,
          plan: instance.plan,
          status: instance.status,
          deploymentMode: instance.deploymentMode,
          config: instance.config,
          skills: instance.skills,
          healthStatus: instance.healthStatus,
          gatewayConfig: this.buildGatewayConfig(instance.gatewayConfig),
          sharedExperienceConfig: this.buildSharedExperienceConfig(instance.sharedExperienceConfig),
          instanceLayer: instance.instanceLayer,
          k8sNamespace: instance.k8sNamespace,
          k8sPodName: instance.k8sPodName,
          runtimeKind: instance.runtimeKind,
          containerId: instance.containerId,
          containerName: instance.containerName,
          runtimeImage: instance.runtimeImage,
          hostPort: instance.hostPort,
          healthUrl: instance.healthUrl,
          lastHealthMessage: instance.lastHealthMessage,
          requestedImChannel: instance.requestedImChannel,
          accessUrl: instance.accessUrl,
          installCommand: instance.installCommand,
          connectionCodePreview: instance.connectionCodePreview,
          connectionCodeHash: instance.connectionCodeHash,
          connectionCodeIssuedAt: instance.connectionCodeIssuedAt,
          connectionCodeExpiresAt: instance.connectionCodeExpiresAt,
          boundApiKeyId: instance.boundApiKeyId,
          boundApiKeyPrefix: instance.boundApiKeyPrefix,
          boundAt: instance.boundAt,
          lastHeartbeatAt: instance.lastHeartbeatAt,
          lastClientVersion: instance.lastClientVersion,
          lastAgentId: instance.lastAgentId,
          heartbeatCapabilities: instance.heartbeatCapabilities,
          createdAt: instance.createdAt,
          updatedAt: instance.updatedAt,
        },
      },
      { upsert: true },
    ).exec()
    await this.clawHostPostgresService.markCacheSynced(instance.instanceId)
  }

  private async getOrganizationOrNull(orgId: string) {
    if (!Types.ObjectId.isValid(orgId)) {
      return null
    }

    return this.organizationModel.findById(new Types.ObjectId(orgId)).lean().exec()
  }

  private buildPlatformLayerSnapshot(
    source?: Partial<Organization['platformLayer']> | null,
  ) {
    return {
      quotaPolicy: normalizeLayerQuotaPolicy(source?.quotaPolicy),
      billingPolicy: normalizeLayerBillingPolicy(source?.billingPolicy, LayerBillingModel.QUOTA),
      permissionPolicy: normalizeLayerPermissionPolicy(source?.permissionPolicy),
      strategy: {
        enableCrossInstanceStats: source?.strategy?.enableCrossInstanceStats ?? true,
        enableOpsConsole: source?.strategy?.enableOpsConsole ?? true,
        allowSkillMarketplace: source?.strategy?.allowSkillMarketplace ?? true,
        rolloutChannel: typeof source?.strategy?.rolloutChannel === 'string'
          ? source.strategy.rolloutChannel.trim() || 'stable'
          : 'stable',
      },
    }
  }

  private buildResourceIsolationSnapshot(
    instance: Pick<
      ClawHostInstance,
      'deploymentMode' | 'runtimeKind' | 'k8sNamespace' | 'k8sPodName' | 'containerName' | 'hostPort'
    >,
    isolation: ClawHostInstanceResourceIsolation,
  ) {
    return {
      ...isolation,
      deploymentMode: instance.deploymentMode || ClawHostDeploymentMode.BYOC,
      runtimeKind: instance.runtimeKind || ClawHostRuntimeKind.DOCKER,
      namespace: instance.k8sNamespace || '',
      podName: instance.k8sPodName || '',
      containerName: instance.containerName || '',
      hostPort: instance.hostPort || 0,
    }
  }

  private buildQuery(filters: ListInstancesFilters) {
    const query: Record<string, unknown> = {}

    if (filters.orgId?.trim()) {
      query['orgId'] = filters.orgId.trim()
    }

    if (filters.status) {
      query['status'] = filters.status
    }

    return query
  }

  private validateConfig(config: ClawHostInstanceConfig) {
    if (!config?.cpu?.trim() || !config?.memory?.trim() || !config?.storage?.trim()) {
      throw new BadRequestException('cpu, memory and storage are required')
    }
  }

  private buildInstanceId(orgId: string, clientName: string) {
    const orgToken = this.slugify(orgId).slice(-8)
    const clientToken = this.slugify(clientName).slice(0, 12)
    const timestamp = Date.now().toString(36)
    return `chi-${orgToken}-${clientToken}-${timestamp}`
  }

  private buildNamespace(orgId: string) {
    const suffix = this.slugify(orgId).slice(-20) || 'default'
    return `clawhost-${suffix}`
  }

  private buildPodName(instanceId: string) {
    return `pod-${instanceId.slice(-24)}`
  }

  private slugify(value: string) {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  }

  private defaultConfig(): ClawHostInstanceConfig {
    return { ...CLAWHOST_PLAN_PRESETS['starter'] }
  }

  private normalizePlan(plan?: string) {
    const normalized = plan?.trim().toLowerCase()
    if (!normalized) {
      return 'starter'
    }

    if (!CLAWHOST_PLAN_PRESETS[normalized]) {
      throw new BadRequestException(`Unsupported ClawHost plan: ${normalized}`)
    }

    return normalized
  }

  private resolveConfig(plan: string, config?: ClawHostInstanceConfig) {
    if (config) {
      this.validateConfig(config)
      return {
        cpu: config.cpu.trim(),
        memory: config.memory.trim(),
        storage: config.storage.trim(),
      }
    }

    return {
      ...(CLAWHOST_PLAN_PRESETS[plan] || this.defaultConfig()),
    }
  }

  private buildDefaultInstalledSkills(installedAt: Date) {
    return [{
      skillId: DEFAULT_OPENCLAW_SKILL_ID,
      version: DEFAULT_OPENCLAW_SKILL_VERSION,
      installedAt,
    }]
  }

  private isControlPlaneEnabled() {
    return this.clawHostPostgresService.isEnabled()
  }

  private buildInstanceSnapshot(input: {
    instanceId: string
    orgId: string
    clientName: string
    plan: string
    deploymentMode: ClawHostDeploymentMode
    config: ClawHostInstanceConfig
    skills: ClawHostInstalledSkill[]
    healthStatus: ClawHostHealthStatus
    requestedImChannel?: string
    accessUrl?: string
    status: ClawHostInstanceStatus
    runtime?: {
      runtimeKind?: ClawHostRuntimeKind
      containerId?: string
      containerName?: string
      image?: string
      hostPort?: number
      healthUrl?: string
      accessUrl?: string
      namespace?: string
      podName?: string
    } | null
  }) {
    const createdAt = new Date()
    const runtimeKind = input.runtime?.runtimeKind || this.clawHostRuntimeService.resolveRuntimeKind()
    const accessUrl = input.accessUrl?.trim()
      || input.runtime?.accessUrl?.trim()
      || this.buildAccessUrl(input.instanceId)

    return {
      _id: new Types.ObjectId(),
      instanceId: input.instanceId,
      orgId: input.orgId,
      clientName: input.clientName,
      plan: input.plan,
      status: input.status,
      deploymentMode: input.deploymentMode,
      config: input.config,
      skills: input.skills,
      healthStatus: input.healthStatus,
      gatewayConfig: this.buildGatewayConfig(),
      sharedExperienceConfig: this.buildSharedExperienceConfig(),
      instanceLayer: this.buildDefaultInstanceLayer(input.orgId, input.skills),
      k8sNamespace: input.runtime?.namespace || this.buildNamespace(input.orgId),
      k8sPodName: input.runtime?.podName || '',
      runtimeKind,
      containerId: input.runtime?.containerId || '',
      containerName: input.runtime?.containerName || '',
      runtimeImage: input.runtime?.image || '',
      hostPort: input.runtime?.hostPort || 0,
      healthUrl: input.runtime?.healthUrl || '',
      lastHealthMessage: '',
      requestedImChannel: input.requestedImChannel?.trim() || '',
      accessUrl,
      installCommand: this.buildInstallCommand(),
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
      createdAt,
      updatedAt: createdAt,
    } as unknown as ClawHostInstance
  }

  private buildDefaultInstanceLayer(
    orgId: string,
    skills: ClawHostInstalledSkill[],
  ) {
    return this.buildInstanceLayer(
      undefined,
      orgId,
      skills,
      {
        configInheritance: {
          inheritedFromOrgId: orgId,
        },
        skillComposition: {
          primarySkillId: DEFAULT_OPENCLAW_SKILL_ID,
          installedSkillIds: skills.map(skill => skill.skillId),
        },
      },
    )
  }

  private buildInstanceLayer(
    current: Partial<ClawHostInstanceLayer> | null | undefined,
    orgId: string,
    skills: ClawHostInstalledSkill[],
    overrides?: InstanceLayerInput | null,
  ): ClawHostInstanceLayer {
    const actualInstalledSkillIds = this.collectInstalledSkillIds(skills)
    const nextConfiguredSkillIds = Array.isArray(overrides?.skillComposition?.installedSkillIds)
      ? this.restrictSkillIds(overrides.skillComposition.installedSkillIds, actualInstalledSkillIds)
      : Array.isArray(current?.skillComposition?.installedSkillIds)
        ? this.restrictSkillIds(current.skillComposition.installedSkillIds, actualInstalledSkillIds)
        : actualInstalledSkillIds

    return {
      resourceIsolation: this.buildResourceIsolation(
        current?.resourceIsolation,
        overrides?.resourceIsolation,
      ),
      quotaPolicy: normalizeLayerQuotaPolicy({
        ...(current?.quotaPolicy || {}),
        ...(overrides?.quotaPolicy || {}),
      }),
      billingPolicy: normalizeLayerBillingPolicy({
        ...(current?.billingPolicy || {}),
        ...(overrides?.billingPolicy || {}),
      }, LayerBillingModel.QUOTA),
      permissionPolicy: normalizeLayerPermissionPolicy({
        ...(current?.permissionPolicy || {}),
        ...(overrides?.permissionPolicy || {}),
      }),
      configInheritance: this.buildConfigInheritance(
        current?.configInheritance,
        overrides?.configInheritance,
        orgId,
      ),
      skillComposition: this.buildSkillComposition(
        current?.skillComposition,
        overrides?.skillComposition,
        nextConfiguredSkillIds.length > 0 ? nextConfiguredSkillIds : actualInstalledSkillIds,
      ),
    }
  }

  private buildResourceIsolation(
    current?: Partial<ClawHostInstanceResourceIsolation> | null,
    overrides?: Partial<ClawHostInstanceResourceIsolation> | null,
  ): ClawHostInstanceResourceIsolation {
    return {
      isolationLevel: typeof overrides?.isolationLevel === 'string'
        ? overrides.isolationLevel.trim() || 'namespace'
        : typeof current?.isolationLevel === 'string'
          ? current.isolationLevel.trim() || 'namespace'
          : 'namespace',
      dedicatedRuntime: overrides?.dedicatedRuntime ?? current?.dedicatedRuntime ?? true,
      dedicatedStorage: overrides?.dedicatedStorage ?? current?.dedicatedStorage ?? true,
      dedicatedNetwork: overrides?.dedicatedNetwork ?? current?.dedicatedNetwork ?? true,
    }
  }

  private buildConfigInheritance(
    current: Partial<ClawHostConfigInheritance> | null | undefined,
    overrides: Partial<ClawHostConfigInheritance> | null | undefined,
    orgId: string,
  ): ClawHostConfigInheritance {
    const inheritedFromOrgId = typeof overrides?.inheritedFromOrgId === 'string'
      ? overrides.inheritedFromOrgId.trim() || orgId
      : typeof current?.inheritedFromOrgId === 'string'
        ? current.inheritedFromOrgId.trim() || orgId
        : orgId

    return {
      inheritQuotaPolicy: overrides?.inheritQuotaPolicy ?? current?.inheritQuotaPolicy ?? true,
      inheritBillingPolicy: overrides?.inheritBillingPolicy ?? current?.inheritBillingPolicy ?? true,
      inheritPermissionPolicy:
        overrides?.inheritPermissionPolicy ?? current?.inheritPermissionPolicy ?? true,
      inheritSkillDefaults:
        overrides?.inheritSkillDefaults ?? current?.inheritSkillDefaults ?? true,
      inheritedFromOrgId,
      inheritedAt: overrides ? current?.inheritedAt || new Date() : current?.inheritedAt || null,
    }
  }

  private buildSkillComposition(
    current: Partial<ClawHostSkillComposition> | null | undefined,
    overrides: Partial<ClawHostSkillComposition> | null | undefined,
    installedSkillIds: string[],
  ): ClawHostSkillComposition {
    const normalizedBundleIds = Array.isArray(overrides?.bundleIds)
      ? normalizeStringList(overrides.bundleIds)
      : Array.isArray(current?.bundleIds)
        ? normalizeStringList(current.bundleIds)
        : []
    const configuredPrimary = typeof overrides?.primarySkillId === 'string'
      ? overrides.primarySkillId.trim()
      : typeof current?.primarySkillId === 'string'
        ? current.primarySkillId.trim()
        : ''
    const primarySkillId = installedSkillIds.includes(configuredPrimary)
      ? configuredPrimary
      : installedSkillIds[0] || ''

    return {
      primarySkillId,
      installedSkillIds,
      bundleIds: normalizedBundleIds,
      autoUpgrade: overrides?.autoUpgrade ?? current?.autoUpgrade ?? false,
      versionPolicy: typeof overrides?.versionPolicy === 'string'
        ? overrides.versionPolicy.trim() || 'pinned'
        : typeof current?.versionPolicy === 'string'
          ? current.versionPolicy.trim() || 'pinned'
          : 'pinned',
    }
  }

  private collectInstalledSkillIds(skills: ClawHostInstalledSkill[]) {
    return [...new Set(skills.map(skill => skill.skillId).filter(Boolean))]
  }

  private restrictSkillIds(candidateSkillIds: string[], allowedSkillIds: string[]) {
    const allowed = new Set(allowedSkillIds)
    const normalized = normalizeStringList(candidateSkillIds).filter(skillId => allowed.has(skillId))
    return normalized.length > 0 ? normalized : allowedSkillIds
  }

  private appendSkillToComposition(
    currentSkillIds: string[] | undefined,
    skillId: string,
    nextSkills: ClawHostInstalledSkill[],
  ) {
    return this.restrictSkillIds(
      [...normalizeStringList(currentSkillIds), skillId.trim()],
      this.collectInstalledSkillIds(nextSkills),
    )
  }

  private removeSkillFromComposition(
    currentSkillIds: string[] | undefined,
    skillId: string,
    nextSkills: ClawHostInstalledSkill[],
  ) {
    return this.restrictSkillIds(
      normalizeStringList(currentSkillIds).filter(item => item !== skillId),
      this.collectInstalledSkillIds(nextSkills),
    )
  }

  private validateSkillCompositionInput(
    input: Partial<ClawHostSkillComposition> | null | undefined,
    installedSkillIds: string[],
  ) {
    if (!input) {
      return
    }

    const installed = new Set(installedSkillIds)
    const requestedInstalledSkills = normalizeStringList(input.installedSkillIds)
    if (requestedInstalledSkills.some(skillId => !installed.has(skillId))) {
      throw new BadRequestException('skillComposition.installedSkillIds must reference installed skills')
    }

    const primarySkillId = typeof input.primarySkillId === 'string'
      ? input.primarySkillId.trim()
      : ''
    if (primarySkillId && !installed.has(primarySkillId)) {
      throw new BadRequestException('skillComposition.primarySkillId must reference an installed skill')
    }
  }

  private async provisionManagedRuntime(input: {
    instanceId: string
    orgId: string
    plan: string
    clientName: string
    config: ClawHostInstanceConfig
    namespace: string
    podName: string
  }) {
    const runtimeKind = this.clawHostRuntimeService.resolveRuntimeKind()
    const preferredPort = runtimeKind === ClawHostRuntimeKind.DOCKER
      ? await this.resolvePreferredManagedPort()
      : undefined

    return this.clawHostRuntimeService.createManagedContainer({
      ...input,
      skillVersion: DEFAULT_OPENCLAW_SKILL_VERSION,
      preferredPort,
    })
  }

  private async resolvePreferredManagedPort() {
    const items = this.isControlPlaneEnabled()
      ? (await this.clawHostPostgresService.listManagedDockerHostPorts())
          .map(hostPort => ({ hostPort }))
      : await this.clawHostInstanceModel.find({
        deploymentMode: ClawHostDeploymentMode.MANAGED,
        runtimeKind: ClawHostRuntimeKind.DOCKER,
        hostPort: { $gt: 0 },
      }).select({ hostPort: 1 }).lean().exec() as Array<Record<string, unknown>>

    const usedPorts = new Set(
      items
        .map(item => Number(item['hostPort'] || 0))
        .filter(port => Number.isFinite(port) && port > 0),
    )

    return this.resolveAvailablePort(usedPorts)
  }

  private resolveAvailablePort(usedPorts: Set<number>) {
    let port = 3900
    while (usedPorts.has(port)) {
      port += 1
    }
    return port
  }

  private buildInstallCommand() {
    return 'openclaw skills install mediaclaw-client'
  }

  private buildAccessUrl(instanceId: string) {
    return `https://${instanceId}.mediaclaw.ai`
  }

  private buildConnectionCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    const bytes = randomBytes(12)
    const chunks = [] as string[]

    for (let index = 0; index < 12; index += 4) {
      const chunk = Array.from(bytes.slice(index, index + 4))
        .map(byte => alphabet[byte % alphabet.length])
        .join('')
      chunks.push(chunk)
    }

    return `MC-${chunks.join('-')}`
  }

  private maskConnectionCode(code: string) {
    const parts = code.split('-')
    if (parts.length !== 4) {
      return code
    }

    return `${parts[0]}-****-****-${parts[3]}`
  }

  private buildConnectionCodeCacheKey(code: string) {
    return `mediaclaw:clawhost:connect:${code.trim().toUpperCase()}`
  }

  private hashValue(value: string) {
    return createHash('sha256').update(value).digest('hex')
  }

  private isConnectionCodeCurrent(
    instance: Pick<ClawHostInstance, 'connectionCodeHash' | 'connectionCodeExpiresAt'>,
    code: string,
    expiresAt?: string,
  ) {
    const expectedHash = this.hashValue(code)
    if (instance.connectionCodeHash !== expectedHash) {
      return false
    }

    const persistedExpiresAt = instance.connectionCodeExpiresAt
      ? new Date(instance.connectionCodeExpiresAt)
      : null
    if (!persistedExpiresAt || Number.isNaN(persistedExpiresAt.getTime())) {
      return false
    }

    if (persistedExpiresAt.getTime() <= Date.now()) {
      return false
    }

    if (!expiresAt) {
      return true
    }

    const expectedExpiresAt = new Date(expiresAt)
    if (Number.isNaN(expectedExpiresAt.getTime())) {
      return false
    }

    return persistedExpiresAt.getTime() === expectedExpiresAt.getTime()
  }

  private async handleFailedInstanceConnection(
    code: string,
    payload: ConnectCodePayload,
    apiKeyId?: string,
  ) {
    await this.restoreConnectionCode(code, payload)

    if (!apiKeyId) {
      return
    }

    try {
      await this.apiKeyService.revokeInternal(apiKeyId)
    }
    catch (error) {
      this.logger.warn({
        message: 'Failed to revoke provisional ClawHost API key after connect error',
        apiKeyId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private async restoreConnectionCode(code: string, payload: ConnectCodePayload) {
    const expiresAt = new Date(payload.expiresAt)
    if (Number.isNaN(expiresAt.getTime())) {
      return
    }

    const ttlSeconds = Math.floor((expiresAt.getTime() - Date.now()) / 1000)
    if (ttlSeconds <= 0) {
      return
    }

    try {
      await this.redisService.setJson(
        this.buildConnectionCodeCacheKey(code),
        payload,
        ttlSeconds,
      )
    }
    catch (error) {
      this.logger.warn({
        message: 'Failed to restore ClawHost connection code after connect error',
        instanceId: payload.instanceId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private buildHealthyStatus(now: Date, latency: number): ClawHostHealthStatus {
    return {
      lastCheck: now,
      isHealthy: true,
      latency,
    }
  }

  private buildPendingHealthStatus(now: Date): ClawHostHealthStatus {
    return {
      lastCheck: now,
      isHealthy: false,
      latency: 0,
    }
  }

  private buildGatewayConfig(
    source: Partial<{
      enabled: boolean
      url: string
      toolName: string
      lastPushAt: Date | null
      lastPushStatus: string
      lastPushMessage: string
    }> = {},
  ) {
    return {
      enabled: Boolean(source.enabled),
      url: source.url?.trim() || '',
      toolName: source.toolName?.trim() || 'mediaclaw.sync',
      lastPushAt: source.lastPushAt || null,
      lastPushStatus: source.lastPushStatus?.trim() || '',
      lastPushMessage: source.lastPushMessage?.trim() || '',
    }
  }

  private buildSharedExperienceConfig(
    source: Partial<{
      enabled: boolean
      displayName: string
      welcomeMessage: string
      supportContact: string
      defaultChannel: string
      channels: Array<{
        channel: string
        groupName?: string
        inviteUrl?: string
        chatId?: string
        entryKeyword?: string
      }>
      lastActivatedAt: Date | null
    }> = {},
  ) {
    const channels = Array.isArray(source.channels)
      ? source.channels
          .map(channel => ({
            channel: channel.channel?.trim() || '',
            groupName: channel.groupName?.trim() || '',
            inviteUrl: channel.inviteUrl?.trim() || '',
            chatId: channel.chatId?.trim() || '',
            entryKeyword: channel.entryKeyword?.trim() || '',
          }))
          .filter(channel => channel.channel)
      : []
    const defaultChannel = source.defaultChannel?.trim() || channels[0]?.channel || ''

    return {
      enabled: Boolean(source.enabled),
      displayName: source.displayName?.trim() || '',
      welcomeMessage: source.welcomeMessage?.trim() || '',
      supportContact: source.supportContact?.trim() || '',
      defaultChannel,
      channels,
      lastActivatedAt: source.lastActivatedAt || null,
    }
  }

  private normalizeCapabilities(capabilities?: string[]) {
    if (!Array.isArray(capabilities) || capabilities.length === 0) {
      return []
    }

    return [...new Set(capabilities.map(item => item.trim()).filter(Boolean))]
  }

  private deriveRuntimeState(instance: Pick<
    ClawHostInstance,
    '_id' | 'status' | 'healthStatus' | 'lastHeartbeatAt' | 'boundApiKeyId'
  >) {
    const now = new Date()

    if (instance.status === ClawHostInstanceStatus.STOPPED) {
      return {
        status: ClawHostInstanceStatus.STOPPED,
        healthStatus: {
          lastCheck: now,
          isHealthy: false,
          latency: 0,
        },
        connectionStatus: 'stopped',
        healthMessage: '',
        shouldPersist: !instance.healthStatus?.lastCheck
          || instance.healthStatus.isHealthy
          || instance.healthStatus.latency !== 0,
      }
    }

    if (!instance.boundApiKeyId?.trim()) {
      return {
        status: instance.status === ClawHostInstanceStatus.CREATING
          ? ClawHostInstanceStatus.CREATING
          : ClawHostInstanceStatus.PENDING_MANUAL_SETUP,
        healthStatus: {
          lastCheck: now,
          isHealthy: false,
          latency: 0,
        },
        connectionStatus: 'waiting_for_bind',
        healthMessage: '',
        shouldPersist: !instance.healthStatus?.lastCheck
          || instance.healthStatus.isHealthy
          || instance.healthStatus.latency !== 0,
      }
    }

    if (!instance.lastHeartbeatAt) {
      return {
        status: ClawHostInstanceStatus.ERROR,
        healthStatus: {
          lastCheck: now,
          isHealthy: false,
          latency: HEARTBEAT_FRESH_MS,
        },
        connectionStatus: 'bound_but_silent',
        healthMessage: 'heartbeat_missing',
        shouldPersist: instance.status !== ClawHostInstanceStatus.ERROR
          || instance.healthStatus?.isHealthy !== false,
      }
    }

    const delta = now.getTime() - new Date(instance.lastHeartbeatAt).getTime()
    const isHealthy = delta <= HEARTBEAT_FRESH_MS

    return {
      status: isHealthy
        ? ClawHostInstanceStatus.RUNNING
        : ClawHostInstanceStatus.ERROR,
      healthStatus: {
        lastCheck: now,
        isHealthy,
        latency: Math.max(1, Math.floor(delta / 1000)),
      },
      connectionStatus: isHealthy ? 'connected' : 'stale',
      healthMessage: isHealthy ? '' : 'heartbeat_stale',
      shouldPersist: instance.status !== (isHealthy ? ClawHostInstanceStatus.RUNNING : ClawHostInstanceStatus.ERROR)
        || instance.healthStatus?.isHealthy !== isHealthy,
    }
  }

  private isManagedInstance(instance: Pick<ClawHostInstance, 'deploymentMode' | 'containerId'>) {
    return instance.deploymentMode === ClawHostDeploymentMode.MANAGED && Boolean(instance.containerId?.trim())
  }

  private deriveManagedRuntimeStateFromSnapshot(instance: Pick<
    ClawHostInstance,
    'status' | 'healthStatus' | 'lastHealthMessage'
  >) {
    return {
      status: instance.status,
      healthStatus: instance.healthStatus || this.buildPendingHealthStatus(new Date()),
      connectionStatus: instance.status === ClawHostInstanceStatus.RUNNING ? 'connected' : 'managed',
      healthMessage: instance.lastHealthMessage || '',
      shouldPersist: false,
    }
  }

  private async deriveManagedRuntimeState(instance: Pick<
    ClawHostInstance,
    '_id' | 'instanceId' | 'orgId' | 'config' | 'status' | 'healthStatus' | 'runtimeKind' | 'containerId' | 'containerName' | 'k8sNamespace' | 'k8sPodName' | 'healthUrl' | 'lastHealthMessage'
  >) {
    const now = new Date()
    const inspected = await this.clawHostRuntimeService.inspectManagedContainer(
      this.buildManagedRuntimeTarget(instance),
    )
    const isHealthy = inspected.exists && inspected.running && inspected.apiHealthy

    return {
      status: isHealthy ? ClawHostInstanceStatus.RUNNING : ClawHostInstanceStatus.ERROR,
      healthStatus: {
        lastCheck: now,
        isHealthy,
        latency: inspected.latencyMs,
      },
      connectionStatus: isHealthy
        ? 'connected'
        : inspected.exists
          ? inspected.running
            ? 'api_unhealthy'
            : 'container_stopped'
          : 'container_missing',
      healthMessage: inspected.errorMessage || '',
      shouldPersist:
        instance.status !== (isHealthy ? ClawHostInstanceStatus.RUNNING : ClawHostInstanceStatus.ERROR)
        || instance.healthStatus?.isHealthy !== isHealthy
        || instance.lastHealthMessage !== (inspected.errorMessage || ''),
    }
  }

  private async evaluateManagedAutoscaling(
    instance: Pick<
      ClawHostInstance,
      'instanceId' | 'orgId' | 'runtimeKind' | 'containerId' | 'containerName' | 'k8sNamespace' | 'k8sPodName' | 'healthUrl' | 'config'
    >,
  ) {
    try {
      return await this.clawHostRuntimeService.evaluateAutoscaling(
        this.buildManagedRuntimeTarget(instance),
      )
    }
    catch (error) {
      this.logger.warn({
        message: 'ClawHost autoscaling evaluation failed',
        instanceId: instance.instanceId,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }

  private async emitUnhealthyAlert(
    instance: Pick<ClawHostInstance, 'instanceId' | 'orgId' | 'plan' | 'healthUrl'>,
    message: string,
  ) {
    const cacheKey = this.buildAlertCacheKey(instance.instanceId)
    const alreadyAlerted = await this.redisService.get(cacheKey)
    if (alreadyAlerted) {
      return
    }

    await this.redisService.set(cacheKey, '1', CLAWHOST_ALERT_TTL_SECONDS)
    await this.clawHostAlertService.notifyUnhealthyInstance({
      instanceId: instance.instanceId,
      orgId: instance.orgId,
      plan: instance.plan || 'starter',
      status: ClawHostInstanceStatus.ERROR,
      message,
      healthUrl: instance.healthUrl || '',
    })
  }

  private async clearUnhealthyAlert(instanceId: string) {
    await this.redisService.del(this.buildAlertCacheKey(instanceId))
  }

  private buildAlertCacheKey(instanceId: string) {
    return `mediaclaw:clawhost:alert:${instanceId}`
  }

  private async syncPostgresMetadata(
    instance: Pick<
      ClawHostInstance,
      | 'instanceId'
      | 'orgId'
      | 'clientName'
      | 'plan'
      | 'status'
      | 'deploymentMode'
      | 'runtimeKind'
      | 'config'
      | 'skills'
      | 'healthStatus'
      | 'instanceLayer'
      | 'requestedImChannel'
      | 'accessUrl'
      | 'healthUrl'
      | 'k8sNamespace'
      | 'k8sPodName'
      | 'hostPort'
      | 'runtimeImage'
      | 'containerId'
      | 'containerName'
      | 'lastHealthMessage'
      | 'connectionCodeHash'
      | 'boundApiKeyPrefix'
      | 'boundApiKeyId'
      | 'boundAt'
      | 'lastHeartbeatAt'
      | 'lastClientVersion'
      | 'lastAgentId'
      | 'heartbeatCapabilities'
      | 'connectionCodePreview'
      | 'connectionCodeIssuedAt'
      | 'connectionCodeExpiresAt'
    >,
    options: {
      ownerUserId?: string
      apiToken?: string
      deviceId?: string
      deviceApproved?: boolean
    } = {},
  ) {
    try {
      await this.clawHostPostgresService.syncInstance({
        instanceId: instance.instanceId,
        orgId: instance.orgId,
        clientName: instance.clientName,
        plan: instance.plan,
        status: instance.status,
        deploymentMode: instance.deploymentMode,
        runtimeKind: instance.runtimeKind,
        config: instance.config,
        skills: instance.skills,
        healthStatus: instance.healthStatus,
        instanceLayer: instance.instanceLayer as unknown as Record<string, unknown>,
        requestedImChannel: instance.requestedImChannel,
        accessUrl: instance.accessUrl,
        healthUrl: instance.healthUrl,
        k8sNamespace: instance.k8sNamespace,
        k8sPodName: instance.k8sPodName,
        hostPort: instance.hostPort,
        runtimeImage: instance.runtimeImage,
        containerId: instance.containerId,
        containerName: instance.containerName,
        lastHealthMessage: instance.lastHealthMessage,
        connectionCodeHash: instance.connectionCodeHash,
        boundApiKeyPrefix: instance.boundApiKeyPrefix,
        boundApiKeyId: instance.boundApiKeyId,
        boundAt: instance.boundAt,
        lastHeartbeatAt: instance.lastHeartbeatAt,
        lastClientVersion: instance.lastClientVersion,
        lastAgentId: instance.lastAgentId,
        heartbeatCapabilities: instance.heartbeatCapabilities,
        connectionCodePreview: instance.connectionCodePreview,
        connectionCodeIssuedAt: instance.connectionCodeIssuedAt,
        connectionCodeExpiresAt: instance.connectionCodeExpiresAt,
      }, options)
    }
    catch (error) {
      const message = error instanceof Error ? error.message : 'unknown_error'
      this.logger.warn({
        message: 'ClawHost PostgreSQL metadata sync failed',
        instanceId: instance.instanceId,
        orgId: instance.orgId,
        error: message,
      })
    }
  }

  private upsertSkill(
    skills: ClawHostInstalledSkill[],
    skillId: string,
    version: string,
    installedAt: Date,
  ) {
    const nextSkills = skills.map(skill => ({
      skillId: skill.skillId,
      version: skill.version,
      installedAt: skill.installedAt,
    }))

    const existingIndex = nextSkills.findIndex(skill => skill.skillId === skillId)
    if (existingIndex >= 0) {
      nextSkills[existingIndex] = {
        ...nextSkills[existingIndex],
        version,
        installedAt,
      }
      return nextSkills
    }

    return [
      ...nextSkills,
      {
        skillId,
        version,
        installedAt,
      },
    ]
  }

  private normalizePage(page?: number) {
    const normalized = Number(page || 1)
    return Number.isFinite(normalized) && normalized > 0
      ? Math.floor(normalized)
      : 1
  }

  private normalizeLimit(limit?: number) {
    const normalized = Number(limit || 20)
    if (!Number.isFinite(normalized) || normalized <= 0) {
      return 20
    }

    return Math.min(Math.floor(normalized), 100)
  }

  private buildLifecycleLogs(
    instance: Pick<
      ClawHostInstance,
      'instanceId' | 'deploymentMode' | 'requestedImChannel' | 'boundAt' | 'boundApiKeyPrefix' | 'lastHeartbeatAt' | 'lastClientVersion' | 'status' | 'plan' | 'containerName' | 'hostPort'
    >,
  ) {
    return [
      `[${new Date().toISOString()}] lifecycle_status=${instance.status} instance=${instance.instanceId}`,
      `[${new Date().toISOString()}] deployment_mode=${instance.deploymentMode || ClawHostDeploymentMode.BYOC} plan=${instance.plan || 'starter'} im_channel=${instance.requestedImChannel || 'unset'}`,
      `[${new Date().toISOString()}] runtime_container=${instance.containerName || 'n/a'} host_port=${instance.hostPort || 0}`,
      `[${new Date().toISOString()}] bound_api_key=${instance.boundApiKeyPrefix || 'unbound'} bound_at=${instance.boundAt?.toISOString?.() || 'n/a'}`,
      `[${new Date().toISOString()}] last_heartbeat=${instance.lastHeartbeatAt?.toISOString?.() || 'never'} client_version=${instance.lastClientVersion || 'unknown'}`,
    ]
  }

  private toResponse(instance: ClawHostInstance) {
    const derived = this.isManagedInstance(instance)
      ? this.deriveManagedRuntimeStateFromSnapshot(instance)
      : this.deriveRuntimeState(instance)
    const instanceLayer = this.buildInstanceLayer(
      instance.instanceLayer,
      instance.orgId,
      instance.skills || [],
    )

    return {
      id: instance._id?.toString?.() || instance.instanceId,
      instanceId: instance.instanceId,
      orgId: instance.orgId,
      clientName: instance.clientName,
      plan: instance.plan || 'starter',
      status: derived.status,
      config: instance.config,
      skills: (instance.skills || []).map(skill => ({
        skillId: skill.skillId,
        version: skill.version,
        installedAt: skill.installedAt,
      })),
      healthStatus: derived.healthStatus,
      lastHealthMessage: derived.healthMessage || instance.lastHealthMessage || '',
      instanceLayer: {
        ...instanceLayer,
        resourceIsolation: this.buildResourceIsolationSnapshot(instance, instanceLayer.resourceIsolation),
      },
      k8sNamespace: instance.k8sNamespace,
      k8sPodName: instance.k8sPodName,
      connectionInfo: {
        deploymentMode: instance.deploymentMode || ClawHostDeploymentMode.BYOC,
        runtimeKind: instance.runtimeKind || ClawHostRuntimeKind.DOCKER,
        requestedImChannel: instance.requestedImChannel || '',
        accessUrl: instance.accessUrl || '',
        healthUrl: instance.healthUrl || '',
        gateway: this.buildGatewayConfig(instance.gatewayConfig),
        sharedExperience: this.buildSharedExperienceConfig(instance.sharedExperienceConfig),
        containerId: instance.containerId || '',
        containerName: instance.containerName || '',
        runtimeImage: instance.runtimeImage || '',
        hostPort: instance.hostPort || 0,
        installCommand: instance.installCommand || this.buildInstallCommand(),
        connectionStatus: derived.connectionStatus,
        connectionCodePreview: instance.connectionCodePreview || '',
        connectionCodeExpiresAt: instance.connectionCodeExpiresAt,
        boundApiKeyPrefix: instance.boundApiKeyPrefix || '',
        boundAt: instance.boundAt,
        lastHeartbeatAt: instance.lastHeartbeatAt,
        lastClientVersion: instance.lastClientVersion || '',
        lastAgentId: instance.lastAgentId || '',
        heartbeatCapabilities: instance.heartbeatCapabilities || [],
      },
      createdAt: instance.createdAt,
      updatedAt: instance.updatedAt,
    }
  }

  private buildManagedRuntimeTarget(
    instance: Pick<
      ClawHostInstance,
      'instanceId' | 'orgId' | 'runtimeKind' | 'containerId' | 'containerName' | 'k8sNamespace' | 'k8sPodName' | 'healthUrl' | 'config'
    >,
  ): ManagedRuntimeTarget {
    return {
      instanceId: instance.instanceId,
      orgId: instance.orgId,
      runtimeKind: instance.runtimeKind || ClawHostRuntimeKind.DOCKER,
      containerId: instance.containerId,
      containerName: instance.containerName || '',
      namespace: instance.k8sNamespace || '',
      podName: instance.k8sPodName || '',
      healthUrl: instance.healthUrl || '',
      config: instance.config,
    }
  }

  private assertLifecycleTransition(
    current: ClawHostInstanceStatus,
    next: ClawHostInstanceStatus,
    operation: string,
  ) {
    if (current === next) {
      return
    }

    const allowedNext = CLAWHOST_STATUS_TRANSITIONS[current] || []
    if (allowedNext.includes(next)) {
      return
    }

    throw new BadRequestException(
      `ClawHost instance cannot ${operation} from ${current} to ${next}`,
    )
  }
}
