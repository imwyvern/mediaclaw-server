import { ComplianceDeletionRequestStatus } from '@yikart/mongodb'
import { Types } from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ComplianceService } from './compliance.service'

vi.mock('@yikart/mongodb', () => {
  class ComplianceDeletionRequest {}
  class VideoTask {}

  return {
    ComplianceDeletionRequest,
    VideoTask,
    ComplianceDeletionRequestStatus: {
      PENDING: 'pending',
      REVIEWING: 'reviewing',
      APPROVED: 'approved',
      EXECUTED: 'executed',
      REJECTED: 'rejected',
    },
  }
})

vi.mock('../../../config', () => ({
  config: {
    assets: {
      cdnEndpoint: 'https://cdn.example.com',
      endpoint: 'https://assets.example.com',
    },
  },
}))

vi.mock('@yikart/assets', () => ({
  StorageProvider: class StorageProvider {},
}))

function createExecQuery<T>(value: T) {
  const query = {
    sort: vi.fn(),
    skip: vi.fn(),
    limit: vi.fn(),
    lean: vi.fn(),
    exec: vi.fn().mockResolvedValue(value),
  }

  query.sort.mockReturnValue(query)
  query.skip.mockReturnValue(query)
  query.limit.mockReturnValue(query)
  query.lean.mockReturnValue(query)

  return query
}

describe('complianceService', () => {
  let service: ComplianceService
  let complianceDeletionRequestModel: Record<string, any>
  let videoTaskModel: Record<string, any>

  beforeEach(() => {
    complianceDeletionRequestModel = {
      create: vi.fn(),
      findOne: vi.fn(),
      find: vi.fn(),
      countDocuments: vi.fn(),
      findByIdAndUpdate: vi.fn(),
    }
    videoTaskModel = {
      find: vi.fn(),
      findByIdAndUpdate: vi.fn(),
    }

    service = new ComplianceService(
      complianceDeletionRequestModel as any,
      videoTaskModel as any,
      {
        log: vi.fn().mockResolvedValue(undefined),
      } as any,
      {
        deleteObject: vi.fn().mockResolvedValue(undefined),
      } as any,
    )
  })

  it('应在公开删除申请时签发公开跟踪 token', async () => {
    const now = new Date('2026-04-10T18:20:00.000Z')
    complianceDeletionRequestModel.findOne.mockReturnValue(createExecQuery(null))
    videoTaskModel.find.mockReturnValue(createExecQuery([]))
    complianceDeletionRequestModel.create.mockImplementation(async (payload: Record<string, unknown>) => ({
      toObject: () => ({
        _id: new Types.ObjectId(),
        requestId: 'CDRTEST001',
        createdAt: now,
        updatedAt: now,
        ...payload,
      }),
    }))

    const result = await service.createRequest({
      contentUrl: 'https://cdn.example.com/video.mp4',
      reason: '侵权删除',
      requesterName: '张三',
      requesterEmail: 'zhangsan@example.com',
    })

    expect(result.requestId).toBe('CDRTEST001')
    expect(result.tracking.token).toMatch(/^cdr_[a-f0-9]{36}$/)
    expect(result.tracking.preview).toMatch(/^cdr_[a-f0-9]{4}/)
    expect(complianceDeletionRequestModel.create).toHaveBeenCalledWith(expect.objectContaining({
      publicTrackingTokenHash: expect.any(String),
      publicTrackingTokenPreview: expect.any(String),
      source: 'public_api',
    }))
  })

  it('应允许公开请求方通过 requestId + token 查询状态', async () => {
    const token = 'cdr_1234567890abcdef1234567890abcdef1234'
    complianceDeletionRequestModel.findOne.mockReturnValue(createExecQuery({
      _id: new Types.ObjectId(),
      requestId: 'CDRTEST002',
      status: ComplianceDeletionRequestStatus.EXECUTED,
      contentUrl: 'https://cdn.example.com/video.mp4',
      platformPostUrl: 'https://xhs.example.com/post/1',
      reason: '侵权删除',
      description: '品牌方提交的删除请求',
      requesterName: '王小明',
      requesterEmail: 'hidden@example.com',
      requesterPhone: '13800000000',
      evidenceUrls: ['https://example.com/evidence-1.png'],
      publicTrackingTokenHash: (service as any).hashPublicTrackingToken(token),
      publicTrackingTokenPreview: 'cdr_1234***1234',
      matchedVideoTaskIds: [],
      submittedAt: new Date('2026-04-10T12:00:00.000Z'),
      reviewedAt: new Date('2026-04-10T13:00:00.000Z'),
      executedAt: new Date('2026-04-10T14:00:00.000Z'),
      reviewComment: '已核验，执行下线',
      executionError: '',
      executionResult: {
        affectedTasksCount: 1,
      },
      metadata: {},
      createdAt: new Date('2026-04-10T12:00:00.000Z'),
      updatedAt: new Date('2026-04-10T14:00:00.000Z'),
    }))

    const result = await service.getPublicRequestStatus('CDRTEST002', token)

    expect(result.requestId).toBe('CDRTEST002')
    expect(result.status).toBe(ComplianceDeletionRequestStatus.EXECUTED)
    expect(result.requesterName).toBe('王*明')
    expect(result.evidenceCount).toBe(1)
    expect(result.tracking.preview).toBe('cdr_1234***1234')
    expect(result.executionResult).toEqual({
      affectedTasksCount: 1,
    })
  })
})
