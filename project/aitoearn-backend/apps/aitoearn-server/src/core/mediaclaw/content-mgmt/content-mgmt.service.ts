import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Organization, VideoTask, VideoTaskStatus } from '@yikart/mongodb'

interface ContentFilters {
  status?: VideoTaskStatus
  publishStatus?: string
  brandId?: string
  startDate?: string
  endDate?: string
}

interface PaginationInput {
  page?: number
  limit?: number
}

interface CopyUpdateInput {
  title?: string
  subtitle?: string
  hashtags?: string[]
}

@Injectable()
export class ContentMgmtService {
  constructor(
    @InjectModel(VideoTask.name)
    private readonly videoTaskModel: Model<VideoTask>,
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<Organization>,
  ) {}

  async editCopy(
    contentId: string,
    title?: string,
    subtitle?: string,
    hashtags?: string[],
  ) {
    const task = await this.getTaskOrFail(contentId)
    const nextCopy = {
      title: title ?? task.copy?.title ?? '',
      subtitle: subtitle ?? task.copy?.subtitle ?? '',
      hashtags: hashtags ?? task.copy?.hashtags ?? [],
      commentGuide: task.copy?.commentGuide ?? '',
    }

    const updated = await this.videoTaskModel.findByIdAndUpdate(
      task._id,
      {
        $set: {
          copy: nextCopy,
          'metadata.contentManagement.lastEditedAt': new Date().toISOString(),
        },
      },
      { new: true },
    ).lean().exec()

    if (!updated) {
      throw new NotFoundException('Content not found')
    }

    return this.toContentResponse(updated)
  }

  async markPublished(contentId: string, platform: string, publishUrl: string) {
    if (!platform?.trim()) {
      throw new BadRequestException('platform is required')
    }
    if (!publishUrl?.trim()) {
      throw new BadRequestException('publishUrl is required')
    }

    const task = await this.getTaskOrFail(contentId)
    const timestamp = new Date().toISOString()
    const updated = await this.videoTaskModel.findByIdAndUpdate(
      task._id,
      {
        $set: {
          'metadata.publishInfo': {
            platform: platform.trim(),
            publishUrl: publishUrl.trim(),
            publishedAt: timestamp,
          },
          'metadata.publishedAt': timestamp,
          'metadata.distribution.publishStatus': 'published',
          'metadata.distribution.lastStatusAt': timestamp,
        },
        $push: {
          'metadata.distribution.history': {
            status: 'published',
            timestamp,
            details: {
              platform: platform.trim(),
              publishUrl: publishUrl.trim(),
            },
          },
        },
      },
      { new: true },
    ).lean().exec()

    if (!updated) {
      throw new NotFoundException('Content not found')
    }

    return this.toContentResponse(updated)
  }

  async setStylePreferences(orgId: string, prefs: Record<string, unknown>) {
    const updated = await this.organizationModel.findByIdAndUpdate(
      this.toObjectId(orgId, 'orgId'),
      {
        $set: {
          'settings.contentManagement.stylePreferences': prefs || {},
        },
      },
      { new: true },
    ).lean().exec()

    if (!updated) {
      throw new NotFoundException('Organization not found')
    }

    return {
      orgId: updated._id.toString(),
      preferences: this.extractStylePreferences(updated),
    }
  }

  async getStylePreferences(orgId: string) {
    const organization = await this.organizationModel.findById(
      this.toObjectId(orgId, 'orgId'),
    ).lean().exec()

    if (!organization) {
      throw new NotFoundException('Organization not found')
    }

    return {
      orgId: organization._id.toString(),
      preferences: this.extractStylePreferences(organization),
    }
  }

  async listContent(
    orgId: string,
    filters: ContentFilters,
    pagination: PaginationInput,
  ) {
    const page = this.normalizePage(pagination.page)
    const limit = this.normalizeLimit(pagination.limit)
    const skip = (page - 1) * limit
    const query = this.buildQuery(orgId, filters)

    const [items, total] = await Promise.all([
      this.videoTaskModel.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.videoTaskModel.countDocuments(query),
    ])

    return {
      items: items.map(item => this.toContentResponse(item)),
      total,
      page,
      limit,
    }
  }

  async batchEditCopy(contentIds: string[], updates: CopyUpdateInput) {
    if (!Array.isArray(contentIds) || contentIds.length === 0) {
      throw new BadRequestException('contentIds is required')
    }

    const setPayload: Record<string, unknown> = {}
    if ('title' in updates) {
      setPayload['copy.title'] = updates.title ?? ''
    }
    if ('subtitle' in updates) {
      setPayload['copy.subtitle'] = updates.subtitle ?? ''
    }
    if ('hashtags' in updates) {
      setPayload['copy.hashtags'] = updates.hashtags ?? []
    }

    if (Object.keys(setPayload).length === 0) {
      throw new BadRequestException('updates is required')
    }

    setPayload['metadata.contentManagement.lastEditedAt'] = new Date().toISOString()

    const objectIds = contentIds.map(contentId => this.toObjectId(contentId, 'contentId'))
    const result = await this.videoTaskModel.updateMany(
      { _id: { $in: objectIds } },
      { $set: setPayload },
    ).exec()

    const updatedItems = await this.videoTaskModel.find({
      _id: { $in: objectIds },
    }).lean().exec()

    return {
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
      items: updatedItems.map(item => this.toContentResponse(item)),
    }
  }

  async exportContent(orgId: string, format: string, filters: ContentFilters) {
    const normalizedFormat = format.toLowerCase()
    const query = this.buildQuery(orgId, filters)
    const items = await this.videoTaskModel.find(query)
      .sort({ createdAt: -1 })
      .lean()
      .exec()

    const rows = items.map(item => this.toContentResponse(item))
    if (normalizedFormat === 'json') {
      return {
        format: 'json',
        fileName: `content-export-${new Date().toISOString()}.json`,
        mimeType: 'application/json',
        data: JSON.stringify(rows, null, 2),
      }
    }

    if (normalizedFormat === 'csv') {
      return {
        format: 'csv',
        fileName: `content-export-${new Date().toISOString()}.csv`,
        mimeType: 'text/csv',
        data: this.toCsv(rows),
      }
    }

    throw new BadRequestException('format must be csv or json')
  }

  async getContent(contentId: string) {
    const task = await this.videoTaskModel.findById(this.toObjectId(contentId, 'contentId')).lean().exec()
    if (!task) {
      throw new NotFoundException('Content not found')
    }

    return this.toContentResponse(task)
  }

  private buildQuery(orgId: string, filters: ContentFilters) {
    const query: Record<string, unknown> = {
      orgId: this.toObjectId(orgId, 'orgId'),
    }

    if (filters.status) {
      query['status'] = filters.status
    }

    if (filters.publishStatus) {
      query['metadata.distribution.publishStatus'] = filters.publishStatus
    }

    if (filters.brandId) {
      query['brandId'] = this.toObjectId(filters.brandId, 'brandId')
    }

    if (filters.startDate || filters.endDate) {
      const createdAt: Record<string, Date> = {}
      if (filters.startDate) {
        createdAt['$gte'] = new Date(filters.startDate)
      }
      if (filters.endDate) {
        createdAt['$lte'] = new Date(filters.endDate)
      }
      query['createdAt'] = createdAt
    }

    return query
  }

  private extractStylePreferences(organization: Record<string, any>) {
    return organization['settings']?.['contentManagement']?.['stylePreferences'] || {}
  }

  private toContentResponse(task: Record<string, any>) {
    return {
      id: task['_id']?.toString(),
      orgId: task['orgId']?.toString() || null,
      brandId: task['brandId']?.toString() || null,
      pipelineId: task['pipelineId']?.toString() || null,
      userId: task['userId'],
      taskType: task['taskType'],
      status: task['status'],
      sourceVideoUrl: task['sourceVideoUrl'],
      outputVideoUrl: task['outputVideoUrl'],
      copy: {
        title: task['copy']?.['title'] || '',
        subtitle: task['copy']?.['subtitle'] || '',
        hashtags: task['copy']?.['hashtags'] || [],
        commentGuide: task['copy']?.['commentGuide'] || '',
      },
      publishInfo: task['metadata']?.['publishInfo'] || null,
      publishStatus: task['metadata']?.['distribution']?.['publishStatus'] || null,
      createdAt: task['createdAt'],
      updatedAt: task['updatedAt'],
      startedAt: task['startedAt'] || null,
      completedAt: task['completedAt'] || null,
    }
  }

  private toCsv(rows: Array<Record<string, any>>) {
    const headers = [
      'id',
      'orgId',
      'brandId',
      'pipelineId',
      'userId',
      'taskType',
      'status',
      'title',
      'subtitle',
      'hashtags',
      'publishPlatform',
      'publishUrl',
      'publishStatus',
      'createdAt',
      'updatedAt',
    ]

    const lines = rows.map(row => [
      row['id'],
      row['orgId'],
      row['brandId'],
      row['pipelineId'],
      row['userId'],
      row['taskType'],
      row['status'],
      row['copy']?.['title'] || '',
      row['copy']?.['subtitle'] || '',
      Array.isArray(row['copy']?.['hashtags']) ? row['copy']['hashtags'].join('|') : '',
      row['publishInfo']?.['platform'] || '',
      row['publishInfo']?.['publishUrl'] || '',
      row['publishStatus'] || '',
      row['createdAt'] instanceof Date ? row['createdAt'].toISOString() : row['createdAt'] || '',
      row['updatedAt'] instanceof Date ? row['updatedAt'].toISOString() : row['updatedAt'] || '',
    ])

    return [
      headers.join(','),
      ...lines.map(columns => columns.map(column => this.escapeCsvValue(column)).join(',')),
    ].join('\n')
  }

  private escapeCsvValue(value: unknown) {
    const text = String(value ?? '')
    if (!text.includes(',') && !text.includes('"') && !text.includes('\n')) {
      return text
    }
    return `"${text.replace(/"/g, '""')}"`
  }

  private async getTaskOrFail(contentId: string) {
    const task = await this.videoTaskModel.findById(this.toObjectId(contentId, 'contentId')).exec()
    if (!task) {
      throw new NotFoundException('Content not found')
    }
    return task
  }

  private normalizePage(page?: number) {
    return Math.max(1, Math.trunc(Number(page) || 1))
  }

  private normalizeLimit(limit?: number) {
    return Math.max(1, Math.min(Math.trunc(Number(limit) || 20), 100))
  }

  private toObjectId(value: string, field: string) {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`${field} is invalid`)
    }

    return new Types.ObjectId(value)
  }
}
