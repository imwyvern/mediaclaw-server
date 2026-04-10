import {
  IterationFailureCategory,
  VideoTaskStatus,
} from '@yikart/mongodb'
import { Types } from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PromptOptimizerService } from './prompt-optimizer.service'

function createExecQuery<T>(value: T) {
  return {
    exec: vi.fn().mockResolvedValue(value),
  }
}

function createChainableQuery<T>(value: T) {
  const query = {
    sort: vi.fn(),
    find: vi.fn(),
    lean: vi.fn(),
    exec: vi.fn().mockResolvedValue(value),
  }

  query.sort.mockReturnValue(query)
  query.find.mockReturnValue(query)
  query.lean.mockReturnValue(query)

  return query
}

describe('promptOptimizerService', () => {
  let service: PromptOptimizerService
  let iterationLogModel: Record<string, any>
  let videoTaskModel: Record<string, any>
  let workerQueue: Record<string, any>
  let configService: Record<string, any>

  beforeEach(() => {
    iterationLogModel = {
      find: vi.fn(),
      findOne: vi.fn(),
    }
    videoTaskModel = {
      find: vi.fn(),
      findById: vi.fn(),
      findByIdAndUpdate: vi.fn(),
    }
    workerQueue = {
      add: vi.fn().mockResolvedValue(undefined),
    }
    configService = {
      getString: vi.fn().mockReturnValue(''),
    }

    service = new PromptOptimizerService(
      iterationLogModel as any,
      videoTaskModel as any,
      workerQueue as any,
      undefined,
      undefined,
      configService as any,
    )
  })

  it('应根据当前迭代次数返回不同重试策略', async () => {
    iterationLogModel.findOne
      .mockReturnValueOnce(createChainableQuery({ iteration: 2 }))
      .mockReturnValueOnce(createChainableQuery({ iteration: 3 }))

    const fallback = await service.shouldRetry(new Types.ObjectId().toString())
    const manualReview = await service.shouldRetry(new Types.ObjectId().toString())

    expect(fallback).toEqual({
      currentIteration: 2,
      shouldRetry: true,
      strategy: 'fallback_strategy',
    })
    expect(manualReview).toEqual({
      currentIteration: 3,
      shouldRetry: false,
      strategy: 'needs_manual_review',
    })
  })

  it('应汇总批次迭代结果与成功率', async () => {
    const batchId = new Types.ObjectId().toString()
    const task1Id = new Types.ObjectId()
    const task2Id = new Types.ObjectId()
    iterationLogModel.find.mockReturnValue(createChainableQuery([
      {
        videoTaskId: task1Id.toString(),
        iteration: 1,
        failureAnalysis: {
          failCategory: IterationFailureCategory.TECHNICAL,
        },
      },
      {
        videoTaskId: task1Id.toString(),
        iteration: 2,
        failureAnalysis: {
          failCategory: IterationFailureCategory.QUALITY,
        },
      },
      {
        videoTaskId: task2Id.toString(),
        iteration: 1,
        failureAnalysis: {
          failCategory: IterationFailureCategory.QUALITY,
        },
      },
    ]))
    videoTaskModel.find.mockReturnValue(createChainableQuery([
      {
        _id: task1Id,
        status: VideoTaskStatus.COMPLETED,
      },
      {
        _id: task2Id,
        status: VideoTaskStatus.FAILED,
      },
    ]))

    const result = await service.getBatchIterationSummary(batchId)

    expect(result).toMatchObject({
      batchId,
      totalIterations: 3,
      totalTasks: 2,
      successfulTasks: 1,
      successRate: 50,
      avgIterationsToSuccess: 2,
    })
    expect(result.commonFailureCategories).toEqual([
      { category: IterationFailureCategory.QUALITY, count: 2 },
      { category: IterationFailureCategory.TECHNICAL, count: 1 },
    ])
  })

  it('应只重排失败环节并把优化后的 prompt 注入队列上下文', async () => {
    const taskId = new Types.ObjectId()
    videoTaskModel.findById.mockReturnValue(createExecQuery({
      _id: taskId,
      batchId: new Types.ObjectId(),
      status: VideoTaskStatus.FAILED,
      errorMessage: 'LLM returned invalid JSON',
      metadata: {
        pipelineContext: {
          prompts: {
            'generate-copy': '原始文案 prompt',
            'render-video': '原始视频 prompt',
          },
        },
      },
      promptFixes: [],
    }))
    videoTaskModel.findByIdAndUpdate.mockReturnValue(createExecQuery(null))

    const result = await service.queueRetryWithOptimizedPrompt(
      taskId.toString(),
      'copy_generate',
      '优化后的文案 prompt',
      'retry_optimized',
    )

    expect(result).toEqual({
      queued: true,
      retryStep: 'generate-copy',
      strategy: 'retry_optimized',
    })
    expect(videoTaskModel.findByIdAndUpdate).toHaveBeenCalledWith(
      taskId,
      expect.objectContaining({
        $set: expect.objectContaining({
          'status': VideoTaskStatus.PENDING,
          'metadata.pipelineContext': {
            prompts: {
              'generate-copy': '优化后的文案 prompt',
              'render-video': '原始视频 prompt',
              'quality-check': 'retry_strategy:retry_optimized',
            },
            qualityReport: undefined,
          },
        }),
        $push: expect.objectContaining({
          promptFixes: expect.objectContaining({
            originalPrompt: '原始文案 prompt',
            optimizedPrompt: '优化后的文案 prompt',
            failureReason: 'LLM returned invalid JSON',
            result: 'retry_optimized',
          }),
        }),
      }),
    )
    expect(workerQueue.add).toHaveBeenCalledWith(
      'generate-copy',
      {
        taskId: taskId.toString(),
        context: {
          prompts: {
            'generate-copy': '优化后的文案 prompt',
            'render-video': '原始视频 prompt',
            'quality-check': 'retry_strategy:retry_optimized',
          },
          qualityReport: undefined,
        },
      },
      {
        jobId: expect.stringContaining(`${taskId.toString()}:generate-copy:optimizer:`),
      },
    )
  })
})
