import { createHash } from 'node:crypto'
import { Types } from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DedupService } from './dedup.service'

vi.mock('@yikart/mongodb', () => {
  class ContentHash {}
  class VideoTask {}

  return {
    ContentHash,
    VideoTask,
    VideoTaskStatus: {
      COMPLETED: 'completed',
      APPROVED: 'approved',
      PUBLISHED: 'published',
    },
  }
})

function createQuery<T>(value: T) {
  const query = {
    lean: vi.fn(),
    exec: vi.fn().mockResolvedValue(value),
  }

  query.lean.mockReturnValue(query)

  return query
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

describe('dedupService behavior', () => {
  let service: DedupService
  let contentHashModel: Record<string, any>
  let videoTaskModel: Record<string, any>
  let milvusService: Record<string, any>
  let embeddingService: Record<string, any>
  let aiJudgeService: Record<string, any>

  beforeEach(() => {
    contentHashModel = {
      findOne: vi.fn().mockReturnValue(createQuery(null)),
      findOneAndUpdate: vi.fn().mockReturnValue(createQuery(null)),
      countDocuments: vi.fn(),
      aggregate: vi.fn(),
      find: vi.fn(),
    }
    videoTaskModel = {
      find: vi.fn().mockReturnValue(createQuery([])),
      findByIdAndUpdate: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue({}) }),
    }
    milvusService = {
      search: vi.fn().mockResolvedValue([]),
      insert: vi.fn().mockResolvedValue(true),
    }
    embeddingService = {
      getEmbedding: vi.fn().mockResolvedValue(null),
    }
    aiJudgeService = {
      judge: vi.fn().mockResolvedValue(null),
    }

    service = new DedupService(
      contentHashModel as any,
      videoTaskModel as any,
      milvusService as any,
      embeddingService as any,
      aiJudgeService as any,
    )
  })

  it('应汇总批量去重结果并区分通过、重复和异常', async () => {
    const orgId = new Types.ObjectId().toString()
    const projectId = 'project-a'
    const duplicateUrl = 'https://cdn.example.com/duplicate.mp4'

    contentHashModel.findOne.mockImplementation((query: Record<string, any>) => createQuery(
      query.hash === sha256(duplicateUrl.toLowerCase())
        ? {
            _id: new Types.ObjectId(),
            orgId: new Types.ObjectId(orgId),
            projectId,
            videoTaskId: new Types.ObjectId(),
            url: duplicateUrl,
            imageUrl: 'https://cdn.example.com/duplicate.jpg',
          }
        : null,
    ))

    const summary = await service.batchCheckDuplicate(orgId, projectId, [
      {
        contentUrl: 'https://cdn.example.com/passed.mp4',
      },
      {
        contentUrl: duplicateUrl,
      },
      {
        contentUrl: '',
      },
    ])

    expect(summary.total).toBe(3)
    expect(summary.passed).toBe(1)
    expect(summary.duplicate).toBe(1)
    expect(summary.error).toBe(1)
    expect(summary.items.map(item => item.status)).toEqual([
      'passed',
      'duplicate',
      'error',
    ])
  })

  it('应在向量相似度超过直判阈值时直接拦截', async () => {
    const orgId = new Types.ObjectId().toString()
    const projectId = 'project-b'
    const sourceUrl = 'https://cdn.example.com/source.mp4'
    const candidateUrl = 'https://cdn.example.com/candidate.mp4'
    const matchedTaskId = new Types.ObjectId().toString()

    contentHashModel.findOne.mockImplementation((query: Record<string, any>) => createQuery(
      query.hash === sha256(candidateUrl.toLowerCase())
        ? {
            _id: new Types.ObjectId(),
            orgId: new Types.ObjectId(orgId),
            projectId,
            videoTaskId: new Types.ObjectId(matchedTaskId),
            url: candidateUrl,
            imageUrl: 'https://cdn.example.com/candidate.jpg',
          }
        : null,
    ))
    embeddingService.getEmbedding.mockResolvedValue([0.1, 0.2, 0.3])
    milvusService.search.mockResolvedValue([
      {
        id: 1,
        record_id: 42,
        project_id: projectId,
        url: candidateUrl,
        score: 0.97,
      },
    ])

    const result = await service.checkDuplicateV2(
      orgId,
      projectId,
      sourceUrl,
      'https://cdn.example.com/source.jpg',
    )

    expect(result.isDuplicate).toBe(true)
    expect(result.phase).toBe('vector_recall')
    expect(result.matchedRecordId).toBe(matchedTaskId)
    expect(aiJudgeService.judge).not.toHaveBeenCalled()
  })

  it('应按批次写回 dedup 结果并仅注册通过项', async () => {
    const orgId = new Types.ObjectId().toString()
    const batchId = new Types.ObjectId().toString()
    const projectId = 'project-c'
    const passedTaskId = new Types.ObjectId().toString()
    const duplicateTaskId = new Types.ObjectId().toString()
    const duplicateUrl = 'https://cdn.example.com/batch-duplicate.mp4'

    videoTaskModel.find.mockReturnValue(createQuery([
      {
        _id: new Types.ObjectId(passedTaskId),
        orgId: new Types.ObjectId(orgId),
        batchId: new Types.ObjectId(batchId),
        status: 'completed',
        outputVideoUrl: 'https://cdn.example.com/batch-passed.mp4',
        output: {
          metadata: {
            coverUrl: 'https://cdn.example.com/batch-passed.jpg',
          },
        },
      },
      {
        _id: new Types.ObjectId(duplicateTaskId),
        orgId: new Types.ObjectId(orgId),
        batchId: new Types.ObjectId(batchId),
        status: 'completed',
        outputVideoUrl: duplicateUrl,
        output: {
          metadata: {
            coverUrl: 'https://cdn.example.com/batch-duplicate.jpg',
          },
        },
      },
    ]))
    contentHashModel.findOne.mockImplementation((query: Record<string, any>) => createQuery(
      query.hash === sha256(duplicateUrl.toLowerCase())
        ? {
            _id: new Types.ObjectId(),
            orgId: new Types.ObjectId(orgId),
            projectId,
            videoTaskId: new Types.ObjectId(),
            url: duplicateUrl,
            imageUrl: 'https://cdn.example.com/batch-duplicate.jpg',
          }
        : null,
    ))
    contentHashModel.findOneAndUpdate.mockReturnValue(createQuery({
      _id: new Types.ObjectId(),
      orgId: new Types.ObjectId(orgId),
      projectId,
      videoTaskId: new Types.ObjectId(passedTaskId),
      url: 'https://cdn.example.com/batch-passed.mp4',
      imageUrl: 'https://cdn.example.com/batch-passed.jpg',
      contentType: 'content_url',
      hash: sha256('https://cdn.example.com/batch-passed.mp4'),
    }))
    embeddingService.getEmbedding.mockResolvedValue([0.2, 0.3, 0.4])

    const result = await service.batchCheckDuplicateByBatch(
      orgId,
      projectId,
      batchId,
    )

    expect(result.passedTaskIds).toEqual([passedTaskId])
    expect(result.blockedTaskIds).toEqual([duplicateTaskId])
    expect(result.errorTaskIds).toEqual([])
    expect(contentHashModel.findOneAndUpdate).toHaveBeenCalledTimes(1)
    expect(milvusService.insert).toHaveBeenCalledTimes(1)
    expect(videoTaskModel.findByIdAndUpdate).toHaveBeenCalledTimes(2)
    expect(videoTaskModel.findByIdAndUpdate).toHaveBeenNthCalledWith(
      1,
      expect.any(Types.ObjectId),
      expect.objectContaining({
        $set: expect.objectContaining({
          'dedup.status': 'passed',
          'metadata.distribution.blockedByDedup': false,
        }),
      }),
      { new: true },
    )
    expect(videoTaskModel.findByIdAndUpdate).toHaveBeenNthCalledWith(
      2,
      expect.any(Types.ObjectId),
      expect.objectContaining({
        $set: expect.objectContaining({
          'dedup.status': 'duplicate',
          'metadata.distribution.blockedByDedup': true,
        }),
      }),
      { new: true },
    )
  })
})
