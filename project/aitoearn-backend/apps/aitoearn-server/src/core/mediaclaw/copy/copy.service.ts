import type { GeneratedCopy } from './copy-engine.service'
import type { CopyHistoryQueryDto } from './copy.dto'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Brand, CopyHistory, VideoTask } from '@yikart/mongodb'
import { Model, Types } from 'mongoose'
import { CopyEngineService } from './copy-engine.service'
import { CopyStrategyService } from './copy-strategy.service'

export interface GenerateCopyHttpInput {
  videoTaskId?: string
  brandId?: string
  theme?: string
  platform?: string
  style?: string
  videoUrl?: string
  sourceHint?: string
  provider?: string
  count?: number
}

export interface InternalGenerateCopyInput extends GenerateCopyHttpInput {
  orgId?: string
  userId?: string
}

export interface RewriteCopyHttpInput {
  copyId: string
  instructions?: string
}

export interface RecordCopyPerformanceInput {
  copyHistoryId: string
  videoTaskId: string
  metrics?: {
    views?: number
    likes?: number
    comments?: number
    shares?: number
    saves?: number
    ctr?: number
  }
}

@Injectable()
export class CopyService {
  constructor(
    private readonly copyEngineService: CopyEngineService,
    private readonly copyStrategyService: CopyStrategyService,
    @InjectModel(Brand.name)
    private readonly brandModel: Model<Brand>,
    @InjectModel(VideoTask.name)
    private readonly videoTaskModel: Model<VideoTask>,
    @InjectModel(CopyHistory.name)
    private readonly copyHistoryModel: Model<CopyHistory>,
  ) {}

  async generateCopy(
    brandId: string | null | undefined,
    videoUrl: string,
    metadata: Record<string, any> = {},
  ): Promise<GeneratedCopy> {
    return this.copyEngineService.generateCopy(brandId, videoUrl, metadata)
  }

  generateBlueWords(title: string, keywords: string[] = []) {
    return this.copyEngineService.generateBlueWords(title, keywords)
  }

  generateCommentGuide(brand: string, content: string) {
    return this.copyEngineService.generateCommentGuide(brand, content)
  }

  generateABVariants(baseTitle: string, count?: number) {
    return this.copyEngineService.generateABVariants(baseTitle, count)
  }

  async generateForHttp(
    orgId: string,
    userId: string,
    body: GenerateCopyHttpInput,
  ) {
    const normalizedCount = Math.min(Math.max(Math.trunc(Number(body.count) || 1), 1), 3)
    const task = await this.findVideoTaskForOrg(orgId, body.videoTaskId)
    const taskMetadata = this.toPlainObject(task?.metadata)
    const resolvedOrgId = this.normalizeObjectIdString(task?.orgId)
      || this.normalizeObjectIdString(orgId)
      || null
    const requestedBrandId = this.normalizeObjectIdString(body.brandId)
    const resolvedBrandId = requestedBrandId
      || this.normalizeObjectIdString(task?.brandId)
      || null
    const brand = requestedBrandId
      ? await this.findBrandForOrg(orgId, requestedBrandId)
      : null
    const taskBrandId = this.normalizeObjectIdString(task?.brandId)
    if (requestedBrandId) {
      this.assertOrgAccess(orgId, brand?.orgId?.toString() || null, 'Brand')
    }
    const resolvedTaskId = this.normalizeObjectIdString(task?._id) || null
    const resolvedVideoUrl = task?.outputVideoUrl?.trim()
      || task?.sourceVideoUrl?.trim()
      || this.readString(task?.source?.url)
      || body.videoUrl?.trim()
      || ''
    const copies: Array<GeneratedCopy & {
      copyHistoryId: string | null
      variantIndex: number
      variantGroupId: string | null
    }> = []
    const variantGroupId = normalizedCount > 1
      ? new Types.ObjectId().toString()
      : null

    for (let index = 0; index < normalizedCount; index += 1) {
      const generated = await this.copyEngineService.generateCopyRecord(
        resolvedBrandId,
        resolvedVideoUrl,
        {
          ...taskMetadata,
          orgId: resolvedOrgId,
          userId: this.normalizeObjectIdString(userId) || userId,
          taskId: resolvedTaskId,
          brandId: resolvedBrandId || taskBrandId || this.normalizeObjectIdString(brand?._id),
          theme: body.theme?.trim() || this.readMetadataString(taskMetadata, 'theme'),
          scene: body.theme?.trim()
            || this.readMetadataString(taskMetadata, 'scene')
            || this.readMetadataString(taskMetadata, 'campaign')
            || this.readMetadataString(taskMetadata, 'platform')
            || '内容分发',
          platform: body.platform?.trim() || this.readMetadataString(taskMetadata, 'platform'),
          style: body.style?.trim() || this.readMetadataString(taskMetadata, 'style'),
          sourceHint: body.sourceHint?.trim() || this.readMetadataString(taskMetadata, 'sourceHint'),
          copyProvider: body.provider?.trim().toLowerCase(),
          variantIndex: index + 1,
          variantGroupId,
          variantGoal: normalizedCount > 1
            ? `生成第 ${index + 1} 个版本，与已生成候选保持明显差异。`
            : '',
          avoidTitles: copies.map(item => item.title),
          source: 'copy-generate-endpoint',
        },
        {
          replaceExistingForTask: false,
        },
      )

      copies.push(this.toCopyHistoryPayload(
        generated.copy,
        generated.copyHistoryId,
        index + 1,
        variantGroupId,
      ))
    }

    return {
      videoTaskId: resolvedTaskId,
      brandId: resolvedBrandId,
      count: copies.length,
      primaryCopy: copies[0] || null,
      copies,
    }
  }

  async generateForInternal(body: InternalGenerateCopyInput) {
    const normalizedCount = Math.min(Math.max(Math.trunc(Number(body.count) || 1), 1), 3)
    const task = await this.findVideoTask(body.videoTaskId)
    const taskMetadata = this.toPlainObject(task?.metadata)
    const requestedBrandId = this.normalizeObjectIdString(body.brandId)
    const brand = requestedBrandId
      ? await this.findBrand(requestedBrandId)
      : null
    const resolvedBrandId = requestedBrandId
      || this.normalizeObjectIdString(task?.brandId)
      || null
    const resolvedOrgId = this.normalizeObjectIdString(body.orgId)
      || this.normalizeObjectIdString(task?.orgId)
      || this.normalizeObjectIdString(brand?.orgId)
      || null
    const resolvedUserId = this.normalizeObjectIdString(body.userId)
      || body.userId
      || null
    const resolvedTaskId = this.normalizeObjectIdString(task?._id) || null
    const resolvedVideoUrl = task?.outputVideoUrl?.trim()
      || task?.sourceVideoUrl?.trim()
      || this.readString(task?.source?.url)
      || body.videoUrl?.trim()
      || ''
    const copies: Array<GeneratedCopy & {
      copyHistoryId: string | null
      variantIndex: number
      variantGroupId: string | null
    }> = []
    const variantGroupId = normalizedCount > 1
      ? new Types.ObjectId().toString()
      : null

    for (let index = 0; index < normalizedCount; index += 1) {
      const generated = await this.copyEngineService.generateCopyRecord(
        resolvedBrandId,
        resolvedVideoUrl,
        {
          ...taskMetadata,
          orgId: resolvedOrgId,
          userId: resolvedUserId,
          taskId: resolvedTaskId,
          brandId: resolvedBrandId,
          theme: body.theme?.trim() || this.readMetadataString(taskMetadata, 'theme'),
          scene: body.theme?.trim()
            || this.readMetadataString(taskMetadata, 'scene')
            || this.readMetadataString(taskMetadata, 'campaign')
            || this.readMetadataString(taskMetadata, 'platform')
            || '内容分发',
          platform: body.platform?.trim() || this.readMetadataString(taskMetadata, 'platform'),
          style: body.style?.trim() || this.readMetadataString(taskMetadata, 'style'),
          sourceHint: body.sourceHint?.trim() || this.readMetadataString(taskMetadata, 'sourceHint'),
          copyProvider: body.provider?.trim().toLowerCase(),
          variantIndex: index + 1,
          variantGroupId,
          variantGoal: normalizedCount > 1
            ? `生成第 ${index + 1} 个版本，与已生成候选保持明显差异。`
            : '',
          avoidTitles: copies.map(item => item.title),
          source: 'copy-internal-endpoint',
        },
        {
          replaceExistingForTask: false,
        },
      )

      copies.push(this.toCopyHistoryPayload(
        generated.copy,
        generated.copyHistoryId,
        index + 1,
        variantGroupId,
      ))
    }

    return {
      videoTaskId: resolvedTaskId,
      brandId: resolvedBrandId,
      count: copies.length,
      primaryCopy: copies[0] || null,
      copies,
    }
  }

  async rewriteForHttp(
    orgId: string,
    userId: string,
    body: RewriteCopyHttpInput,
  ) {
    const normalizedCopyId = this.requireObjectId(body.copyId, 'copyId')
    const copyHistory = await this.copyHistoryModel.findById(new Types.ObjectId(normalizedCopyId)).exec()

    if (!copyHistory) {
      throw new NotFoundException('Copy history not found')
    }

    this.assertOrgAccess(orgId, copyHistory.orgId?.toString() || null, 'Copy history')

    const taskId = this.normalizeObjectIdString(copyHistory.taskId)
    const task = taskId
      ? await this.videoTaskModel.findById(new Types.ObjectId(taskId)).exec()
      : null

    if (task) {
      this.assertOrgAccess(orgId, task.orgId?.toString() || null, 'Video task')
    }

    const taskMetadata = this.toPlainObject(task?.metadata)
    const rewritten = await this.copyEngineService.rewriteCopyRecord(
      copyHistory,
      this.normalizeObjectIdString(task?.brandId),
      body.instructions,
      {
        ...taskMetadata,
        orgId: copyHistory.orgId?.toString() || this.normalizeObjectIdString(orgId),
        userId: this.normalizeObjectIdString(userId) || userId,
        taskId,
        platform: this.readMetadataString(taskMetadata, 'platform'),
        style: this.readMetadataString(taskMetadata, 'style'),
        source: 'copy-rewrite-endpoint',
      },
      {
        replaceExistingForTask: false,
      },
    )

    return {
      sourceCopyId: normalizedCopyId,
      copyHistoryId: rewritten.copyHistoryId,
      copy: rewritten.copy,
    }
  }

  async recordPerformance(orgId: string, body: RecordCopyPerformanceInput) {
    return this.copyStrategyService.recordCopyPerformance(
      this.requireObjectId(orgId, 'orgId'),
      body.copyHistoryId,
      body.videoTaskId,
      body.metrics || {},
    )
  }

  async getInsights(orgId: string, period = '30d') {
    return this.copyStrategyService.getCopyInsights(
      this.requireObjectId(orgId, 'orgId'),
      period,
    )
  }

  async getTopPatterns(orgId: string, platform?: string, limit?: number) {
    return this.copyStrategyService.getTopPerformingPatterns(
      this.requireObjectId(orgId, 'orgId'),
      platform,
      limit,
    )
  }

  async listHistory(orgId: string, query: CopyHistoryQueryDto = {}) {
    const normalizedOrgId = this.requireObjectId(orgId, 'orgId')
    const normalizedPage = Math.max(Math.trunc(Number(query.page) || 1), 1)
    const normalizedLimit = Math.min(Math.max(Math.trunc(Number(query.limit) || 20), 1), 100)
    const matchStage: Record<string, unknown> = {
      orgId: new Types.ObjectId(normalizedOrgId),
    }

    if (query.videoTaskId) {
      matchStage['taskId'] = new Types.ObjectId(this.requireObjectId(query.videoTaskId, 'videoTaskId'))
    }

    const [total, items] = await Promise.all([
      this.copyHistoryModel.countDocuments(matchStage).exec(),
      this.copyHistoryModel.find(matchStage)
        .sort({ createdAt: -1, _id: -1 })
        .skip((normalizedPage - 1) * normalizedLimit)
        .limit(normalizedLimit)
        .lean()
        .exec() as Promise<Array<Record<string, any>>>,
    ])

    return {
      page: normalizedPage,
      limit: normalizedLimit,
      total,
      items: items.map(item => this.serializeCopyHistory(item)),
    }
  }

  async getHistory(orgId: string, copyId: string) {
    const normalizedOrgId = this.requireObjectId(orgId, 'orgId')
    const normalizedCopyId = this.requireObjectId(copyId, 'copyId')
    const item = await this.copyHistoryModel.findById(new Types.ObjectId(normalizedCopyId)).lean().exec() as Record<string, any> | null

    if (!item) {
      throw new NotFoundException('Copy history not found')
    }

    this.assertOrgAccess(normalizedOrgId, this.normalizeObjectIdString(item['orgId']), 'Copy history')
    return this.serializeCopyHistory(item)
  }

  private async findVideoTaskForOrg(orgId: string, videoTaskId?: string) {
    if (!videoTaskId) {
      return null
    }

    const normalizedVideoTaskId = this.requireObjectId(videoTaskId, 'videoTaskId')
    const task = await this.videoTaskModel.findById(new Types.ObjectId(normalizedVideoTaskId)).exec()
    if (!task) {
      throw new NotFoundException('Video task not found')
    }

    this.assertOrgAccess(orgId, task.orgId?.toString() || null, 'Video task')
    return task
  }

  private async findVideoTask(videoTaskId?: string) {
    if (!videoTaskId) {
      return null
    }

    const normalizedVideoTaskId = this.requireObjectId(videoTaskId, 'videoTaskId')
    return this.videoTaskModel.findById(new Types.ObjectId(normalizedVideoTaskId)).exec()
  }

  private async findBrandForOrg(orgId: string, brandId: string) {
    const brand = await this.findBrand(brandId)
    if (!brand) {
      throw new NotFoundException('Brand not found')
    }

    this.assertOrgAccess(orgId, brand.orgId?.toString() || null, 'Brand')
    return brand
  }

  private async findBrand(brandId: string) {
    const normalizedBrandId = this.requireObjectId(brandId, 'brandId')
    return this.brandModel.findById(new Types.ObjectId(normalizedBrandId)).exec()
  }

  private serializeCopyHistory(item: Record<string, any>) {
    const commentGuides = Array.isArray(item['commentGuides'])
      ? item['commentGuides']
        .map(candidate => this.readString(candidate))
        .filter(Boolean)
      : this.readString(item['commentGuide'])
          .split('\n')
          .map(candidate => candidate.trim())
          .filter(Boolean)

    return {
      id: item['_id']?.toString?.() || null,
      orgId: this.normalizeObjectIdString(item['orgId']),
      taskId: this.normalizeObjectIdString(item['taskId']),
      title: this.readString(item['title']),
      subtitle: this.readString(item['subtitle']),
      description: this.readString(item['description']) || this.readString(item['subtitle']),
      hashtags: Array.isArray(item['hashtags']) ? item['hashtags'] : [],
      blueWords: Array.isArray(item['blueWords']) ? item['blueWords'] : [],
      commentGuide: this.readString(item['commentGuide']),
      commentGuides,
      variantIndex: Number.isFinite(Number(item['variantIndex']))
        ? Number(item['variantIndex'])
        : null,
      variantGroupId: this.readString(item['variantGroupId']) || null,
      variantGoal: this.readString(item['variantGoal']) || '',
      dedupFingerprint: this.readString(item['dedupFingerprint']) || '',
      variantPerformance: this.toPlainObject(item['variantPerformance']),
      bestPerformer: Boolean(item['variantPerformance']?.['bestPerformer']),
      performance: this.toPlainObject(item['performance']),
      createdAt: item['createdAt'] || null,
      updatedAt: item['updatedAt'] || null,
    }
  }

  private toCopyHistoryPayload(
    copy: GeneratedCopy,
    copyHistoryId: string | null,
    variantIndex: number,
    variantGroupId: string | null,
  ) {
    return {
      copyHistoryId,
      variantIndex,
      variantGroupId,
      ...copy,
    }
  }

  private assertOrgAccess(currentOrgId: string, resourceOrgId: string | null, resourceName: string) {
    const normalizedCurrentOrgId = this.normalizeObjectIdString(currentOrgId)
    if (!normalizedCurrentOrgId || !resourceOrgId) {
      return
    }

    if (normalizedCurrentOrgId !== resourceOrgId) {
      throw new NotFoundException(`${resourceName} not found`)
    }
  }

  private requireObjectId(value: string, field: string) {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`${field} is invalid`)
    }

    return value
  }

  private normalizeObjectIdString(value: unknown) {
    if (!value) {
      return null
    }

    if (typeof value === 'string') {
      return Types.ObjectId.isValid(value) ? value : null
    }

    if (value instanceof Types.ObjectId) {
      return value.toString()
    }

    if (typeof (value as { toString?: () => string }).toString === 'function') {
      const normalized = (value as { toString: () => string }).toString()
      return Types.ObjectId.isValid(normalized) ? normalized : null
    }

    return null
  }

  private readMetadataString(metadata: Record<string, unknown>, key: string) {
    const value = metadata[key]
    return typeof value === 'string' ? value.trim() : ''
  }

  private toPlainObject(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {}
    }

    return value as Record<string, unknown>
  }

  private readString(value: unknown) {
    return typeof value === 'string' ? value.trim() : ''
  }
}

export type { GeneratedCopy, GeneratedCopyRecord } from './copy-engine.service'
