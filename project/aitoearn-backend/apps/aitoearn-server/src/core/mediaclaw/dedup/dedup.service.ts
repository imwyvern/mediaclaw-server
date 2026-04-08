import { createHash } from 'node:crypto'
import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { ContentHash, VideoTask, VideoTaskStatus } from '@yikart/mongodb'
import { Model, Types } from 'mongoose'
import { AiJudgeResult, AiJudgeService } from './ai-judge.service'
import { EmbeddingService } from './embedding.service'
import { MilvusService } from './milvus.service'

type ContentHashRecord = Record<string, any>
type VideoTaskRecord = Record<string, any>
type DedupPhase = 'url_match' | 'vector_recall' | 'ai_judge' | 'passed' | 'error'
type DedupDecisionStatus = 'passed' | 'duplicate' | 'error'

export interface DedupCandidateMatch {
  score: number
  phase: 'vector_recall' | 'ai_judge'
  url: string
  imageUrl?: string
  recordId?: string
  aiJudge?: AiJudgeResult | null
}

export interface DedupCheckV2Result {
  isDuplicate: boolean
  phase: DedupPhase
  score: number
  level: number
  reason: string
  matchedUrl?: string
  matchedRecordId?: string
  aiJudge?: AiJudgeResult | null
  matches?: DedupCandidateMatch[]
}

export interface DedupBatchItem {
  contentUrl: string
  imageUrl?: string
  externalId?: string
}

export interface DedupBatchResultItem extends DedupCheckV2Result {
  contentUrl: string
  imageUrl?: string
  externalId?: string
  status: DedupDecisionStatus
}

export interface DedupBatchSummary {
  total: number
  passed: number
  duplicate: number
  error: number
  items: DedupBatchResultItem[]
  results: DedupBatchResultItem[]
}

export interface DedupBatchTaskSummary extends DedupBatchSummary {
  batchId: string
  passedTaskIds: string[]
  blockedTaskIds: string[]
  errorTaskIds: string[]
}

const VECTOR_SIMILARITY_THRESHOLD = 0.85
const DIRECT_DUPLICATE_THRESHOLD = 0.95
const VECTOR_TOP_K = 5

@Injectable()
export class DedupService {
  private readonly logger = new Logger(DedupService.name)

  constructor(
    @InjectModel(ContentHash.name)
    private readonly contentHashModel: Model<ContentHash>,
    @InjectModel(VideoTask.name)
    private readonly videoTaskModel: Model<VideoTask>,
    private readonly milvusService: MilvusService,
    private readonly embeddingService: EmbeddingService,
    private readonly aiJudgeService: AiJudgeService,
  ) {}

  // ── Legacy methods (backward compatible) ──────────────────────────

  async checkDuplicate(orgId: string, content: string, contentType = 'video_task') {
    const normalizedOrgId = this.toObjectId(orgId, 'orgId')
    const normalizedContent = this.normalizeContent(content)
    if (!normalizedContent) {
      throw new BadRequestException('content is required')
    }

    const hash = this.createContentHash(normalizedContent)
    const existing = await this.contentHashModel.findOne({
      orgId: normalizedOrgId,
      hash,
    }).lean().exec() as ContentHashRecord | null

    return {
      orgId,
      contentType: contentType.trim() || 'video_task',
      hash,
      isDuplicate: Boolean(existing),
      existing: existing ? this.serializeContentHash(existing) : null,
    }
  }

  async registerContent(orgId: string, content: string, videoTaskId: string, contentType = 'video_task') {
    const normalizedOrgId = this.toObjectId(orgId, 'orgId')
    const normalizedVideoTaskId = this.toObjectId(videoTaskId, 'videoTaskId')
    const normalizedContent = this.normalizeContent(content)
    if (!normalizedContent) {
      throw new BadRequestException('content is required')
    }

    const hash = this.createContentHash(normalizedContent)
    const document = await this.contentHashModel.findOneAndUpdate(
      {
        orgId: normalizedOrgId,
        projectId: null,
        hash,
      },
      {
        $set: {
          videoTaskId: normalizedVideoTaskId,
          contentType: contentType.trim() || 'video_task',
        },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      },
    ).lean().exec() as ContentHashRecord | null

    return document ? this.serializeContentHash(document) : null
  }

  async getDeduplicationStats(orgId: string) {
    const normalizedOrgId = this.toObjectId(orgId, 'orgId')
    const [totalHashes, byType, recentItems] = await Promise.all([
      this.contentHashModel.countDocuments({ orgId: normalizedOrgId }),
      this.contentHashModel.aggregate<{ _id: string, count: number }>([
        { $match: { orgId: normalizedOrgId } },
        {
          $group: {
            _id: '$contentType',
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1, _id: 1 } },
      ]).exec(),
      this.contentHashModel.find({ orgId: normalizedOrgId })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean()
        .exec() as Promise<ContentHashRecord[]>,
    ])

    return {
      orgId,
      totalHashes,
      byType: byType.map(item => ({
        contentType: item._id || 'video_task',
        count: Number(item.count || 0),
      })),
      recentItems: recentItems.map(item => this.serializeContentHash(item)),
      strategy: 'three_layer_pipeline',
    }
  }

  // ── V2: Three-layer pipeline ──────────────────────────────────────

  async checkDuplicateV2(
    orgId: string,
    projectId: string,
    contentUrl: string,
    imageUrl?: string,
  ): Promise<DedupCheckV2Result> {
    const normalizedContentUrl = contentUrl?.trim()
    if (!normalizedContentUrl) {
      throw new BadRequestException('contentUrl is required')
    }

    const normalizedProjectId = this.normalizeProjectId(projectId)

    const phase1 = await this.checkUrlMatch(orgId, normalizedProjectId, normalizedContentUrl)
    if (phase1) {
      return phase1
    }

    const normalizedImageUrl = imageUrl?.trim()
    if (normalizedImageUrl) {
      const phase2 = await this.checkVectorRecall(
        orgId,
        normalizedProjectId,
        normalizedContentUrl,
        normalizedImageUrl,
      )
      if (phase2) {
        return phase2
      }
    }

    return {
      isDuplicate: false,
      phase: 'passed',
      score: 0,
      level: 0,
      reason: 'Content passed all dedup checks',
      matches: [],
    }
  }

  async batchCheckDuplicate(
    orgId: string,
    projectId: string,
    items: DedupBatchItem[],
  ): Promise<DedupBatchSummary> {
    if (!Array.isArray(items)) {
      throw new BadRequestException('items is required')
    }

    const results: DedupBatchResultItem[] = []
    for (const item of items) {
      const contentUrl = item.contentUrl?.trim()
      const imageUrl = item.imageUrl?.trim()

      if (!contentUrl) {
        results.push(this.buildBatchErrorItem(item, 'contentUrl is required'))
        continue
      }

      try {
        const result = await this.checkDuplicateV2(
          orgId,
          projectId,
          contentUrl,
          imageUrl,
        )

        results.push({
          ...result,
          contentUrl,
          imageUrl,
          externalId: item.externalId,
          status: result.isDuplicate ? 'duplicate' : 'passed',
        })
      }
      catch (error) {
        results.push(
          this.buildBatchErrorItem(
            {
              ...item,
              contentUrl,
              imageUrl,
            },
            error instanceof Error ? error.message : String(error),
          ),
        )
      }
    }

    return this.buildBatchSummary(results)
  }

  async batchCheckDuplicateByBatch(
    orgId: string,
    projectId: string,
    batchId: string,
  ): Promise<DedupBatchTaskSummary> {
    const normalizedOrgId = this.toObjectId(orgId, 'orgId')
    const normalizedBatchId = this.toObjectId(batchId, 'batchId')
    const normalizedProjectId = this.normalizeProjectId(projectId)

    const tasks = await this.videoTaskModel.find({
      orgId: normalizedOrgId,
      batchId: normalizedBatchId,
      status: {
        $in: [
          VideoTaskStatus.COMPLETED,
          VideoTaskStatus.APPROVED,
          VideoTaskStatus.PUBLISHED,
        ],
      },
      $or: [
        { outputVideoUrl: { $exists: true, $ne: '' } },
        { 'output.url': { $exists: true, $ne: '' } },
      ],
    }).lean().exec() as VideoTaskRecord[]

    if (tasks.length === 0) {
      return {
        batchId,
        passedTaskIds: [],
        blockedTaskIds: [],
        errorTaskIds: [],
        ...this.buildBatchSummary([]),
      }
    }

    const summary = await this.batchCheckDuplicate(
      orgId,
      normalizedProjectId,
      tasks.map(task => ({
        externalId: task['_id']?.toString?.() || '',
        contentUrl: this.resolveTaskContentUrl(task),
        imageUrl: this.resolveTaskImageUrl(task),
      })),
    )

    const resultByTaskId = new Map(
      summary.items
        .map(result => [result.externalId || '', result] as const)
        .filter(([taskId]) => Boolean(taskId)),
    )

    const passedTaskIds: string[] = []
    const blockedTaskIds: string[] = []
    const errorTaskIds: string[] = []
    const finalResults: DedupBatchResultItem[] = []

    for (const task of tasks) {
      const taskId = task['_id']?.toString?.() || ''
      const result = resultByTaskId.get(taskId)
      if (!result) {
        continue
      }

      let finalResult = result

      try {
        const registration = finalResult.status === 'passed'
          ? await this.registerContentV2(
              orgId,
              normalizedProjectId,
              finalResult.contentUrl,
              finalResult.imageUrl,
              taskId,
            )
          : null

        await this.persistBatchResult(
          taskId,
          normalizedProjectId,
          finalResult,
          registration,
        )

        if (finalResult.status === 'passed') {
          passedTaskIds.push(taskId)
        }
        else if (finalResult.status === 'duplicate') {
          blockedTaskIds.push(taskId)
        }
        else {
          errorTaskIds.push(taskId)
        }
      }
      catch (error) {
        finalResult = this.buildBatchErrorItem(
          {
            contentUrl: finalResult.contentUrl,
            imageUrl: finalResult.imageUrl,
            externalId: taskId,
          },
          error instanceof Error ? error.message : String(error),
        )
        await this.persistBatchResult(taskId, normalizedProjectId, finalResult, null)
        errorTaskIds.push(taskId)
      }

      finalResults.push(finalResult)
    }

    const finalSummary = this.buildBatchSummary(finalResults)
    return {
      batchId,
      passedTaskIds,
      blockedTaskIds,
      errorTaskIds,
      ...finalSummary,
    }
  }

  async registerContentV2(
    orgId: string,
    projectId: string,
    contentUrl: string,
    imageUrl: string | undefined,
    recordId: string,
  ) {
    const normalizedOrgId = this.toObjectId(orgId, 'orgId')
    const normalizedProjectId = this.normalizeProjectId(projectId)
    const normalizedContentUrl = contentUrl?.trim()
    const normalizedImageUrl = imageUrl?.trim() || ''

    if (!normalizedContentUrl) {
      throw new BadRequestException('contentUrl is required')
    }

    const hash = this.createContentHash(normalizedContentUrl.toLowerCase())
    const mongoDoc = await this.contentHashModel.findOneAndUpdate(
      {
        orgId: normalizedOrgId,
        projectId: normalizedProjectId,
        hash,
      },
      {
        $set: {
          videoTaskId: recordId ? this.toObjectId(recordId, 'recordId') : undefined,
          contentType: 'content_url',
          projectId: normalizedProjectId,
          url: normalizedContentUrl,
          imageUrl: normalizedImageUrl,
          metadata: {
            source: 'dedup_v2',
            registeredAt: new Date().toISOString(),
          },
        },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      },
    ).lean().exec() as ContentHashRecord | null

    let milvusInserted = false
    if (normalizedImageUrl) {
      const embedding = await this.embeddingService.getEmbedding(normalizedImageUrl)
      if (embedding) {
        milvusInserted = await this.milvusService.insert(normalizedProjectId, {
          record_id: this.stringToNumericId(recordId),
          project_id: normalizedProjectId,
          url: normalizedContentUrl,
          embedding,
          created_at: Math.floor(Date.now() / 1000),
        })
      }
    }

    return {
      mongo: mongoDoc ? this.serializeContentHash(mongoDoc) : null,
      milvusInserted,
      contentUrl: normalizedContentUrl,
      imageUrl: normalizedImageUrl || null,
      projectId: normalizedProjectId,
    }
  }

  // ── Phase implementations ─────────────────────────────────────────

  private async checkUrlMatch(
    orgId: string,
    projectId: string,
    contentUrl: string,
  ): Promise<DedupCheckV2Result | null> {
    const existing = await this.findContentHashByUrl(orgId, projectId, contentUrl)
    if (!existing) {
      return null
    }

    return {
      isDuplicate: true,
      phase: 'url_match',
      score: 100,
      level: 5,
      reason: 'URL exact match found in content hash store',
      matchedUrl: existing['url'] || contentUrl,
      matchedRecordId:
        existing['videoTaskId']?.toString?.()
        || existing['_id']?.toString?.()
        || null
        || undefined,
      matches: [
        {
          score: 100,
          phase: 'vector_recall',
          url: existing['url'] || contentUrl,
          imageUrl: typeof existing['imageUrl'] === 'string' ? existing['imageUrl'] : '',
          recordId:
            existing['videoTaskId']?.toString?.()
            || existing['_id']?.toString?.()
            || undefined,
        },
      ],
    }
  }

  private async checkVectorRecall(
    orgId: string,
    projectId: string,
    contentUrl: string,
    imageUrl: string,
  ): Promise<DedupCheckV2Result | null> {
    const embedding = await this.embeddingService.getEmbedding(imageUrl)
    if (!embedding) {
      this.logger.debug('Embedding unavailable, skipping vector recall phase')
      return null
    }

    const candidates = await this.milvusService.search(projectId, embedding, VECTOR_TOP_K)
    if (candidates.length === 0) {
      return null
    }

    const matches: DedupCandidateMatch[] = []
    const normalizedContentUrl = contentUrl.trim()

    for (const candidate of candidates) {
      const candidateUrl = candidate.url?.trim()
      if (!candidateUrl || candidate.score < VECTOR_SIMILARITY_THRESHOLD || candidateUrl === normalizedContentUrl) {
        continue
      }

      const existing = await this.findContentHashByUrl(orgId, projectId, candidateUrl)
      const matchedRecordId
        = existing?.['videoTaskId']?.toString?.()
          || existing?.['_id']?.toString?.()
          || String(candidate.record_id)
      const candidateImageUrl = typeof existing?.['imageUrl'] === 'string'
        ? existing['imageUrl'].trim()
        : ''

      if (candidate.score >= DIRECT_DUPLICATE_THRESHOLD) {
        const directMatch = {
          score: Math.round(candidate.score * 100),
          phase: 'vector_recall' as const,
          url: candidateUrl,
          imageUrl: candidateImageUrl,
          recordId: matchedRecordId,
        }

        return {
          isDuplicate: true,
          phase: 'vector_recall',
          score: directMatch.score,
          level: 5,
          reason: `Vector similarity ${candidate.score.toFixed(3)} exceeds direct duplicate threshold`,
          matchedUrl: candidateUrl,
          matchedRecordId,
          matches: [directMatch],
        }
      }

      if (!candidateImageUrl) {
        matches.push({
          score: Math.round(candidate.score * 100),
          phase: 'vector_recall',
          url: candidateUrl,
          recordId: matchedRecordId,
        })
        continue
      }

      const aiResult = await this.aiJudgeService.judge(imageUrl, candidateImageUrl)
      const match: DedupCandidateMatch = {
        score: aiResult?.score ?? Math.round(candidate.score * 100),
        phase: aiResult ? 'ai_judge' : 'vector_recall',
        url: candidateUrl,
        imageUrl: candidateImageUrl,
        recordId: matchedRecordId,
        aiJudge: aiResult,
      }
      matches.push(match)

      if (aiResult && aiResult.level >= 4) {
        return {
          isDuplicate: true,
          phase: 'ai_judge',
          score: aiResult.score,
          level: aiResult.level,
          reason: aiResult.reason,
          matchedUrl: candidateUrl,
          matchedRecordId,
          aiJudge: aiResult,
          matches,
        }
      }
    }

    return null
  }

  // ── Helpers ───────────────────────────────────────────────────────

  private async findContentHashByUrl(
    orgId: string,
    projectId: string,
    contentUrl: string,
  ): Promise<ContentHashRecord | null> {
    const normalizedOrgId = this.toObjectId(orgId, 'orgId')
    const normalizedContentUrl = contentUrl.trim().toLowerCase()

    return this.contentHashModel.findOne({
      orgId: normalizedOrgId,
      hash: this.createContentHash(normalizedContentUrl),
      ...this.buildProjectScopeQuery(projectId),
    }).lean().exec() as Promise<ContentHashRecord | null>
  }

  private buildProjectScopeQuery(projectId: string) {
    if (!projectId) {
      return {
        projectId: null,
      }
    }

    return {
      $or: [
        { projectId },
        { projectId: null },
        { projectId: { $exists: false } },
      ],
    }
  }

  private async persistBatchResult(
    taskId: string,
    projectId: string,
    result: DedupBatchResultItem,
    registration: Record<string, unknown> | null,
  ) {
    const checkedAt = new Date().toISOString()
    const matchedTaskIds = this.buildMatchedTaskIds(result)
    const setPayload: Record<string, unknown> = {
      'dedup.hash': this.createContentHash(result.contentUrl.toLowerCase()),
      'dedup.status': result.status,
      'dedup.score': result.score,
      'dedup.matchedTaskIds': matchedTaskIds,
      'dedup.metadata': {
        phase: result.phase,
        level: result.level,
        reason: result.reason,
        checkedAt,
        projectId,
        contentUrl: result.contentUrl,
        imageUrl: result.imageUrl || '',
        matchedUrl: result.matchedUrl || '',
        aiJudge: result.aiJudge || null,
        matches: result.matches || [],
        registration,
      },
      'metadata.distribution.dedupStatus': result.status,
      'metadata.distribution.dedupCheckedAt': checkedAt,
      'metadata.distribution.blockedByDedup': result.status !== 'passed',
    }

    if (result.status === 'passed') {
      setPayload['metadata.distribution.dedupPassedAt'] = checkedAt
    }
    else {
      setPayload['metadata.distribution.dedupBlockedAt'] = checkedAt
    }

    await this.videoTaskModel.findByIdAndUpdate(
      this.toObjectId(taskId, 'taskId'),
      { $set: setPayload },
      { new: true },
    ).exec()
  }

  private buildBatchSummary(results: DedupBatchResultItem[]): DedupBatchSummary {
    return {
      total: results.length,
      passed: results.filter(item => item.status === 'passed').length,
      duplicate: results.filter(item => item.status === 'duplicate').length,
      error: results.filter(item => item.status === 'error').length,
      items: results,
      results,
    }
  }

  private buildBatchErrorItem(item: DedupBatchItem, reason: string): DedupBatchResultItem {
    return {
      contentUrl: item.contentUrl?.trim() || '',
      imageUrl: item.imageUrl?.trim(),
      externalId: item.externalId,
      status: 'error',
      isDuplicate: false,
      phase: 'error',
      score: 0,
      level: 0,
      reason,
      matches: [],
    }
  }

  private buildMatchedTaskIds(result: DedupBatchResultItem) {
    const candidates = [
      result.matchedRecordId,
      ...(result.matches || []).map(item => item.recordId),
    ]

    return Array.from(new Set(
      candidates.filter(
        (value): value is string => typeof value === 'string' && Types.ObjectId.isValid(value),
      ),
    ))
  }

  private resolveTaskContentUrl(task: VideoTaskRecord) {
    const candidates = [
      task['outputVideoUrl'],
      task['output']?.['url'],
    ]

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim()
      }
    }

    return ''
  }

  private resolveTaskImageUrl(task: VideoTaskRecord) {
    const candidates = [
      task['output']?.['metadata']?.['coverUrl'],
      task['output']?.['metadata']?.['thumbnailUrl'],
      task['output']?.['metadata']?.['posterUrl'],
      task['metadata']?.['coverUrl'],
      task['metadata']?.['thumbnailUrl'],
      task['metadata']?.['posterUrl'],
      task['metadata']?.['coverImageUrl'],
      task['metadata']?.['imageUrl'],
    ]

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim()
      }
    }

    return ''
  }

  private normalizeProjectId(projectId: string) {
    return projectId?.trim() || 'default'
  }

  private normalizeContent(content: string) {
    return content
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase()
  }

  private createContentHash(content: string) {
    return createHash('sha256')
      .update(content)
      .digest('hex')
  }

  private serializeContentHash(document: ContentHashRecord) {
    return {
      id: document['_id']?.toString?.() || null,
      orgId: document['orgId']?.toString?.() || null,
      projectId: document['projectId'] || null,
      hash: document['hash'] || '',
      videoTaskId: document['videoTaskId']?.toString?.() || null,
      contentType: document['contentType'] || 'video_task',
      url: document['url'] || '',
      imageUrl: document['imageUrl'] || '',
      metadata: document['metadata'] || {},
      createdAt: document['createdAt'] || null,
      updatedAt: document['updatedAt'] || null,
    }
  }

  private toObjectId(value: string, field: string) {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`${field} is invalid`)
    }

    return new Types.ObjectId(value)
  }

  private stringToNumericId(value: string): number {
    const hash = createHash('md5').update(value).digest()
    return Number(hash.readBigInt64BE(0) & BigInt('0x7FFFFFFFFFFFFFFF'))
  }
}
