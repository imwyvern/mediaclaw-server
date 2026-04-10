import { createHash, randomBytes } from 'node:crypto'
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { StorageProvider } from '@yikart/assets'
import {
  ComplianceDeletionRequest,
  ComplianceDeletionRequestStatus,
  VideoTask,
} from '@yikart/mongodb'
import { Model, Types } from 'mongoose'
import { config } from '../../../config'
import { AuditService } from '../audit/audit.service'

interface CreateComplianceDeletionRequestInput {
  contentUrl?: string
  platformPostUrl?: string
  reason: string
  description?: string
  requesterName: string
  requesterEmail?: string
  requesterPhone?: string
  evidenceUrls?: string[]
  source?: string
}

interface ListComplianceDeletionRequestQuery {
  status?: ComplianceDeletionRequestStatus
  keyword?: string
  page?: number
  limit?: number
}

interface ReviewComplianceDeletionRequestInput {
  action: 'reviewing' | 'approve' | 'reject'
  comment?: string
}

interface ComplianceDeletionRequestRecord {
  _id: unknown
  requestId: string
  status: ComplianceDeletionRequestStatus
  contentUrl?: string
  platformPostUrl?: string
  reason: string
  description?: string
  requesterName: string
  requesterEmail?: string
  requesterPhone?: string
  evidenceUrls?: string[]
  source?: string
  publicTrackingTokenHash?: string
  publicTrackingTokenPreview?: string
  matchedVideoTaskIds?: unknown[]
  submittedAt?: Date | null
  reviewedBy?: string | null
  reviewedAt?: Date | null
  reviewComment?: string
  executedBy?: string | null
  executedAt?: Date | null
  executionResult?: Record<string, unknown> | null
  executionError?: string
  metadata?: Record<string, unknown> | null
  createdAt?: Date | null
  updatedAt?: Date | null
}

interface VideoTaskOutputRecord {
  url?: string
  metadata?: Record<string, unknown>
}

interface VideoTaskRecord {
  _id: unknown
  orgId?: unknown
  outputVideoUrl?: string
  platformPostUrl?: string
  output?: VideoTaskOutputRecord | null
  metadata?: Record<string, unknown> | null
}

interface InvalidatedUrlResult {
  url: string
  objectPath: string
  deleted: boolean
  error?: string
}

interface OfflineVideoTaskResult {
  taskId: string
  orgId: string
  invalidatedUrls: InvalidatedUrlResult[]
  previousUrls: string[]
}

const OPEN_REQUEST_STATUSES = [
  ComplianceDeletionRequestStatus.PENDING,
  ComplianceDeletionRequestStatus.REVIEWING,
  ComplianceDeletionRequestStatus.APPROVED,
]

@Injectable()
export class ComplianceService {
  private readonly logger = new Logger(ComplianceService.name)
  private readonly managedAssetPrefixes = [config.assets.cdnEndpoint, config.assets.endpoint]
    .map(value => String(value || '').trim().replace(/\/+$/g, ''))
    .filter(Boolean)

  constructor(
    @InjectModel(ComplianceDeletionRequest.name)
    private readonly complianceDeletionRequestModel: Model<ComplianceDeletionRequest>,
    @InjectModel(VideoTask.name)
    private readonly videoTaskModel: Model<VideoTask>,
    private readonly auditService: AuditService,
    private readonly storage: StorageProvider,
  ) {}

  async createRequest(input: CreateComplianceDeletionRequestInput) {
    const contentUrl = this.normalizeOptionalString(input.contentUrl)
    const platformPostUrl = this.normalizeOptionalString(input.platformPostUrl)
    const reason = this.normalizeRequiredString(input.reason, 'reason')
    const requesterName = this.normalizeRequiredString(input.requesterName, 'requesterName')

    if (!contentUrl && !platformPostUrl) {
      throw new BadRequestException('contentUrl or platformPostUrl is required')
    }

    const duplicate = await this.findOpenDuplicate(contentUrl, platformPostUrl)
    if (duplicate) {
      throw new BadRequestException('A deletion request for the same content is already in progress')
    }

    const matchedTasks = await this.findMatchedVideoTasks(contentUrl, platformPostUrl)
    const publicTrackingToken = this.generatePublicTrackingToken()
    const created = await this.complianceDeletionRequestModel.create({
      status: ComplianceDeletionRequestStatus.PENDING,
      contentUrl,
      platformPostUrl,
      reason,
      description: this.normalizeOptionalString(input.description),
      requesterName,
      requesterEmail: this.normalizeOptionalString(input.requesterEmail),
      requesterPhone: this.normalizeOptionalString(input.requesterPhone),
      evidenceUrls: this.normalizeStringArray(input.evidenceUrls),
      source: this.normalizeOptionalString(input.source) || 'public_api',
      publicTrackingTokenHash: this.hashPublicTrackingToken(publicTrackingToken),
      publicTrackingTokenPreview: this.maskPublicTrackingToken(publicTrackingToken),
      matchedVideoTaskIds: matchedTasks.map(task => this.toObjectId(this.stringifyId(task._id), 'matchedVideoTaskId')),
      submittedAt: new Date(),
      metadata: {
        initialMatchCount: matchedTasks.length,
        initialMatchedVideoTaskIds: matchedTasks.map(task => this.stringifyId(task._id)),
      },
    })

    return this.toResponse(
      created.toObject() as ComplianceDeletionRequestRecord,
      {
        includePublicTrackingToken: publicTrackingToken,
      },
    )
  }

  async listRequests(query: ListComplianceDeletionRequestQuery) {
    const page = query.page && query.page > 0 ? query.page : 1
    const limit = Math.min(query.limit && query.limit > 0 ? query.limit : 20, 100)
    const skip = (page - 1) * limit
    const filters: Record<string, unknown> = {}

    if (query.status) {
      filters['status'] = query.status
    }

    const keyword = this.normalizeOptionalString(query.keyword)
    if (keyword) {
      const regex = new RegExp(this.escapeRegex(keyword), 'i')
      filters['$or'] = [
        { requestId: regex },
        { requesterName: regex },
        { requesterEmail: regex },
        { requesterPhone: regex },
        { contentUrl: regex },
        { platformPostUrl: regex },
      ]
    }

    const [items, total] = await Promise.all([
      this.complianceDeletionRequestModel.find(filters)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.complianceDeletionRequestModel.countDocuments(filters).exec(),
    ])

    return {
      items: items.map(item => this.toResponse(item as ComplianceDeletionRequestRecord)),
      pagination: {
        page,
        limit,
        total,
        totalPages: total > 0 ? Math.ceil(total / limit) : 0,
      },
    }
  }

  async reviewRequest(requestId: string, actorId: string, input: ReviewComplianceDeletionRequestInput) {
    const request = await this.findRequestOrFail(requestId)
    const action = input.action
    const reviewComment = this.normalizeOptionalString(input.comment)
    const reviewedAt = new Date()

    if (request.status === ComplianceDeletionRequestStatus.EXECUTED || request.status === ComplianceDeletionRequestStatus.REJECTED) {
      throw new BadRequestException('Deletion request can no longer be reviewed')
    }

    if (action === 'reviewing') {
      if (request.status !== ComplianceDeletionRequestStatus.PENDING && request.status !== ComplianceDeletionRequestStatus.REVIEWING) {
        throw new BadRequestException('Deletion request cannot be moved to reviewing')
      }

      const reviewing = await this.complianceDeletionRequestModel.findByIdAndUpdate(
        this.toObjectId(this.stringifyId(request._id), 'requestId'),
        {
          $set: {
            status: ComplianceDeletionRequestStatus.REVIEWING,
            reviewedBy: actorId,
            reviewedAt,
            reviewComment,
            executionError: '',
          },
        },
        { new: true },
      ).lean().exec()

      if (!reviewing) {
        throw new NotFoundException('Deletion request not found')
      }

      return this.toResponse(reviewing as ComplianceDeletionRequestRecord)
    }

    if (action === 'reject') {
      const rejected = await this.complianceDeletionRequestModel.findByIdAndUpdate(
        this.toObjectId(this.stringifyId(request._id), 'requestId'),
        {
          $set: {
            status: ComplianceDeletionRequestStatus.REJECTED,
            reviewedBy: actorId,
            reviewedAt,
            reviewComment,
          },
        },
        { new: true },
      ).lean().exec()

      if (!rejected) {
        throw new NotFoundException('Deletion request not found')
      }

      return this.toResponse(rejected as ComplianceDeletionRequestRecord)
    }

    const matchedTasks = await this.findMatchedVideoTasks(
      this.normalizeOptionalString(request.contentUrl),
      this.normalizeOptionalString(request.platformPostUrl),
    )

    if (matchedTasks.length === 0) {
      const approvedWithoutExecution = await this.complianceDeletionRequestModel.findByIdAndUpdate(
        this.toObjectId(this.stringifyId(request._id), 'requestId'),
        {
          $set: {
            status: ComplianceDeletionRequestStatus.APPROVED,
            reviewedBy: actorId,
            reviewedAt,
            reviewComment,
            matchedVideoTaskIds: [],
            executionError: 'No matched video content found for deletion request',
            executionResult: {
              affectedTasksCount: 0,
              invalidatedUrls: [],
            },
          },
        },
        { new: true },
      ).lean().exec()

      if (!approvedWithoutExecution) {
        throw new NotFoundException('Deletion request not found')
      }

      return this.toResponse(approvedWithoutExecution as ComplianceDeletionRequestRecord)
    }

    const approved = await this.complianceDeletionRequestModel.findByIdAndUpdate(
      this.toObjectId(this.stringifyId(request._id), 'requestId'),
      {
        $set: {
          status: ComplianceDeletionRequestStatus.APPROVED,
          reviewedBy: actorId,
          reviewedAt,
          reviewComment,
          matchedVideoTaskIds: matchedTasks.map(task => this.toObjectId(this.stringifyId(task._id), 'matchedVideoTaskId')),
          executionError: '',
        },
      },
      { new: true },
    ).lean().exec()

    if (!approved) {
      throw new NotFoundException('Deletion request not found')
    }

    return this.executeApprovedRequest(approved as ComplianceDeletionRequestRecord, actorId, matchedTasks)
  }

  async getPublicRequestStatus(requestId: string, token: string) {
    const normalizedToken = this.normalizeRequiredString(token, 'token')
    const request = await this.findRequestOrFail(requestId)
    const storedHash = this.normalizeOptionalString(request.publicTrackingTokenHash)
    if (!storedHash || storedHash !== this.hashPublicTrackingToken(normalizedToken)) {
      throw new BadRequestException('Invalid public tracking token')
    }

    return {
      requestId: request.requestId,
      status: request.status,
      contentUrl: this.normalizeOptionalString(request.contentUrl),
      platformPostUrl: this.normalizeOptionalString(request.platformPostUrl),
      reason: request.reason,
      description: this.normalizeOptionalString(request.description),
      requesterName: this.maskPublicName(request.requesterName),
      evidenceCount: this.normalizeStringArray(request.evidenceUrls).length,
      submittedAt: request.submittedAt || null,
      reviewedAt: request.reviewedAt || null,
      executedAt: request.executedAt || null,
      reviewComment: this.normalizeOptionalString(request.reviewComment),
      executionError: this.normalizeOptionalString(request.executionError),
      executionResult: request.executionResult || null,
      tracking: {
        preview: this.normalizeOptionalString(request.publicTrackingTokenPreview),
      },
    }
  }

  private async executeApprovedRequest(
    request: ComplianceDeletionRequestRecord,
    actorId: string,
    matchedTasks: VideoTaskRecord[],
  ) {
    const executedAt = new Date()
    const settledResults = await Promise.allSettled(
      matchedTasks.map(task => this.offlineVideoTask(task, request, actorId, executedAt)),
    )

    const successfulResults: OfflineVideoTaskResult[] = []
    const failedResults: Array<{ taskId: string, error: string }> = []

    settledResults.forEach((result, index) => {
      const taskId = this.stringifyId(matchedTasks[index]?._id)
      if (result.status === 'fulfilled') {
        successfulResults.push(result.value)
        return
      }

      const message = result.reason instanceof Error ? result.reason.message : String(result.reason)
      failedResults.push({
        taskId,
        error: message,
      })
      this.logger.error({
        message: 'Failed to offline video task for compliance deletion request',
        requestId: request.requestId,
        taskId,
        error: message,
      })
    })

    const invalidatedUrls = successfulResults.flatMap(result => result.invalidatedUrls)
    const affectedTaskIds = successfulResults.map(result => result.taskId)
    const executionResult = {
      affectedTasksCount: affectedTaskIds.length,
      affectedTaskIds,
      invalidatedUrls,
      failures: failedResults,
      requestedUrls: [
        this.normalizeOptionalString(request.contentUrl),
        this.normalizeOptionalString(request.platformPostUrl),
      ].filter(Boolean),
      executedAt: executedAt.toISOString(),
    }

    if (failedResults.length > 0) {
      const partiallyApproved = await this.complianceDeletionRequestModel.findByIdAndUpdate(
        this.toObjectId(this.stringifyId(request._id), 'requestId'),
        {
          $set: {
            status: ComplianceDeletionRequestStatus.APPROVED,
            executedBy: actorId,
            executionResult,
            executionError: `Failed to offline ${failedResults.length} video task(s)`,
          },
        },
        { new: true },
      ).lean().exec()

      if (!partiallyApproved) {
        throw new NotFoundException('Deletion request not found')
      }

      return this.toResponse(partiallyApproved as ComplianceDeletionRequestRecord)
    }

    const executed = await this.complianceDeletionRequestModel.findByIdAndUpdate(
      this.toObjectId(this.stringifyId(request._id), 'requestId'),
      {
        $set: {
          status: ComplianceDeletionRequestStatus.EXECUTED,
          executedBy: actorId,
          executedAt,
          executionResult,
          executionError: '',
        },
      },
      { new: true },
    ).lean().exec()

    if (!executed) {
      throw new NotFoundException('Deletion request not found')
    }

    const auditTargets = new Set(successfulResults.map(result => result.orgId).filter(Boolean))
    await Promise.all(
      [...auditTargets].map(orgId =>
        this.auditService.log({
          orgId,
          userId: actorId,
          action: 'compliance.deletion.executed',
          resource: 'compliance_deletion_request',
          resourceId: executed.requestId,
          target: affectedTaskIds.join(','),
          meta: {
            affectedTasksCount: affectedTaskIds.length,
            invalidatedUrlCount: invalidatedUrls.length,
          },
          details: executionResult,
        }),
      ),
    )

    return this.toResponse(executed as ComplianceDeletionRequestRecord)
  }

  private async offlineVideoTask(
    task: VideoTaskRecord,
    request: ComplianceDeletionRequestRecord,
    actorId: string,
    executedAt: Date,
  ): Promise<OfflineVideoTaskResult> {
    const taskId = this.stringifyId(task._id)
    const orgId = this.stringifyId(task.orgId)
    const outputUrl = this.normalizeOptionalString(task.outputVideoUrl)
    const nestedOutputUrl = this.normalizeOptionalString(task.output?.url)
    const platformPostUrl = this.normalizeOptionalString(task.platformPostUrl)
    const previousUrls = this.uniqueStrings([outputUrl, nestedOutputUrl, platformPostUrl])
    const invalidatedUrls = await this.invalidateManagedUrls([outputUrl, nestedOutputUrl])

    const updated = await this.videoTaskModel.findByIdAndUpdate(
      this.toObjectId(taskId, 'taskId'),
      {
        $set: {
          'outputVideoUrl': '',
          'platformPostUrl': '',
          'output.url': '',
          'metadata.compliance.deletion': {
            requestId: request.requestId,
            offline: true,
            reason: request.reason,
            description: this.normalizeOptionalString(request.description),
            requesterName: request.requesterName,
            requesterEmail: this.normalizeOptionalString(request.requesterEmail),
            requesterPhone: this.normalizeOptionalString(request.requesterPhone),
            executedAt: executedAt.toISOString(),
            executedBy: actorId,
            previousUrls,
            invalidatedUrls,
          },
        },
      },
      { new: true },
    ).lean().exec()

    if (!updated) {
      throw new NotFoundException(`Video task ${taskId} not found`)
    }

    return {
      taskId,
      orgId,
      invalidatedUrls,
      previousUrls,
    }
  }

  private async invalidateManagedUrls(urls: string[]) {
    const results: InvalidatedUrlResult[] = []

    for (const url of this.uniqueStrings(urls)) {
      const objectPath = this.extractManagedObjectPath(url)
      if (!objectPath) {
        continue
      }

      try {
        await this.storage.deleteObject(objectPath)
        results.push({
          url,
          objectPath,
          deleted: true,
        })
      }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        results.push({
          url,
          objectPath,
          deleted: false,
          error: message,
        })
        this.logger.warn({
          message: 'Failed to invalidate managed asset for compliance deletion request',
          url,
          objectPath,
          error: message,
        })
      }
    }

    return results
  }

  private extractManagedObjectPath(url: string) {
    const normalized = this.normalizeOptionalString(url)
    if (!normalized) {
      return null
    }

    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      return normalized.replace(/^\/+/, '')
    }

    const prefix = this.managedAssetPrefixes.find(candidate => normalized.startsWith(candidate))
    if (!prefix) {
      return null
    }

    const parsed = new URL(normalized)
    return decodeURIComponent(parsed.pathname.replace(/^\/+/, ''))
  }

  private async findOpenDuplicate(contentUrl: string, platformPostUrl: string) {
    const filters: Array<Record<string, unknown>> = []

    if (contentUrl) {
      filters.push({ contentUrl })
    }

    if (platformPostUrl) {
      filters.push({ platformPostUrl })
    }

    if (filters.length === 0) {
      return null
    }

    return this.complianceDeletionRequestModel.findOne({
      status: { $in: OPEN_REQUEST_STATUSES },
      $or: filters,
    }).lean().exec()
  }

  private async findMatchedVideoTasks(contentUrl: string, platformPostUrl: string) {
    const contentCandidates = this.buildComparableUrlCandidates(contentUrl)
    const platformCandidates = this.buildComparableUrlCandidates(platformPostUrl)
    const clauses: Array<Record<string, unknown>> = []

    if (contentCandidates.length > 0) {
      clauses.push({ outputVideoUrl: { $in: contentCandidates } })
      clauses.push({ 'output.url': { $in: contentCandidates } })
    }

    if (platformCandidates.length > 0) {
      clauses.push({ platformPostUrl: { $in: platformCandidates } })
    }

    if (clauses.length === 0) {
      return []
    }

    const tasks = await this.videoTaskModel.find({
      $or: clauses,
    }).lean().exec()

    return tasks as VideoTaskRecord[]
  }

  private buildComparableUrlCandidates(url: string) {
    const normalized = this.normalizeOptionalString(url)
    if (!normalized) {
      return []
    }

    const candidates = new Set<string>([normalized])
    const normalizedComparable = this.normalizeComparableUrl(normalized)
    if (normalizedComparable) {
      candidates.add(normalizedComparable)
    }

    const managedObjectPath = this.extractManagedObjectPath(normalized)
    if (managedObjectPath) {
      candidates.add(managedObjectPath)
      candidates.add(`/${managedObjectPath}`)
    }

    return [...candidates]
  }

  private normalizeComparableUrl(value: string) {
    const normalized = this.normalizeOptionalString(value)
    if (!normalized) {
      return ''
    }

    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      return normalized.replace(/\/+$/g, '')
    }

    try {
      const parsed = new URL(normalized)
      parsed.hash = ''
      if ((parsed.protocol === 'https:' && parsed.port === '443') || (parsed.protocol === 'http:' && parsed.port === '80')) {
        parsed.port = ''
      }
      parsed.pathname = parsed.pathname.replace(/\/+$/g, '') || '/'
      parsed.searchParams.sort()
      return parsed.toString()
    }
    catch {
      return normalized
    }
  }

  private async findRequestOrFail(requestId: string) {
    const normalized = this.normalizeRequiredString(requestId, 'requestId')
    const query = Types.ObjectId.isValid(normalized)
      ? { $or: [{ _id: new Types.ObjectId(normalized) }, { requestId: normalized }] }
      : { requestId: normalized }

    const request = await this.complianceDeletionRequestModel.findOne(query).lean().exec()
    if (!request) {
      throw new NotFoundException('Deletion request not found')
    }
    return request as ComplianceDeletionRequestRecord
  }

  private toResponse(
    record: ComplianceDeletionRequestRecord,
    options: {
      includePublicTrackingToken?: string
    } = {},
  ) {
    const response = {
      id: this.stringifyId(record._id),
      requestId: record.requestId,
      status: record.status,
      contentUrl: this.normalizeOptionalString(record.contentUrl),
      platformPostUrl: this.normalizeOptionalString(record.platformPostUrl),
      reason: record.reason,
      description: this.normalizeOptionalString(record.description),
      requesterName: record.requesterName,
      requesterEmail: this.normalizeOptionalString(record.requesterEmail),
      requesterPhone: this.normalizeOptionalString(record.requesterPhone),
      evidenceUrls: this.normalizeStringArray(record.evidenceUrls),
      source: this.normalizeOptionalString(record.source),
      matchedVideoTaskIds: (record.matchedVideoTaskIds || []).map(value => this.stringifyId(value)).filter(Boolean),
      submittedAt: record.submittedAt || null,
      reviewedBy: record.reviewedBy || null,
      reviewedAt: record.reviewedAt || null,
      reviewComment: this.normalizeOptionalString(record.reviewComment),
      executedBy: record.executedBy || null,
      executedAt: record.executedAt || null,
      executionResult: record.executionResult || null,
      executionError: this.normalizeOptionalString(record.executionError),
      metadata: record.metadata || {},
      createdAt: record.createdAt || null,
      updatedAt: record.updatedAt || null,
      tracking: {
        preview: this.normalizeOptionalString(record.publicTrackingTokenPreview),
        token: options.includePublicTrackingToken || undefined,
      },
    }

    return response
  }

  private normalizeRequiredString(value: string | undefined, field: string) {
    const normalized = this.normalizeOptionalString(value)
    if (!normalized) {
      throw new BadRequestException(`${field} is required`)
    }
    return normalized
  }

  private normalizeOptionalString(value?: string | null) {
    return String(value || '').trim()
  }

  private normalizeStringArray(values?: string[] | null) {
    return (values || []).map(value => this.normalizeOptionalString(value)).filter(Boolean)
  }

  private uniqueStrings(values: string[]) {
    return [...new Set(values.map(value => this.normalizeOptionalString(value)).filter(Boolean))]
  }

  private escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  private generatePublicTrackingToken() {
    return `cdr_${randomBytes(18).toString('hex')}`
  }

  private hashPublicTrackingToken(token: string) {
    return createHash('sha256')
      .update(this.normalizeRequiredString(token, 'token'))
      .digest('hex')
  }

  private maskPublicTrackingToken(token: string) {
    const normalized = this.normalizeRequiredString(token, 'token')
    return `${normalized.slice(0, 8)}***${normalized.slice(-4)}`
  }

  private maskPublicName(name?: string | null) {
    const normalized = this.normalizeOptionalString(name)
    if (!normalized) {
      return ''
    }

    if (normalized.length <= 2) {
      return `${normalized.slice(0, 1)}*`
    }

    return `${normalized.slice(0, 1)}${'*'.repeat(Math.max(1, normalized.length - 2))}${normalized.slice(-1)}`
  }

  private stringifyId(value: unknown) {
    if (!value) {
      return ''
    }
    if (value instanceof Types.ObjectId) {
      return value.toString()
    }
    if (typeof value === 'string') {
      return value
    }
    if (typeof value === 'object' && value !== null && 'toString' in value) {
      return value.toString()
    }
    return String(value)
  }

  private toObjectId(value: string, field: string) {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`${field} is invalid`)
    }
    return new Types.ObjectId(value)
  }
}
