import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { CopyHistory, VideoTask } from '@yikart/mongodb'
import { Model, Types } from 'mongoose'
import { CopyEngineService } from './copy-engine.service'
import type { GeneratedCopy } from './copy-engine.service'
import { CopyStrategyService } from './copy-strategy.service'

export interface GenerateCopyHttpInput {
  videoTaskId?: string
  brandId?: string
  theme?: string
  platform?: string
  style?: string
  count?: number
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
    const normalizedCount = Math.min(Math.max(Math.trunc(Number(body.count) || 1), 1), 5)
    const task = await this.findVideoTaskForOrg(orgId, body.videoTaskId)
    const taskMetadata = this.toPlainObject(task?.metadata)
    const resolvedOrgId = this.normalizeObjectIdString(task?.orgId)
      || this.normalizeObjectIdString(orgId)
      || null
    const resolvedBrandId = this.normalizeObjectIdString(body.brandId)
      || this.normalizeObjectIdString(task?.brandId)
      || null
    const resolvedTaskId = this.normalizeObjectIdString(task?._id) || null
    const resolvedVideoUrl = task?.outputVideoUrl?.trim()
      || task?.sourceVideoUrl?.trim()
      || this.readString(task?.source?.url)
      || ''
    const copies: Array<GeneratedCopy & {
      copyHistoryId: string | null
      variantIndex: number
    }> = []

    for (let index = 0; index < normalizedCount; index += 1) {
      const generated = await this.copyEngineService.generateCopyRecord(
        resolvedBrandId,
        resolvedVideoUrl,
        {
          ...taskMetadata,
          orgId: resolvedOrgId,
          userId: this.normalizeObjectIdString(userId) || userId,
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

      copies.push({
        variantIndex: index + 1,
        copyHistoryId: generated.copyHistoryId,
        ...generated.copy,
      })
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
