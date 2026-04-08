import { AppException } from '@yikart/common'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_WORKFLOW_SERVER_CATALOG } from './agent-orchestration.types'
import { PlanAgentWorkflowDto } from './agent.dto'
import { AgentService } from './agent.service'

vi.mock('@yikart/mongodb', () => {
  return {
    ContentGenerationTaskRepository: class {},
    ContentGenerationTaskStatus: {
      Pending: 'pending',
      Running: 'running',
      Completed: 'completed',
      RequiresAction: 'requires_action',
      Error: 'error',
    },
    Transactional: () => {
      return (_target: unknown, _propertyKey: string, descriptor: PropertyDescriptor) => descriptor
    },
  }
})

function createPlan() {
  return {
    workflowType: 'production' as const,
    mode: 'sequential_handoff' as const,
    roles: ['planner', 'producer'] as const,
    memory: {
      policy: 'task' as const,
      latestUserIntent: '生成品牌视频',
      preferredPlatforms: ['XHS'],
      brandKeywords: ['猫王音响'],
      pendingActions: ['内容生产'],
      recentContext: ['user: 之前主推复古蓝牙音箱'],
    },
    toolSelection: {
      selectedServers: ['util', 'content', 'mediaGeneration'],
      roleServerMap: {
        planner: ['util', 'content'],
        producer: ['util', 'content', 'mediaGeneration'],
      },
      toolFocus: ['策划 Agent: util, content'],
    },
    stages: [
      {
        id: 'stage-1',
        role: 'planner' as const,
        name: '1. 策划 Agent',
        objective: '拆解目标',
        serverNames: ['util', 'content'],
        instructions: ['梳理约束'],
      },
    ],
    handoffNotes: ['策划完成后交给生产'],
    systemPromptAppendix: 'appendix',
  }
}

describe('agentService workflow behavior', () => {
  it('should delegate role listing to orchestration service', () => {
    const repository = {} as never
    const serverClient = {} as never
    const runtime = {} as never
    const redisPubSub = {} as never
    const orchestrationService = {
      listRoles: vi.fn().mockReturnValue([{ key: 'planner' }]),
    } as never

    const service = new AgentService(
      repository,
      serverClient,
      runtime,
      redisPubSub,
      orchestrationService,
    )

    expect(service.listRoles()).toEqual([{ key: 'planner' }])
    expect(orchestrationService.listRoles).toHaveBeenCalledTimes(1)
  })

  it('should include task history when planning workflow from an existing task', async () => {
    const repository = {
      getUserTask: vi.fn().mockResolvedValue({
        id: 'task-1',
        messages: [{ type: 'user', content: '历史消息' }],
      }),
    } as never
    const serverClient = {} as never
    const runtime = {} as never
    const redisPubSub = {} as never
    const orchestrationService = {
      listRoles: vi.fn(),
      planWorkflow: vi.fn().mockReturnValue(createPlan()),
    } as never

    const service = new AgentService(
      repository,
      serverClient,
      runtime,
      redisPubSub,
      orchestrationService,
    )

    const dto = PlanAgentWorkflowDto.create({
      prompt: '生成品牌视频',
      taskId: 'task-1',
      memoryPolicy: 'task',
    })

    const plan = await service.planWorkflow('user-1', dto)

    expect(plan.workflowType).toBe('production')
    expect(repository.getUserTask).toHaveBeenCalledWith('user-1', 'task-1')
    expect(orchestrationService.planWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      prompt: '生成品牌视频',
      historicalMessages: [{ type: 'user', content: '历史消息' }],
      availableServers: DEFAULT_AGENT_WORKFLOW_SERVER_CATALOG,
    }))
  })

  it('should throw when the requested task does not belong to the user', async () => {
    const repository = {
      getUserTask: vi.fn().mockResolvedValue(null),
    } as never
    const serverClient = {} as never
    const runtime = {} as never
    const redisPubSub = {} as never
    const orchestrationService = {
      listRoles: vi.fn(),
      planWorkflow: vi.fn(),
    } as never

    const service = new AgentService(
      repository,
      serverClient,
      runtime,
      redisPubSub,
      orchestrationService,
    )

    const dto = PlanAgentWorkflowDto.create({
      prompt: '生成品牌视频',
      taskId: 'task-missing',
      memoryPolicy: 'task',
    })

    await expect(service.planWorkflow('user-1', dto)).rejects.toBeInstanceOf(AppException)
  })
})
