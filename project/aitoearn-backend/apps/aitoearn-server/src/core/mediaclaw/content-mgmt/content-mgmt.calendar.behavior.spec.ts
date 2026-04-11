import { VideoTaskStatus } from '@yikart/mongodb'
import { Types } from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContentMgmtService } from './content-mgmt.service'

function createQuery<T>(value: T) {
  const query = {
    lean: vi.fn(),
    exec: vi.fn().mockResolvedValue(value),
    sort: vi.fn(),
    skip: vi.fn(),
    limit: vi.fn(),
  }

  query.lean.mockReturnValue(query)
  query.sort.mockReturnValue(query)
  query.skip.mockReturnValue(query)
  query.limit.mockReturnValue(query)

  return query
}

function createTask(overrides: Record<string, any> = {}) {
  const _id = overrides['_id'] || new Types.ObjectId()
  const orgId = overrides['orgId'] || new Types.ObjectId()

  return {
    _id,
    orgId,
    brandId: null,
    pipelineId: null,
    userId: 'user-1',
    taskType: 'remix',
    status: VideoTaskStatus.COMPLETED,
    sourceVideoUrl: 'https://cdn.example.com/source.mp4',
    outputVideoUrl: `https://cdn.example.com/${_id.toString()}.mp4`,
    copy: {
      title: '春季上新短片',
      subtitle: '测试副标题',
      hashtags: ['#测试'],
      blueWords: ['转化'],
      commentGuide: '评论引导',
      commentGuides: ['评论引导 1'],
    },
    metadata: {},
    iterationLog: [],
    createdAt: new Date('2026-04-10T08:00:00.000Z'),
    updatedAt: new Date('2026-04-10T08:00:00.000Z'),
    ...overrides,
  }
}

describe('contentMgmtService calendar behavior', () => {
  let videoTaskModel: Record<string, any>
  let organizationModel: Record<string, any>
  let subscriptionModel: Record<string, any>
  let mediaClawUserModel: Record<string, any>
  let notificationService: Record<string, any>
  let webhookService: Record<string, any>
  let service: ContentMgmtService

  beforeEach(() => {
    videoTaskModel = {
      find: vi.fn(),
      findOne: vi.fn(),
      findByIdAndUpdate: vi.fn(),
    }
    organizationModel = {}
    subscriptionModel = {}
    mediaClawUserModel = {}
    notificationService = { send: vi.fn().mockResolvedValue(undefined) }
    webhookService = { trigger: vi.fn().mockResolvedValue(undefined) }

    service = new ContentMgmtService(
      videoTaskModel as any,
      organizationModel as any,
      subscriptionModel as any,
      mediaClawUserModel as any,
      notificationService as any,
      webhookService as any,
    )
  })

  it('应标记同平台同小时的排期冲突', async () => {
    const orgId = new Types.ObjectId()
    const scheduledAt = new Date('2026-04-10T10:00:00.000Z')
    const tasks = [
      createTask({
        orgId,
        metadata: {
          contentCalendar: {
            scheduledAt: scheduledAt.toISOString(),
            scheduledAtDate: scheduledAt,
            platform: 'douyin',
          },
        },
      }),
      createTask({
        orgId,
        metadata: {
          contentCalendar: {
            scheduledAt: scheduledAt.toISOString(),
            scheduledAtDate: scheduledAt,
            platform: 'douyin',
          },
        },
      }),
      createTask({
        orgId,
        metadata: {
          contentCalendar: {
            scheduledAt: scheduledAt.toISOString(),
            scheduledAtDate: scheduledAt,
            platform: 'xhs',
          },
        },
      }),
    ]

    videoTaskModel.find.mockReturnValue(createQuery(tasks))

    const result = await service.listCalendar(orgId.toString(), {
      startDate: '2026-04-10',
      endDate: '2026-04-10',
    })

    expect(result.total).toBe(3)
    expect(result.conflictCount).toBe(2)
    expect(result.items.filter(item => item.conflict).map(item => item.platform)).toEqual(['douyin', 'douyin'])
  })

  it('应先落库排期元数据再返回日历项', async () => {
    const orgId = new Types.ObjectId()
    const task = createTask({ orgId })
    const scheduledAt = '2026-04-10T10:00:00.000Z'
    const updatedTask = createTask({
      _id: task._id,
      orgId,
      metadata: {
        contentCalendar: {
          scheduledAt,
          scheduledAtDate: new Date(scheduledAt),
          platform: 'douyin',
          note: '手动调整',
        },
        distribution: {
          publishStatus: 'scheduled',
        },
      },
    })

    videoTaskModel.findOne.mockReturnValueOnce(createQuery(task))
    videoTaskModel.findByIdAndUpdate.mockReturnValue(createQuery(updatedTask))
    videoTaskModel.find.mockReturnValue(createQuery([updatedTask]))

    const result = await service.scheduleContent(
      orgId.toString(),
      task._id.toString(),
      'reviewer-1',
      {
        scheduledAt,
        platform: 'douyin',
        note: '手动调整',
      },
    )

    expect(videoTaskModel.findByIdAndUpdate).toHaveBeenCalledWith(
      task._id,
      expect.objectContaining({
        $set: expect.objectContaining({
          'metadata.contentCalendar': expect.objectContaining({
            scheduledAt,
            platform: 'douyin',
            note: '手动调整',
            lastScheduledBy: 'reviewer-1',
          }),
        }),
      }),
      { new: true },
    )
    expect(result.platform).toBe('douyin')
    expect(result.scheduledAt).toBe(scheduledAt)
    expect(result.canApprove).toBe(false)
  })

  it('应支持跨工作日批量排期', async () => {
    const orgId = new Types.ObjectId()
    const firstTask = createTask({ orgId, _id: new Types.ObjectId() })
    const secondTask = createTask({ orgId, _id: new Types.ObjectId() })

    videoTaskModel.findOne.mockImplementation((query: Record<string, any>) => {
      const id = query['_id']?.toString()
      if (id === firstTask._id.toString()) {
        return createQuery(firstTask)
      }
      if (id === secondTask._id.toString()) {
        return createQuery(secondTask)
      }
      return createQuery(null)
    })

    videoTaskModel.findByIdAndUpdate.mockImplementation(
      (id: Types.ObjectId, update: Record<string, any>) => {
        const scheduledAt = update['$set']?.['metadata.contentCalendar']?.['scheduledAt']
        return createQuery(createTask({
          _id: id,
          orgId,
          metadata: {
            contentCalendar: {
              scheduledAt,
              scheduledAtDate: new Date(scheduledAt),
              platform: 'xhs',
              note: 'batch:weekdays',
            },
            distribution: {
              publishStatus: 'scheduled',
            },
          },
        }))
      },
    )

    const result = await service.batchScheduleCalendar(orgId.toString(), 'scheduler-1', {
      ids: [firstTask._id.toString(), secondTask._id.toString()],
      startDate: '2026-04-11',
      time: '09:30',
      platform: 'xhs',
      strategy: 'weekdays',
    })

    expect(result.successCount).toBe(2)
    expect(result.items.map(item => item.scheduledAt.slice(0, 10))).toEqual([
      '2026-04-13',
      '2026-04-14',
    ])
  })
})
