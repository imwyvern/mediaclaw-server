import { Types } from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PipelineSystemService } from './pipeline-system.service'

vi.mock('@yikart/mongodb', () => {
  class Pipeline {}
  class PipelineTemplate {}
  class VideoTask {}

  return {
    Pipeline,
    PipelineTemplate,
    VideoTask,
    PipelineStatus: {
      ACTIVE: 'active',
      PAUSED: 'paused',
      ARCHIVED: 'archived',
    },
    PipelineType: {
      SEEDING: 'seeding',
      REVIEW: 'review',
      NEW_PRODUCT: 'new_product',
      BRAND_STORY: 'brand_story',
      PROMO: 'promo',
      CUSTOM: 'custom',
    },
    VideoTaskStatus: {
      PENDING: 'pending',
    },
    VideoTaskType: {
      NEW_CONTENT: 'new_content',
    },
  }
})

function createQuery<T>(value: T) {
  const query = {
    sort: vi.fn(),
    lean: vi.fn(),
    exec: vi.fn().mockResolvedValue(value),
  }

  query.sort.mockReturnValue(query)
  query.lean.mockReturnValue(query)

  return query
}

describe('pipelineSystemService', () => {
  let service: PipelineSystemService
  let pipelineTemplateModel: Record<string, any>
  let pipelineModel: Record<string, any>
  let videoTaskModel: Record<string, any>
  let videoWorkerQueue: Record<string, any>
  let pipelineService: Record<string, any>

  beforeEach(() => {
    pipelineTemplateModel = {
      create: vi.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
      find: vi.fn().mockReturnValue(createQuery([])),
      findOne: vi.fn(),
      findOneAndUpdate: vi.fn().mockReturnValue(createQuery({})),
      findByIdAndUpdate: vi.fn().mockReturnValue(createQuery({})),
    }
    pipelineModel = {
      findOne: vi.fn(),
      findOneAndUpdate: vi.fn().mockReturnValue(createQuery({})),
    }
    videoTaskModel = {
      create: vi.fn(),
    }
    videoWorkerQueue = {
      add: vi.fn().mockResolvedValue(undefined),
    }
    pipelineService = {
      create: vi.fn().mockResolvedValue({ _id: new Types.ObjectId(), name: '种草线' }),
    }

    service = new PipelineSystemService(
      pipelineTemplateModel as any,
      pipelineModel as any,
      videoTaskModel as any,
      videoWorkerQueue as any,
      pipelineService as any,
    )
  })

  it('应在模块初始化时写入 5 个预置模板', async () => {
    await service.onModuleInit()

    expect(pipelineTemplateModel.findOneAndUpdate).toHaveBeenCalledTimes(5)
    expect(pipelineTemplateModel.findOneAndUpdate).toHaveBeenCalledWith(
      { templateId: 'preset-seeding-line' },
      expect.any(Object),
      expect.objectContaining({ upsert: true }),
    )
    expect(pipelineTemplateModel.findOneAndUpdate).toHaveBeenCalledWith(
      { templateId: 'preset-promo-line' },
      expect.any(Object),
      expect.objectContaining({ upsert: true }),
    )
  })

  it('应把模板应用为带分发规则和群绑定的管线', async () => {
    const template = {
      _id: new Types.ObjectId(),
      templateId: 'preset-seeding-line',
      name: '种草线',
      type: 'seeding',
      isPublic: true,
      createdBy: 'system',
      steps: [{ name: 'copy', order: 1, config: {} }],
      defaultParams: {
        duration: 15,
        aspectRatio: '9:16',
        subtitleStyle: { emphasis: 'hook-first' },
        musicStyle: 'light-pop',
      },
      styles: ['生活化'],
    }

    pipelineTemplateModel.findOne.mockReturnValue(createQuery(template))

    await service.applyTemplate(
      'preset-seeding-line',
      'user_1',
      new Types.ObjectId().toString(),
      new Types.ObjectId().toString(),
      {
        distributionRules: {
          preferredCategories: ['beer'],
        },
        groupBinding: {
          channel: 'wecom',
          groupId: 'chat_1',
        },
      },
    )

    expect(pipelineService.create).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        name: '种草线',
        templateId: 'preset-seeding-line',
        styleConfig: expect.objectContaining({
          duration: 15,
          aspectRatio: '9:16',
          visualStyle: '生活化',
        }),
        distributionRules: expect.objectContaining({
          preferredCategories: ['beer'],
        }),
        groupBinding: expect.objectContaining({
          channel: 'wecom',
          groupId: 'chat_1',
        }),
      }),
    )
  })

  it('应按老板优先于运营和效果数据聚合偏好', async () => {
    const orgId = new Types.ObjectId().toString()
    const pipelineId = new Types.ObjectId()
    const pipeline = {
      _id: pipelineId,
      orgId: new Types.ObjectId(orgId),
      status: 'active',
      preferences: {
        preferredDuration: 18,
        aspectRatio: '9:16',
        subtitlePreferences: {},
      },
      trainingPreferences: [
        {
          source: '运营反馈',
          sourceType: 'operations',
          preference: '节奏稳定',
          priority: 3,
          metadata: {
            preferredStyles: ['专业感'],
            subtitleStyle: { pacing: 'steady' },
          },
          createdAt: new Date('2026-04-06T00:00:00.000Z'),
        },
        {
          source: '效果数据',
          sourceType: 'performance',
          preference: '前3秒更强',
          priority: 2,
          metadata: {
            preferredStyles: ['快节奏'],
          },
          createdAt: new Date('2026-04-05T00:00:00.000Z'),
        },
      ],
    }

    pipelineModel.findOne.mockReturnValue(createQuery(pipeline))

    await service.learnPreference(orgId, pipelineId.toString(), {
      source: '老板反馈',
      preference: '文案更口语化',
      preferredStyles: ['口语化'],
      subtitleStyle: { tone: 'spoken' },
    })

    expect(pipelineModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        $set: expect.objectContaining({
          'preferences.preferredStyles': ['口语化', '专业感', '快节奏'],
          'preferences.subtitlePreferences': expect.objectContaining({
            tone: 'spoken',
            pacing: 'steady',
            feedbackWeights: expect.objectContaining({
              boss: 4,
              operations: 3,
              performance: 2,
            }),
          }),
          'trainingPreferences': expect.arrayContaining([
            expect.objectContaining({
              sourceType: 'boss',
              preference: '文案更口语化',
            }),
          ]),
        }),
      }),
      { new: true },
    )
  })

  it('应在预热时创建 3 个试生产任务并写回 warmUp 状态', async () => {
    const orgId = new Types.ObjectId().toString()
    const pipelineId = new Types.ObjectId()
    const pipeline = {
      _id: pipelineId,
      orgId: new Types.ObjectId(orgId),
      brandId: new Types.ObjectId(),
      status: 'active',
      preferences: {
        subtitlePreferences: {
          templateId: 'preset-seeding-line',
        },
      },
    }

    pipelineModel.findOne.mockReturnValue(createQuery(pipeline))
    videoTaskModel.create.mockImplementation(async (payload: Record<string, any>) => payload)

    const result = await service.warmUp(orgId, pipelineId.toString(), 'user_1')

    expect(result.queued).toBe(3)
    expect(videoTaskModel.create).toHaveBeenCalledTimes(3)
    expect(videoWorkerQueue.add).toHaveBeenCalledTimes(3)
    expect(pipelineModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.any(Object),
      {
        $set: {
          warmUp: expect.objectContaining({
            required: false,
            status: 'queued',
            queuedTaskIds: expect.any(Array),
          }),
        },
      },
      { new: true },
    )
  })
})
