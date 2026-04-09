import { VideoTaskStatus } from '@yikart/mongodb'
import { Types } from 'mongoose'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PromptOptimizerService } from './prompt-optimizer.service'

vi.mock('@yikart/mongodb', () => {
  class IterationLog {}
  class VideoTask {}

  return {
    IterationFailureCategory: {
      QUALITY: 'quality',
      CONTENT: 'content',
      TECHNICAL: 'technical',
      BRAND_MISMATCH: 'brand_mismatch',
    },
    IterationLog,
    IterationLogStage: {
      FRAME_EDIT: 'frame_edit',
      I2V_GENERATE: 'i2v_generate',
      SUBTITLE: 'subtitle',
      QUALITY_CHECK: 'quality_check',
      COPY_GENERATE: 'copy_generate',
    },
    IterationLogStatus: {
      SUCCESS: 'success',
      FAILED: 'failed',
      RETRIED: 'retried',
      SKIPPED: 'skipped',
    },
    VideoTask,
    OrgApiKeyProvider: {
      DEEPSEEK: 'deepseek',
      GEMINI: 'gemini',
    },
    VideoTaskStatus: {
      PENDING: 'pending',
      ANALYZING: 'analyzing',
      EDITING: 'editing',
      RENDERING: 'rendering',
      QUALITY_CHECK: 'quality_check',
      GENERATING_COPY: 'generating_copy',
      FAILED: 'failed',
    },
  }
})

vi.mock('./pipeline.utils', () => ({
  requestJson: vi.fn(),
}))

function createExecQuery<T>(value: T) {
  return {
    exec: vi.fn().mockResolvedValue(value),
  }
}

function createIterationLogModel(latestIteration?: number | null) {
  return {
    findOne: vi.fn().mockReturnValue({
      sort: vi.fn().mockReturnValue({
        lean: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue(
            latestIteration
              ? { iteration: latestIteration }
              : null,
          ),
        }),
      }),
    }),
    create: vi.fn().mockImplementation(async (payload: Record<string, unknown>) => ({
      toObject: () => ({
        _id: new Types.ObjectId(),
        ...payload,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    })),
  }
}

describe('promptOptimizerService', () => {
  const taskId = '507f1f77bcf86cd799439041'
  const orgId = '507f1f77bcf86cd799439042'

  beforeEach(() => {
    delete process.env['MEDIACLAW_DEEPSEEK_API_KEY']
    delete process.env['MEDIACLAW_GEMINI_API_KEY']
  })

  it('应在无 provider key 时走启发式失败分析并持久化优化 prompt', async () => {
    const iterationLogModel = createIterationLogModel()
    const videoTaskModel = {
      findById: vi.fn().mockReturnValue(createExecQuery({
        _id: new Types.ObjectId(taskId),
        orgId: new Types.ObjectId(orgId),
        metadata: {
          failedStep: 'render-video',
          pipelineContext: {
            prompts: {
              'render-video': 'Original render prompt',
            },
          },
        },
        sourceVideoUrl: 'https://cdn.example.com/source.mp4',
        errorMessage: 'Provider timeout after 60s',
        iterationLog: [],
        errorLog: [],
        promptFixes: [],
      })),
      findByIdAndUpdate: vi.fn().mockReturnValue(createExecQuery(null)),
    }

    const service = new PromptOptimizerService(videoTaskModel as any, undefined, iterationLogModel as any)
    const result = await service.analyzeFailure(taskId)

    expect(result).toMatchObject({
      taskId,
      failedStep: 'render-video',
      failureReason: 'Provider timed out during stage execution',
      rootCause: 'Prompt context is too broad or the provider response path is unstable',
    })
    const [updatedTaskId, updatePayload] = videoTaskModel.findByIdAndUpdate.mock.calls[0]
    expect(updatedTaskId.toString()).toBe(taskId)
    expect(updatePayload.$set['metadata.promptOptimizer.lastAnalysis']).toMatchObject({
      taskId,
      failedStep: 'render-video',
    })
    expect(updatePayload.$set['metadata.optimizedPrompts']['render-video']).toContain('[Optimization patch]')
    expect(updatePayload.$push.promptFixes).toMatchObject({
      originalPrompt: 'Original render prompt',
      result: 'analyzed',
    })
  })

  it('应仅重跑失败环节并把优化后的 prompt 注入队列上下文', async () => {
    const iterationLogModel = createIterationLogModel(1)
    const queue = {
      add: vi.fn().mockResolvedValue(undefined),
    }
    const taskObjectId = new Types.ObjectId(taskId)
    const videoTaskModel = {
      findById: vi.fn().mockReturnValue(createExecQuery({
        _id: taskObjectId,
        orgId: new Types.ObjectId(orgId),
        metadata: {
          failedStep: 'generate-copy',
          optimizedPrompts: {
            'generate-copy': 'Optimized copy prompt',
          },
          pipelineContext: {
            prompts: {
              'generate-copy': 'Original copy prompt',
              'render-video': 'Render prompt',
            },
          },
        },
        sourceVideoUrl: 'https://cdn.example.com/source.mp4',
        errorMessage: 'LLM returned invalid JSON',
        iterationLog: [],
        errorLog: [],
        promptFixes: [{ failureReason: 'LLM returned invalid JSON' }],
      })),
      findByIdAndUpdate: vi.fn().mockReturnValue(createExecQuery(null)),
    }

    const service = new PromptOptimizerService(videoTaskModel as any, queue as any, iterationLogModel as any)
    const result = await service.retryWithOptimizedPrompt(taskId)

    expect(result).toMatchObject({
      taskId,
      failedStep: 'generate-copy',
      optimizedPrompt: 'Optimized copy prompt',
      retryQueued: true,
      strategy: 'retry_optimized',
    })
    expect(queue.add).toHaveBeenCalledWith(
      'generate-copy',
      {
        taskId,
        context: {
          prompts: {
            'generate-copy': 'Optimized copy prompt',
            'render-video': 'Render prompt',
          },
        },
      },
      {
        jobId: expect.stringContaining(`${taskObjectId.toString()}:generate-copy:optimized:`),
      },
    )
    expect(videoTaskModel.findByIdAndUpdate).toHaveBeenCalledWith(
      taskObjectId,
      expect.objectContaining({
        $set: expect.objectContaining({
          'status': VideoTaskStatus.GENERATING_COPY,
          'errorMessage': '',
          'completedAt': null,
          'metadata.failedStep': null,
          'metadata.pipelineContext': {
            prompts: {
              'generate-copy': 'Optimized copy prompt',
              'render-video': 'Render prompt',
            },
          },
        }),
        $push: expect.objectContaining({
          promptFixes: expect.objectContaining({
            optimizedPrompt: 'Optimized copy prompt',
            failureReason: 'LLM returned invalid JSON',
            result: 'retry_queued',
          }),
        }),
      }),
    )
  })
})
