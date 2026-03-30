import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Cron } from '@nestjs/schedule'
import {
  ClawHostHealthStatus,
  ClawHostInstalledSkill,
  ClawHostInstance,
  ClawHostInstanceConfig,
  ClawHostInstanceStatus,
} from '@yikart/mongodb'
import { Model } from 'mongoose'

interface ListInstancesFilters {
  orgId?: string
  status?: ClawHostInstanceStatus
}

interface PaginationInput {
  page?: number
  limit?: number
}

@Injectable()
export class ClawHostService {
  private readonly logger = new Logger(ClawHostService.name)

  constructor(
    @InjectModel(ClawHostInstance.name)
    private readonly clawHostInstanceModel: Model<ClawHostInstance>,
  ) {}

  async createInstance(
    orgId: string,
    config: ClawHostInstanceConfig,
    clientName: string,
  ) {
    if (!orgId?.trim()) {
      throw new BadRequestException('orgId is required')
    }

    if (!clientName?.trim()) {
      throw new BadRequestException('clientName is required')
    }

    this.validateConfig(config)

    const instanceId = this.buildInstanceId(orgId, clientName)
    const k8sNamespace = this.buildNamespace(orgId)
    const k8sPodName = this.buildPodName(instanceId)
    const now = new Date()

    const created = await this.clawHostInstanceModel.create({
      instanceId,
      orgId: orgId.trim(),
      clientName: clientName.trim(),
      status: ClawHostInstanceStatus.CREATING,
      config,
      skills: [],
      healthStatus: {
        lastCheck: now,
        isHealthy: false,
        latency: 0,
      },
      k8sNamespace,
      k8sPodName,
    })

    await this.stubCreateK8sPod(created.instanceId, created.k8sNamespace, created.k8sPodName)

    const running = await this.clawHostInstanceModel.findByIdAndUpdate(
      created._id,
      {
        $set: {
          status: ClawHostInstanceStatus.RUNNING,
          healthStatus: this.buildHealthyStatus(now),
        },
      },
      { new: true },
    ).lean().exec()

    if (!running) {
      throw new NotFoundException('ClawHost instance not found')
    }

    return this.toResponse(running)
  }

  async stopInstance(instanceId: string) {
    const stopped = await this.clawHostInstanceModel.findOneAndUpdate(
      { instanceId },
      {
        $set: {
          status: ClawHostInstanceStatus.STOPPED,
          healthStatus: {
            lastCheck: new Date(),
            isHealthy: false,
            latency: 0,
          },
        },
      },
      { new: true },
    ).lean().exec()

    if (!stopped) {
      throw new NotFoundException('ClawHost instance not found')
    }

    return this.toResponse(stopped)
  }

  async restartInstance(instanceId: string) {
    const existing = await this.getInstanceOrThrow(instanceId)

    this.logger.log({
      message: 'ClawHost instance restarting',
      instanceId,
      previousStatus: existing.status,
    })

    const restarted = await this.clawHostInstanceModel.findByIdAndUpdate(
      existing._id,
      {
        $set: {
          status: ClawHostInstanceStatus.RUNNING,
          healthStatus: this.buildHealthyStatus(new Date()),
        },
      },
      { new: true },
    ).lean().exec()

    if (!restarted) {
      throw new NotFoundException('ClawHost instance not found')
    }

    return {
      ...this.toResponse(restarted),
      operation: 'restarting',
    }
  }

  async getInstanceHealth(instanceId: string) {
    const instance = await this.getInstanceOrThrow(instanceId)
    const healthStatus = instance.healthStatus?.lastCheck
      ? instance.healthStatus
      : this.buildHealthStatus(instance)

    if (!instance.healthStatus?.lastCheck) {
      await this.clawHostInstanceModel.updateOne(
        { _id: instance._id },
        { $set: { healthStatus } },
      ).exec()
    }

    return {
      instanceId: instance.instanceId,
      status: instance.status,
      healthStatus,
    }
  }

  async installSkill(instanceId: string, skillId: string, version: string) {
    if (!skillId?.trim() || !version?.trim()) {
      throw new BadRequestException('skillId and version are required')
    }

    const instance = await this.clawHostInstanceModel.findOne({ instanceId }).exec()
    if (!instance) {
      throw new NotFoundException('ClawHost instance not found')
    }

    const installedAt = new Date()
    const nextSkills = this.upsertSkill(instance.skills || [], skillId, version, installedAt)
    instance.set('skills', nextSkills)
    await instance.save()

    return {
      instanceId: instance.instanceId,
      skill: nextSkills.find(item => item.skillId === skillId) || null,
      installedSkills: nextSkills.length,
    }
  }

  async batchUpgradeSkill(skillId: string, version: string) {
    if (!skillId?.trim() || !version?.trim()) {
      throw new BadRequestException('skillId and version are required')
    }

    const instances = await this.clawHostInstanceModel.find({
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

      const nextSkills = this.upsertSkill(instance.skills || [], skillId, version, upgradedAt)
      instance.set('skills', nextSkills)
      instance.set('status', ClawHostInstanceStatus.RUNNING)
      instance.set('healthStatus', this.buildHealthyStatus(upgradedAt))
      await instance.save()

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
      items: items.map(item => this.toResponse(item)),
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
    const runningInstances = await this.clawHostInstanceModel.find({
      status: ClawHostInstanceStatus.RUNNING,
    }).lean().exec()

    const checkedAt = new Date()
    const results = [] as Array<{
      instanceId: string
      status: ClawHostInstanceStatus
      healthStatus: ClawHostHealthStatus
    }>

    for (const instance of runningInstances) {
      const healthStatus = this.buildHealthStatus(instance, checkedAt)
      const nextStatus = healthStatus.isHealthy
        ? ClawHostInstanceStatus.RUNNING
        : ClawHostInstanceStatus.ERROR

      await this.clawHostInstanceModel.updateOne(
        { _id: instance._id },
        {
          $set: {
            status: nextStatus,
            healthStatus,
          },
        },
      ).exec()

      results.push({
        instanceId: instance.instanceId,
        status: nextStatus,
        healthStatus,
      })
    }

    return {
      checkedAt,
      checkedCount: results.length,
      unhealthyCount: results.filter(item => !item.healthStatus.isHealthy).length,
      items: results,
    }
  }

  async getInstanceLogs(instanceId: string, lines = 100) {
    const instance = await this.getInstanceOrThrow(instanceId)
    const normalizedLines = Math.min(Math.max(lines, 1), 500)
    const now = new Date()

    return {
      instanceId: instance.instanceId,
      lines: normalizedLines,
      logs: Array.from({ length: normalizedLines }, (_, index) => {
        const lineNumber = normalizedLines - index
        return `[${now.toISOString()}] [${instance.k8sPodName}] stub log line ${lineNumber}`
      }),
    }
  }

  private async getInstanceOrThrow(instanceId: string) {
    const instance = await this.clawHostInstanceModel.findOne({ instanceId }).lean().exec()
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

  private buildHealthyStatus(now: Date): ClawHostHealthStatus {
    return {
      lastCheck: now,
      isHealthy: true,
      latency: 120,
    }
  }

  private buildHealthStatus(
    instance: Pick<ClawHostInstance, 'instanceId' | 'k8sPodName' | 'status'>,
    checkedAt: Date = new Date(),
  ): ClawHostHealthStatus {
    const latency = this.deriveLatency(instance.instanceId)
    const isHealthy = Boolean(instance.k8sPodName) && latency < 1_000

    return {
      lastCheck: checkedAt,
      isHealthy,
      latency,
    }
  }

  private deriveLatency(instanceId: string) {
    const seed = instanceId
      .split('')
      .reduce((sum, char) => sum + char.charCodeAt(0), 0)

    return 80 + (seed % 220)
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

  private async stubCreateK8sPod(instanceId: string, namespace: string, podName: string) {
    this.logger.log({
      message: 'Stubbed ClawHost pod creation',
      instanceId,
      namespace,
      podName,
    })
  }

  private toResponse(instance: ClawHostInstance) {
    return {
      id: instance._id?.toString?.() || '',
      instanceId: instance.instanceId,
      orgId: instance.orgId,
      clientName: instance.clientName,
      status: instance.status,
      config: instance.config,
      skills: (instance.skills || []).map(skill => ({
        skillId: skill.skillId,
        version: skill.version,
        installedAt: skill.installedAt,
      })),
      healthStatus: instance.healthStatus || {
        lastCheck: null,
        isHealthy: false,
        latency: 0,
      },
      k8sNamespace: instance.k8sNamespace,
      k8sPodName: instance.k8sPodName,
      createdAt: instance.createdAt,
      updatedAt: instance.updatedAt,
    }
  }
}
