import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { AuditLog } from '@yikart/mongodb'
import { FilterQuery, Model, Types } from 'mongoose'

interface AuditEvent {
  orgId: string
  userId?: string
  action: string
  resource: string
  resourceId?: string
  details?: Record<string, any>
  ipAddress?: string
  userAgent?: string
}

export interface AuditFilters {
  action?: string
  resource?: string
  resourceId?: string
  userId?: string
  startDate?: string
  endDate?: string
}

interface AuditPagination {
  page?: number
  limit?: number
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name)

  constructor(
    @InjectModel(AuditLog.name) private readonly auditLogModel: Model<AuditLog>,
  ) {}

  async log(event: AuditEvent) {
    if (!Types.ObjectId.isValid(event.orgId) || !event.action?.trim() || !event.resource?.trim()) {
      return null
    }

    try {
      return await this.auditLogModel.create({
        orgId: new Types.ObjectId(event.orgId),
        userId: event.userId || '',
        action: event.action.trim(),
        resource: event.resource.trim(),
        resourceId: event.resourceId || '',
        details: event.details || {},
        ipAddress: event.ipAddress || '',
        userAgent: event.userAgent || '',
      })
    }
    catch (error) {
      this.logger.error({
        message: 'Failed to persist audit log',
        error: error instanceof Error ? error.message : String(error),
        action: event.action,
        resource: event.resource,
      })
      return null
    }
  }

  async query(orgId: string, filters: AuditFilters, pagination: AuditPagination) {
    const page = Math.max(1, Number(pagination.page) || 1)
    const limit = Math.max(1, Math.min(Number(pagination.limit) || 20, 100))
    const skip = (page - 1) * limit
    const query = this.buildQuery(orgId, filters)

    const [items, total] = await Promise.all([
      this.auditLogModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean().exec(),
      this.auditLogModel.countDocuments(query),
    ])

    return {
      items: items.map(item => this.serializeLog(item)),
      total,
      page,
      limit,
    }
  }

  buildQuery(orgId: string, filters: AuditFilters = {}): FilterQuery<AuditLog> {
    if (!Types.ObjectId.isValid(orgId)) {
      throw new BadRequestException('orgId is invalid')
    }

    const query: FilterQuery<AuditLog> = {
      orgId: new Types.ObjectId(orgId),
    }

    if (filters.action) {
      query['action'] = filters.action
    }

    if (filters.resource) {
      query['resource'] = filters.resource
    }

    if (filters.resourceId) {
      query['resourceId'] = filters.resourceId
    }

    if (filters.userId) {
      query['userId'] = filters.userId
    }

    if (filters.startDate || filters.endDate) {
      query['createdAt'] = {}
      if (filters.startDate) {
        query['createdAt']['$gte'] = new Date(filters.startDate)
      }
      if (filters.endDate) {
        query['createdAt']['$lte'] = new Date(filters.endDate)
      }
    }

    return query
  }

  createExportCursor(orgId: string, filters: AuditFilters = {}) {
    const query = this.buildQuery(orgId, filters)
    return this.auditLogModel.find(query).sort({ createdAt: -1 }).lean().cursor()
  }

  serializeLog(item: Record<string, any>) {
    return {
      id: item['_id']?.toString?.() || '',
      orgId: item['orgId']?.toString?.() || null,
      userId: item['userId'] || '',
      userName: item['userName'] || '',
      action: item['action'] || '',
      resource: item['resource'] || '',
      target: item['target'] || '',
      resourceId: item['resourceId'] || '',
      details: item['details'] || {},
      meta: item['meta'] || {},
      ip: item['ip'] || '',
      ipAddress: item['ipAddress'] || '',
      userAgent: item['userAgent'] || '',
      createdAt: item['createdAt'] || null,
      updatedAt: item['updatedAt'] || null,
    }
  }
}
