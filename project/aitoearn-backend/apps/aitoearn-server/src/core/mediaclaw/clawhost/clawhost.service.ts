import { createHash, randomBytes } from 'node:crypto'
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Cron } from '@nestjs/schedule'
import {
  ClawHostDeploymentMode,
  ClawHostHealthStatus,
  ClawHostInstalledSkill,
  ClawHostInstance,
  ClawHostInstanceConfig,
  ClawHostInstanceStatus,
  ClawHostRuntimeKind,
  UserRole,
} from '@yikart/mongodb'
import { RedisService } from '@yikart/redis'
import { Model } from 'mongoose'
import { MediaClawApiKeyService } from '../apikey/apikey.service'
import { ClawHostAlertService } from './clawhost-alert.service'
import { ClawHostPostgresService } from './clawhost-postgres.service'
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
    @InjectModel(ClawHostInstance.name)
    private readonly clawHostInstanceModel: Model<ClawHostInstance>,
    private readonly redisService: RedisService,
    private readonly apiKeyService: MediaClawApiKeyService,
    private readonly clawHostRuntimeService: ClawHostRuntimeService,
    private readonly clawHostAlertService: ClawHostAlertService,
    private readonly clawHostPostgresService: ClawHostPostgresService,
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
      skills: [{
        skillId: DEFAULT_OPENCLAW_SKILL_ID,
        version: DEFAULT_OPENCLAW_SKILL_VERSION,
        installedAt: now,
      }],
      healthStatus: this.buildPendingHealthStatus(now),
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
      skills: [{
        skillId: DEFAULT_OPENCLAW_SKILL_ID,
        version: DEFAULT_OPENCLAW_SKILL_VERSION,
        installedAt: new Date(),
      }],
      healthStatus: this.buildPendingHealthStatus(new Date()),
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

    const payload = await this.redisService.getJson<ConnectCodePayload>(
      this.buildConnectionCodeCacheKey(code),
    )
    if (!payload) {
      throw new BadRequestException('连接码已过期，请在 Web 后台重新生成')
    }

    if (payload.instanceId !== requestedInstanceId) {
      throw new BadRequestException('该连接码不属于当前实例')
    }

    const instance = await this.getInstanceOrThrow(payload.orgId, payload.instanceId)
    if (instance.boundApiKeyId) {
      await this.apiKeyService.revokeInternal(instance.boundApiKeyId)
    }

    const apiKey = await this.apiKeyService.create(payload.requestedByUserId, {
      name: `${instance.clientName} OpenClaw Skill`,
      orgId: instance.orgId,
      permissions: ['skill:heartbeat', 'skill:deliveries', 'skill:feedback'],
      role: UserRole.OPERATOR,
    })

    const now = new Date()
    const capabilities = this.normalizeCapabilities(input.capabilities)
    const nextStatus = this.buildHealthyStatus(now, 1)

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

    await this.redisService.del(this.buildConnectionCodeCacheKey(code))
    await this.syncPostgresMetadata(
      await this.getInstanceOrThrow(payload.orgId, payload.instanceId),
      {
        ownerUserId: payload.requestedByUserId,
        apiToken: apiKey.key,
        deviceId: input.agentId?.trim() || requestedInstanceId,
        deviceApproved: true,
      },
    )

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
    const instance = input.apiKeyId?.trim()
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
    instance.set('status', ClawHostInstanceStatus.RUNNING)
    instance.set('lastHeartbeatAt', now)
    instance.set('lastClientVersion', input.clientVersion?.trim() || instance.lastClientVersion || '')
    instance.set('lastAgentId', agentId || instance.lastAgentId || instance.instanceId)
    instance.set('heartbeatCapabilities', capabilities)
    instance.set('healthStatus', this.buildHealthyStatus(now, 1))
    await instance.save()
    await this.syncPostgresMetadata(instance.toObject() as ClawHostInstance, {
      deviceId: agentId || instance.instanceId,
      deviceApproved: true,
    })

    return {
      instanceId: instance.instanceId,
      status: instance.status,
      lastHeartbeatAt: now.toISOString(),
    }
  }

  async startInstance(orgId: string, instanceId: string) {
    const instance = await this.getInstanceOrThrow(orgId, instanceId)
    if (this.isManagedInstance(instance)) {
      await this.clawHostRuntimeService.startContainer(this.buildManagedRuntimeTarget(instance))
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
    if (this.isManagedInstance(instance)) {
      await this.clawHostRuntimeService.stopContainer(this.buildManagedRuntimeTarget(instance))
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

    this.logger.log({
      message: 'ClawHost instance restarting',
      instanceId,
      previousStatus: existing.status,
    })

    if (this.isManagedInstance(existing)) {
      await this.clawHostRuntimeService.restartContainer(this.buildManagedRuntimeTarget(existing))
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

  async getInstanceHealth(orgId: string, instanceId: string) {
    const instance = await this.getInstanceOrThrow(orgId, instanceId)
    const derived = this.isManagedInstance(instance)
      ? await this.deriveManagedRuntimeState(instance)
      : this.deriveRuntimeState(instance)

    if (derived.shouldPersist) {
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
      await this.syncPostgresMetadata({
        ...instance,
        status: derived.status,
        healthStatus: derived.healthStatus,
        lastHealthMessage: derived.healthMessage || '',
      } as ClawHostInstance)
    }

    return {
      instanceId: instance.instanceId,
      status: derived.status,
      healthStatus: derived.healthStatus,
      connectionStatus: derived.connectionStatus,
      lastHeartbeatAt: instance.lastHeartbeatAt,
      message: derived.healthMessage || '',
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

  async upgradeSkill(orgId: string, instanceId: string, version: string) {
    const normalizedVersion = version?.trim() || DEFAULT_OPENCLAW_SKILL_VERSION
    const instance = await this.clawHostInstanceModel.findOne({
      instanceId,
      orgId: orgId.trim(),
    }).exec()
    if (!instance) {
      throw new NotFoundException('ClawHost instance not found')
    }

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

    instance.set('skills', nextSkills)
    instance.set('status', ClawHostInstanceStatus.RUNNING)
    instance.set('healthStatus', this.buildHealthyStatus(upgradedAt, 1))
    instance.set('lastHealthMessage', '')
    await instance.save()
    await this.syncPostgresMetadata(instance.toObject() as ClawHostInstance)

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

    const instance = await this.clawHostInstanceModel.findOne({
      instanceId,
      orgId: orgId.trim(),
    }).exec()
    if (!instance) {
      throw new NotFoundException('ClawHost instance not found')
    }

    const installedAt = new Date()
    const nextSkills = this.upsertSkill(instance.skills || [], skillId, version, installedAt)
    instance.set('skills', nextSkills)
    await instance.save()
    await this.syncPostgresMetadata(instance.toObject() as ClawHostInstance)

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

    const instance = await this.clawHostInstanceModel.findOne({
      instanceId,
      orgId: orgId.trim(),
    }).exec()
    if (!instance) {
      throw new NotFoundException('ClawHost instance not found')
    }

    const nextSkills = (instance.skills || []).filter(item => item.skillId !== skillId.trim())
    if (nextSkills.length === (instance.skills || []).length) {
      throw new NotFoundException('ClawHost skill not found')
    }

    instance.set('skills', nextSkills)
    await instance.save()
    await this.syncPostgresMetadata(instance.toObject() as ClawHostInstance)

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

    const instances = await this.clawHostInstanceModel.find({
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
      instance.set('status', ClawHostInstanceStatus.UPGRADING)
      await instance.save()

      if (this.isManagedInstance(instance) && skillId === DEFAULT_OPENCLAW_SKILL_ID) {
        await this.clawHostRuntimeService.upgradeSkill(
          this.buildManagedRuntimeTarget(instance.toObject() as ClawHostInstance),
          version,
        )
      }

      const nextSkills = this.upsertSkill(instance.skills || [], skillId, version, upgradedAt)
      instance.set('skills', nextSkills)
      instance.set('status', ClawHostInstanceStatus.RUNNING)
      instance.set('healthStatus', this.buildHealthyStatus(upgradedAt, 50))
      instance.set('lastHealthMessage', '')
      await instance.save()
      await this.syncPostgresMetadata(instance.toObject() as ClawHostInstance)

      upgradedItems.push({
        instanceId: instance.instanceId,
        status: instance.status,
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

    const [items, total] = await Promise.all([
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
    const instances = await this.clawHostInstanceModel.find({
      status: {
        $in: [
          ClawHostInstanceStatus.CREATING,
          ClawHostInstanceStatus.PENDING_MANUAL_SETUP,
          ClawHostInstanceStatus.RUNNING,
          ClawHostInstanceStatus.ERROR,
        ],
      },
    }).lean().exec()

    const results = [] as Array<{
      instanceId: string
      status: ClawHostInstanceStatus
      healthStatus: ClawHostHealthStatus
    }>

    for (const instance of instances) {
      const derived = this.isManagedInstance(instance)
        ? await this.deriveManagedRuntimeState(instance)
        : this.deriveRuntimeState(instance)
      if (derived.shouldPersist) {
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
        await this.syncPostgresMetadata({
          ...instance,
          status: derived.status,
          healthStatus: derived.healthStatus,
          lastHealthMessage: derived.healthMessage || '',
        } as ClawHostInstance)
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
      })
    }

    return {
      checkedAt: new Date(),
      checkedCount: results.length,
      unhealthyCount: results.filter(item => !item.healthStatus.isHealthy).length,
      items: results,
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
    const instance = await this.clawHostInstanceModel.findOne({
      instanceId,
      orgId: orgId.trim(),
    }).lean().exec()
    if (!instance) {
      throw new NotFoundException('ClawHost instance not found')
    }

    return instance
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
    const items = await this.clawHostInstanceModel.find({
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
    '_id' | 'status' | 'healthStatus' | 'runtimeKind' | 'containerId' | 'containerName' | 'k8sNamespace' | 'k8sPodName' | 'healthUrl' | 'lastHealthMessage'
  >) {
    const now = new Date()
    const inspected = await this.clawHostRuntimeService.inspectManagedContainer(
      this.buildManagedRuntimeTarget(instance as Pick<ClawHostInstance, 'runtimeKind' | 'containerId' | 'containerName' | 'k8sNamespace' | 'k8sPodName' | 'healthUrl'>),
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
      | 'boundApiKeyPrefix'
      | 'boundAt'
      | 'lastHeartbeatAt'
      | 'lastClientVersion'
      | 'heartbeatCapabilities'
      | 'connectionCodePreview'
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
        boundApiKeyPrefix: instance.boundApiKeyPrefix,
        boundAt: instance.boundAt,
        lastHeartbeatAt: instance.lastHeartbeatAt,
        lastClientVersion: instance.lastClientVersion,
        heartbeatCapabilities: instance.heartbeatCapabilities,
        connectionCodePreview: instance.connectionCodePreview,
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

    return {
      id: instance._id?.toString?.() || '',
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
      k8sNamespace: instance.k8sNamespace,
      k8sPodName: instance.k8sPodName,
      connectionInfo: {
        deploymentMode: instance.deploymentMode || ClawHostDeploymentMode.BYOC,
        runtimeKind: instance.runtimeKind || ClawHostRuntimeKind.DOCKER,
        requestedImChannel: instance.requestedImChannel || '',
        accessUrl: instance.accessUrl || '',
        healthUrl: instance.healthUrl || '',
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
      'runtimeKind' | 'containerId' | 'containerName' | 'k8sNamespace' | 'k8sPodName' | 'healthUrl'
    >,
  ): ManagedRuntimeTarget {
    return {
      runtimeKind: instance.runtimeKind || ClawHostRuntimeKind.DOCKER,
      containerId: instance.containerId,
      containerName: instance.containerName || '',
      namespace: instance.k8sNamespace || '',
      podName: instance.k8sPodName || '',
      healthUrl: instance.healthUrl || '',
    }
  }
}
