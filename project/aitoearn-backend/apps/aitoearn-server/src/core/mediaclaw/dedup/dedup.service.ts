import { createHash } from 'node:crypto'
import { BadRequestException, Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { ContentHash } from '@yikart/mongodb'
import { Model, Types } from 'mongoose'

type ContentHashRecord = Record<string, any>

@Injectable()
export class DedupService {
  constructor(
    @InjectModel(ContentHash.name)
    private readonly contentHashModel: Model<ContentHash>,
  ) {}

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
      strategy: 'rule_based_text_hash',
    }
  }

  private normalizeContent(content: string) {
    return content
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase()
  }

  private createContentHash(content: string) {
    // Phase 2 can replace this hash lookup with Milvus-based vector recall.
    return createHash('sha256')
      .update(content)
      .digest('hex')
  }

  private serializeContentHash(document: ContentHashRecord) {
    return {
      id: document['_id']?.toString?.() || null,
      orgId: document['orgId']?.toString?.() || null,
      hash: document['hash'] || '',
      videoTaskId: document['videoTaskId']?.toString?.() || null,
      contentType: document['contentType'] || 'video_task',
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
}
