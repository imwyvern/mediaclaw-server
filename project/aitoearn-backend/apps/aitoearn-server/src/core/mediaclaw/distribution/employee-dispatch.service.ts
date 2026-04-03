import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import {
  EmployeeAssignment,
  EmployeeAssignmentStatus,
  MediaClawUser,
  PlatformAccount,
  VideoTask,
  VideoTaskStatus,
} from '@yikart/mongodb'
import { Model, Types } from 'mongoose'
import { WebhookService } from '../webhook/webhook.service'

interface AssignEmployeeResult {
  id: string
  orgId: string
  employeeId: string
  employeeName: string
  platformAccountId: string
  platforms: string[]
  isActive: boolean
  status: EmployeeAssignmentStatus
  assignedAt: Date | null
  lastDispatchedAt: Date | null
  lastConfirmedAt: Date | null
  metadata: Record<string, any>
}

@Injectable()
export class EmployeeDispatchService {
  private readonly logger = new Logger(EmployeeDispatchService.name)

  constructor(
    @InjectModel(EmployeeAssignment.name)
    private readonly employeeAssignmentModel: Model<EmployeeAssignment>,
    @InjectModel(MediaClawUser.name)
    private readonly mediaClawUserModel: Model<MediaClawUser>,
    @InjectModel(PlatformAccount.name)
    private readonly platformAccountModel: Model<PlatformAccount>,
    @InjectModel(VideoTask.name)
    private readonly videoTaskModel: Model<VideoTask>,
    private readonly webhookService: WebhookService,
  ) {}

  async assignEmployee(orgId: string, employeeId: string, platformAccountId: string) {
    const normalizedOrgId = this.toObjectId(orgId, 'orgId')
    const normalizedEmployeeId = this.toObjectId(employeeId, 'employeeId')
    const normalizedPlatformAccountId = this.toObjectId(platformAccountId, 'platformAccountId')

    const [employee, platformAccount] = await Promise.all([
      this.mediaClawUserModel.findById(normalizedEmployeeId).lean().exec(),
      this.platformAccountModel.findOne({
        _id: normalizedPlatformAccountId,
        orgId: normalizedOrgId,
      }).lean().exec(),
    ])

    if (!employee || employee.isActive === false || !this.belongsToOrg(employee, orgId)) {
      throw new NotFoundException('Employee not found in organization')
    }

    if (!platformAccount) {
      throw new NotFoundException('Platform account not found')
    }

    const now = new Date()
    const assignment = await this.employeeAssignmentModel.findOneAndUpdate(
      {
        orgId: normalizedOrgId,
        employeeId: normalizedEmployeeId,
        platformAccountId: normalizedPlatformAccountId,
      },
      {
        $set: {
          employeeName: employee.name || employee.email || employee.phone || employee._id.toString(),
          platforms: [platformAccount.platform],
          isActive: true,
          status: EmployeeAssignmentStatus.ACTIVE,
          assignedAt: now,
          metadata: {
            ...(employee?.imBindings?.length ? { imBindings: employee.imBindings } : {}),
            platformAccountName: platformAccount.accountName,
            platform: platformAccount.platform,
          },
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).exec()

    return this.toAssignmentResponse(assignment)
  }

  async listAssignments(orgId: string) {
    const assignments = await this.employeeAssignmentModel.find({
      orgId: this.toObjectId(orgId, 'orgId'),
    })
      .sort({ assignedAt: -1, createdAt: -1 })
      .lean()
      .exec()

    return assignments.map(item => this.toAssignmentResponse(item))
  }

  async dispatchToEmployee(videoTaskId: string, expectedOrgId?: string) {
    const taskObjectId = this.toObjectId(videoTaskId, 'videoTaskId')
    const task = await this.videoTaskModel.findById(taskObjectId).lean().exec()
    if (!task) {
      throw new NotFoundException('Video task not found')
    }

    const orgId = task.orgId?.toString()
    if (!orgId) {
      return {
        dispatched: false,
        reason: 'Video task has no orgId',
        taskId: videoTaskId,
        assignments: [],
      }
    }

    if (expectedOrgId && orgId !== expectedOrgId) {
      throw new NotFoundException('Video task not found in organization')
    }

    const platform = this.resolveTaskPlatform(task)
    const query = {
      orgId: this.toObjectId(orgId, "orgId"),
      isActive: true,
      status: EmployeeAssignmentStatus.ACTIVE,
      ...(platform ? { platforms: platform } : {}),
    } as Record<string, any>

    const assignments = await this.employeeAssignmentModel.find(query).lean().exec()
    if (assignments.length === 0) {
      return {
        dispatched: false,
        reason: 'No active employee assignment matched the task',
        taskId: videoTaskId,
        platform,
        assignments: [],
      }
    }

    const dispatchedAt = new Date()
    const dispatchPayload = assignments.map((assignment) => ({
      assignmentId: assignment._id.toString(),
      employeeId: assignment.employeeId?.toString() || '',
      employeeName: assignment.employeeName,
      platformAccountId: assignment.platformAccountId?.toString() || '',
      platforms: assignment.platforms || [],
      message: this.buildDispatchMessage(task, assignment),
      dispatchedAt: dispatchedAt.toISOString(),
    }))

    await Promise.all([
      this.employeeAssignmentModel.updateMany(
        { _id: { $in: assignments.map(item => item._id) } },
        {
          $set: { lastDispatchedAt: dispatchedAt },
          $inc: { dailyAssignedCount: 1 },
        },
      ).exec(),
      this.videoTaskModel.findByIdAndUpdate(task._id, {
        $set: {
          'metadata.distribution.employeeDispatch': {
            platform,
            dispatchedAt: dispatchedAt.toISOString(),
            assignments: dispatchPayload,
          },
          'metadata.distribution.lastStatusAt': dispatchedAt.toISOString(),
        },
        $push: {
          'metadata.distribution.history': {
            status: 'pushed',
            timestamp: dispatchedAt.toISOString(),
            details: {
              channel: 'employee-dispatch',
              assignments: dispatchPayload.map(item => ({
                assignmentId: item.assignmentId,
                employeeId: item.employeeId,
                employeeName: item.employeeName,
              })),
            },
          },
        },
      }).exec(),
    ])

    await this.webhookService.trigger('distribution.employee_dispatched', {
      orgId,
      taskId: task._id.toString(),
      brandId: task.brandId?.toString() || null,
      platform,
      dispatches: dispatchPayload,
      dispatchedAt: dispatchedAt.toISOString(),
    })

    this.logger.log({
      message: 'Employee dispatch completed',
      orgId,
      taskId: task._id.toString(),
      totalAssignments: dispatchPayload.length,
    })

    return {
      dispatched: true,
      taskId: task._id.toString(),
      platform,
      dispatchedAt,
      assignments: dispatchPayload,
    }
  }

  async confirmPublished(
    orgId: string,
    assignmentId: string,
    publishUrl: string,
    videoTaskId?: string,
  ) {
    const normalizedPublishUrl = publishUrl?.trim()
    if (!normalizedPublishUrl) {
      throw new BadRequestException('publishUrl is required')
    }

    const normalizedOrgId = this.toObjectId(orgId, 'orgId')
    const normalizedAssignmentId = this.toObjectId(assignmentId, 'assignmentId')
    const assignment = await this.employeeAssignmentModel.findOne({
      _id: normalizedAssignmentId,
      orgId: normalizedOrgId,
    }).exec()

    if (!assignment) {
      throw new NotFoundException('Employee assignment not found')
    }

    const confirmedAt = new Date()
    assignment.lastConfirmedAt = confirmedAt
    assignment.totalConfirmedPublished = Number(assignment.totalConfirmedPublished || 0) + 1
    assignment.metadata = {
      ...(assignment.metadata || {}),
      lastPublishUrl: normalizedPublishUrl,
      lastPublishedVideoTaskId: videoTaskId || null,
    }
    await assignment.save()

    if (videoTaskId && Types.ObjectId.isValid(videoTaskId)) {
      await this.videoTaskModel.findOneAndUpdate(
        {
          _id: new Types.ObjectId(videoTaskId),
          orgId: normalizedOrgId,
        },
        {
          $set: {
            status: VideoTaskStatus.PUBLISHED,
            'metadata.distribution.publishStatus': 'published',
            'metadata.distribution.publishUrl': normalizedPublishUrl,
            'metadata.distribution.lastStatusAt': confirmedAt.toISOString(),
            'metadata.publishedAt': confirmedAt.toISOString(),
          },
          $push: {
            'metadata.distribution.history': {
              status: 'published',
              timestamp: confirmedAt.toISOString(),
              details: {
                assignmentId: assignment._id.toString(),
                employeeId: assignment.employeeId?.toString() || '',
                employeeName: assignment.employeeName,
                publishUrl: normalizedPublishUrl,
              },
            },
          },
        },
      ).exec()
    }

    return {
      assignment: this.toAssignmentResponse(assignment),
      videoTaskId: videoTaskId || null,
      publishUrl: normalizedPublishUrl,
      confirmedAt,
    }
  }

  private belongsToOrg(user: MediaClawUser, orgId: string) {
    if (user.orgId?.toString() === orgId) {
      return true
    }

    return Array.isArray(user.orgMemberships)
      ? user.orgMemberships.some(item => item.orgId?.toString() === orgId)
      : false
  }

  private resolveTaskPlatform(task: VideoTask) {
    const metadataPlatform = this.readString(task.metadata, 'platform')
      || this.readString(task.metadata?.['distribution'], 'platform')
      || this.readString(task.metadata?.['publishInfo'], 'platform')
    return task.source?.type?.trim() || metadataPlatform || ''
  }

  private buildDispatchMessage(task: VideoTask, assignment: EmployeeAssignment) {
    return {
      taskId: task._id.toString(),
      title: task.copy?.title || task.copy?.description || task.output?.url || task.outputVideoUrl,
      description: task.copy?.description || '',
      hashtags: task.copy?.hashtags || [],
      outputVideoUrl: task.output?.url || task.outputVideoUrl || '',
      publishChecklist: [
        '确认封面与标题',
        '确认品牌素材与落地页',
        '发布后回填链接',
      ],
      employeeName: assignment.employeeName,
    }
  }

  private readString(source: Record<string, any> | undefined, key: string) {
    const value = source?.[key]
    return typeof value === 'string' ? value.trim() : ''
  }

  private toObjectId(value: string, field: string) {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`${field} is invalid`)
    }

    return new Types.ObjectId(value)
  }

  private toAssignmentResponse(assignment: EmployeeAssignment | Record<string, any>): AssignEmployeeResult {
    return {
      id: assignment._id.toString(),
      orgId: assignment.orgId.toString(),
      employeeId: assignment.employeeId?.toString() || '',
      employeeName: assignment.employeeName || '',
      platformAccountId: assignment.platformAccountId?.toString() || '',
      platforms: assignment.platforms || [],
      isActive: assignment.isActive !== false,
      status: assignment.status || EmployeeAssignmentStatus.ACTIVE,
      assignedAt: assignment.assignedAt || null,
      lastDispatchedAt: assignment.lastDispatchedAt || null,
      lastConfirmedAt: assignment.lastConfirmedAt || null,
      metadata: assignment.metadata || {},
    }
  }
}
