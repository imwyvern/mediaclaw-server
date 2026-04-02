import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import {
  EmployeeAssignment,
  EmployeeAssignmentStatus,
  PlatformAccount,
  PlatformAccountStatus,
  VideoTask,
} from '@yikart/mongodb'
import { Model, Types } from 'mongoose'

interface AssignEmployeeInput {
  employeeId: string
  employeeName?: string
  platformAccountId: string
  platforms?: string[]
  contentTags?: string[]
  dailyQuota?: number
  requirePublishConfirmation?: boolean
  status?: EmployeeAssignmentStatus
  metadata?: Record<string, any>
}

interface DispatchMetadata {
  assignmentId: string
  employeeId: string
  employeeName: string
  platformAccountId: string
  platform: string
  platformAccountName: string
  dispatchedAt: string
  dailyAssignedCount: number
  requirePublishConfirmation: boolean
  publishConfirmed?: boolean
  confirmedPublishedAt?: string
}

type AssignmentRecord = Record<string, any>
type PlatformAccountRecord = Record<string, any>
type VideoTaskRecord = Record<string, any>

@Injectable()
export class EmployeeDispatchService {
  private readonly logger = new Logger(EmployeeDispatchService.name)

  constructor(
    @InjectModel(EmployeeAssignment.name)
    private readonly employeeAssignmentModel: Model<EmployeeAssignment>,
    @InjectModel(PlatformAccount.name)
    private readonly platformAccountModel: Model<PlatformAccount>,
    @InjectModel(VideoTask.name)
    private readonly videoTaskModel: Model<VideoTask>,
  ) {}

  async assignEmployee(orgId: string, input: AssignEmployeeInput) {
    const normalizedOrgId = this.toObjectId(orgId, 'orgId')
    const employeeId = this.toObjectId(input.employeeId, 'employeeId')
    const platformAccount = await this.getPlatformAccount(normalizedOrgId, input.platformAccountId)

    const assignment = await this.employeeAssignmentModel.findOneAndUpdate(
      {
        orgId: normalizedOrgId,
        platformAccountId: platformAccount['_id'],
      },
      {
        $set: {
          employeeId,
          employeeName: input.employeeName?.trim() || `employee-${employeeId.toString().slice(-6)}`,
          platforms: this.normalizeStringList(input.platforms, [String(platformAccount['platform'] || '')]),
          contentTags: this.normalizeStringList(input.contentTags),
          dailyQuota: this.normalizeQuota(input.dailyQuota),
          requirePublishConfirmation: input.requirePublishConfirmation ?? true,
          status: input.status || EmployeeAssignmentStatus.ACTIVE,
          metadata: input.metadata || {},
        },
        $setOnInsert: {
          orgId: normalizedOrgId,
          platformAccountId: platformAccount['_id'],
          assignedAt: new Date(),
          dailyAssignedCount: 0,
          totalConfirmedPublished: 0,
          lastDispatchedAt: null,
          lastConfirmedAt: null,
        },
      },
      {
        upsert: true,
        new: true,
      },
    ).lean().exec()

    return this.toAssignmentResponse(assignment, platformAccount)
  }

  async dispatchToEmployee(task: VideoTask) {
    const taskRecord = task as unknown as VideoTaskRecord
    const taskId = taskRecord['_id']?.toString()
    if (!taskId) {
      return {
        dispatched: false,
        reason: 'task_not_persisted',
      }
    }

    const existingDispatch = this.readDispatchMetadata(taskRecord['metadata'])
    if (existingDispatch?.assignmentId) {
      return {
        dispatched: true,
        reused: true,
        ...existingDispatch,
      }
    }

    const orgId = taskRecord['orgId']?.toString()
    if (!orgId) {
      return {
        dispatched: false,
        reason: 'task_org_missing',
      }
    }

    const platform = this.resolveTaskPlatform(task)
    const tags = this.resolveTaskTags(task)
    const explicitPlatformAccountId = this.resolvePlatformAccountId(task)

    let selected: AssignmentRecord | null = explicitPlatformAccountId
      ? await this.findAssignmentByPlatformAccount(orgId, explicitPlatformAccountId)
      : null

    if (!selected) {
      const candidates = await this.employeeAssignmentModel.find({
        orgId: this.toObjectId(orgId, 'orgId'),
        status: EmployeeAssignmentStatus.ACTIVE,
      })
        .sort({ dailyAssignedCount: 1, lastDispatchedAt: 1, assignedAt: 1 })
        .lean()
        .exec()

      selected = this.pickAssignment(candidates, platform, tags)
    }

    if (!selected) {
      return {
        dispatched: false,
        reason: 'no_eligible_assignment',
        platform,
        tags,
      }
    }

    const dispatchedAt = new Date()
    const nextDailyAssignedCount = this.isSameUtcDay(selected['lastDispatchedAt'], dispatchedAt)
      ? Number(selected['dailyAssignedCount'] || 0) + 1
      : 1

    const updatedAssignment = await this.employeeAssignmentModel.findByIdAndUpdate(
      selected['_id'],
      {
        $set: {
          dailyAssignedCount: nextDailyAssignedCount,
          lastDispatchedAt: dispatchedAt,
        },
      },
      { new: true },
    ).lean().exec()

    const assignment = (updatedAssignment || selected) as AssignmentRecord
    const platformAccount = await this.platformAccountModel.findById(assignment['platformAccountId']).lean().exec() as PlatformAccountRecord | null
    const dispatchMetadata: DispatchMetadata = {
      assignmentId: assignment['_id'].toString(),
      employeeId: assignment['employeeId']?.toString() || '',
      employeeName: assignment['employeeName'] || '',
      platformAccountId: assignment['platformAccountId']?.toString() || '',
      platform: platformAccount?.['platform'] || platform,
      platformAccountName: platformAccount?.['accountName'] || '',
      dispatchedAt: dispatchedAt.toISOString(),
      dailyAssignedCount: nextDailyAssignedCount,
      requirePublishConfirmation: assignment['requirePublishConfirmation'] !== false,
      publishConfirmed: false,
    }

    await this.videoTaskModel.findByIdAndUpdate(taskRecord['_id'], {
      $set: {
        'metadata.distribution.employeeDispatch': dispatchMetadata,
        'metadata.distribution.platformAccountId': dispatchMetadata.platformAccountId,
      },
    }).exec()

    this.logger.log(`Employee dispatched for task ${taskId}: ${dispatchMetadata.employeeId}`)

    return {
      dispatched: true,
      ...dispatchMetadata,
    }
  }

  async confirmPublished(orgId: string, taskId: string) {
    const task = await this.videoTaskModel.findOne({
      _id: this.toObjectId(taskId, 'taskId'),
      orgId: this.toObjectId(orgId, 'orgId'),
    }).lean().exec() as VideoTaskRecord | null

    if (!task) {
      throw new NotFoundException('Video task not found')
    }

    const dispatchMetadata = this.readDispatchMetadata(task['metadata'])
    if (!dispatchMetadata?.assignmentId) {
      return {
        confirmed: false,
        reason: 'no_employee_dispatch',
      }
    }

    if (dispatchMetadata.publishConfirmed && dispatchMetadata.confirmedPublishedAt) {
      return {
        confirmed: true,
        reused: true,
        assignmentId: dispatchMetadata.assignmentId,
        employeeId: dispatchMetadata.employeeId,
        confirmedPublishedAt: dispatchMetadata.confirmedPublishedAt,
      }
    }

    const confirmedPublishedAt = new Date()
    const assignment = await this.employeeAssignmentModel.findOneAndUpdate(
      {
        _id: this.toObjectId(dispatchMetadata.assignmentId, 'assignmentId'),
        orgId: this.toObjectId(orgId, 'orgId'),
      },
      {
        $set: {
          lastConfirmedAt: confirmedPublishedAt,
        },
        $inc: {
          totalConfirmedPublished: 1,
        },
      },
      { new: true },
    ).lean().exec() as AssignmentRecord | null

    if (!assignment) {
      return {
        confirmed: false,
        reason: 'assignment_not_found',
        assignmentId: dispatchMetadata.assignmentId,
      }
    }

    await this.videoTaskModel.findByIdAndUpdate(task['_id'], {
      $set: {
        'metadata.distribution.employeeDispatch.publishConfirmed': true,
        'metadata.distribution.employeeDispatch.confirmedPublishedAt': confirmedPublishedAt.toISOString(),
      },
    }).exec()

    return {
      confirmed: true,
      assignmentId: assignment['_id'].toString(),
      employeeId: assignment['employeeId']?.toString() || '',
      confirmedPublishedAt: confirmedPublishedAt.toISOString(),
      totalConfirmedPublished: Number(assignment['totalConfirmedPublished'] || 0),
    }
  }

  private async getPlatformAccount(orgId: Types.ObjectId, platformAccountId: string) {
    const account = await this.platformAccountModel.findOne({
      _id: this.toObjectId(platformAccountId, 'platformAccountId'),
      orgId,
      status: PlatformAccountStatus.ACTIVE,
    }).lean().exec() as PlatformAccountRecord | null

    if (!account) {
      throw new NotFoundException('Platform account not found')
    }

    return account
  }

  private async findAssignmentByPlatformAccount(orgId: string, platformAccountId: string) {
    if (!Types.ObjectId.isValid(platformAccountId)) {
      return null
    }

    const assignment = await this.employeeAssignmentModel.findOne({
      orgId: this.toObjectId(orgId, 'orgId'),
      platformAccountId: this.toObjectId(platformAccountId, 'platformAccountId'),
      status: EmployeeAssignmentStatus.ACTIVE,
    }).lean().exec() as AssignmentRecord | null

    if (!assignment) {
      return null
    }

    return this.isWithinQuota(assignment) ? assignment : null
  }

  private pickAssignment(assignments: AssignmentRecord[], platform: string, tags: string[]) {
    const eligible = assignments.filter((assignment) => {
      if (!this.isWithinQuota(assignment)) {
        return false
      }

      const assignmentPlatforms = this.normalizeStringList(assignment['platforms'])
      if (platform && assignmentPlatforms.length > 0 && !assignmentPlatforms.includes(platform)) {
        return false
      }

      const assignmentTags = this.normalizeStringList(assignment['contentTags'])
      if (assignmentTags.length > 0 && tags.length > 0) {
        return assignmentTags.some(tag => tags.includes(tag))
      }

      return true
    })

    if (eligible.length === 0) {
      return null
    }

    return eligible.sort((left, right) => {
      const leftCount = this.getEffectiveDailyAssignedCount(left)
      const rightCount = this.getEffectiveDailyAssignedCount(right)
      if (leftCount !== rightCount) {
        return leftCount - rightCount
      }

      const leftTime = left['lastDispatchedAt'] ? new Date(left['lastDispatchedAt']).getTime() : 0
      const rightTime = right['lastDispatchedAt'] ? new Date(right['lastDispatchedAt']).getTime() : 0
      if (leftTime !== rightTime) {
        return leftTime - rightTime
      }

      const leftAssignedAt = left['assignedAt'] ? new Date(left['assignedAt']).getTime() : 0
      const rightAssignedAt = right['assignedAt'] ? new Date(right['assignedAt']).getTime() : 0
      return leftAssignedAt - rightAssignedAt
    })[0] || null
  }

  private isWithinQuota(assignment: AssignmentRecord) {
    const dailyQuota = Number(assignment['dailyQuota'] || 0)
    if (dailyQuota <= 0) {
      return true
    }

    return this.getEffectiveDailyAssignedCount(assignment) < dailyQuota
  }

  private getEffectiveDailyAssignedCount(assignment: AssignmentRecord) {
    return this.isSameUtcDay(assignment['lastDispatchedAt'], new Date())
      ? Number(assignment['dailyAssignedCount'] || 0)
      : 0
  }

  private resolvePlatformAccountId(task: VideoTask) {
    const taskRecord = task as unknown as VideoTaskRecord
    const distribution = this.readDistribution(taskRecord['metadata'])
    const metadata = this.readRecord(taskRecord['metadata']) || {}
    const publishInfo = this.readRecord(metadata['publishInfo'])
    const candidates = [
      distribution?.['platformAccountId'],
      metadata['platformAccountId'],
      publishInfo?.['platformAccountId'],
    ]

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim()
      }
    }

    return ''
  }

  private resolveTaskPlatform(task: VideoTask) {
    const taskRecord = task as unknown as VideoTaskRecord
    const distribution = this.readDistribution(taskRecord['metadata'])
    const metadata = this.readRecord(taskRecord['metadata']) || {}
    const publishInfo = this.readRecord(metadata['publishInfo'])
    const source = this.readRecord(taskRecord['source'])
    const candidates = [
      publishInfo?.['platform'],
      distribution?.['platform'],
      metadata['platform'],
      metadata['sourcePlatform'],
      source?.['type'],
    ]

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim().toLowerCase()
      }
    }

    return ''
  }

  private resolveTaskTags(task: VideoTask) {
    const taskRecord = task as unknown as VideoTaskRecord
    const metadata = this.readRecord(taskRecord['metadata']) || {}
    const candidates = [
      metadata['contentTags'],
      metadata['tags'],
      metadata['keywords'],
      metadata['styleTags'],
    ]

    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        const normalized = this.normalizeStringList(candidate)
        if (normalized.length > 0) {
          return normalized
        }
      }
    }

    return []
  }

  private readDispatchMetadata(metadata: Record<string, any> | undefined): DispatchMetadata | null {
    const distribution = this.readDistribution(metadata)
    const payload = distribution?.['employeeDispatch']
    if (!payload || typeof payload !== 'object') {
      return null
    }

    const assignmentId = typeof payload['assignmentId'] === 'string' ? payload['assignmentId'].trim() : ''
    if (!assignmentId) {
      return null
    }

    return {
      assignmentId,
      employeeId: typeof payload['employeeId'] === 'string' ? payload['employeeId'].trim() : '',
      employeeName: typeof payload['employeeName'] === 'string' ? payload['employeeName'].trim() : '',
      platformAccountId: typeof payload['platformAccountId'] === 'string' ? payload['platformAccountId'].trim() : '',
      platform: typeof payload['platform'] === 'string' ? payload['platform'].trim() : '',
      platformAccountName: typeof payload['platformAccountName'] === 'string' ? payload['platformAccountName'].trim() : '',
      dispatchedAt: typeof payload['dispatchedAt'] === 'string' ? payload['dispatchedAt'].trim() : '',
      dailyAssignedCount: Number(payload['dailyAssignedCount'] || 0),
      requirePublishConfirmation: payload['requirePublishConfirmation'] !== false,
      publishConfirmed: Boolean(payload['publishConfirmed']),
      confirmedPublishedAt: typeof payload['confirmedPublishedAt'] === 'string' ? payload['confirmedPublishedAt'].trim() : undefined,
    }
  }

  private readDistribution(metadata: Record<string, any> | undefined) {
    const distribution = metadata?.['distribution']
    return distribution && typeof distribution === 'object'
      ? distribution as Record<string, any>
      : null
  }

  private readRecord(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, any>
      : null
  }

  private isSameUtcDay(value: Date | string | null | undefined, date: Date) {
    if (!value) {
      return false
    }

    const left = new Date(value)
    if (Number.isNaN(left.getTime())) {
      return false
    }

    return left.getUTCFullYear() === date.getUTCFullYear()
      && left.getUTCMonth() === date.getUTCMonth()
      && left.getUTCDate() === date.getUTCDate()
  }

  private normalizeQuota(value?: number) {
    const normalized = Number(value || 0)
    return Number.isFinite(normalized) && normalized > 0
      ? Math.trunc(normalized)
      : 0
  }

  private normalizeStringList(value: unknown, fallback: string[] = []) {
    const source = Array.isArray(value) ? value : fallback
    return Array.from(new Set(source
      .map(item => typeof item === 'string' ? item.trim().toLowerCase() : '')
      .filter(Boolean)))
  }

  private toAssignmentResponse(assignment: AssignmentRecord, platformAccount?: PlatformAccountRecord) {
    return {
      id: assignment['_id'].toString(),
      orgId: assignment['orgId'].toString(),
      employeeId: assignment['employeeId']?.toString() || '',
      employeeName: assignment['employeeName'] || '',
      platformAccountId: assignment['platformAccountId']?.toString() || '',
      platformAccount: platformAccount
        ? {
            id: platformAccount['_id'].toString(),
            platform: platformAccount['platform'],
            accountId: platformAccount['accountId'],
            accountName: platformAccount['accountName'],
          }
        : null,
      platforms: this.normalizeStringList(assignment['platforms']),
      contentTags: this.normalizeStringList(assignment['contentTags']),
      dailyQuota: Number(assignment['dailyQuota'] || 0),
      dailyAssignedCount: Number(assignment['dailyAssignedCount'] || 0),
      totalConfirmedPublished: Number(assignment['totalConfirmedPublished'] || 0),
      requirePublishConfirmation: assignment['requirePublishConfirmation'] !== false,
      status: assignment['status'],
      assignedAt: assignment['assignedAt'] || null,
      lastDispatchedAt: assignment['lastDispatchedAt'] || null,
      lastConfirmedAt: assignment['lastConfirmedAt'] || null,
      metadata: assignment['metadata'] || {},
    }
  }

  private toObjectId(value: string, field: string) {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`${field} is invalid`)
    }

    return new Types.ObjectId(value)
  }
}
